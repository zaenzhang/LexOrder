"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, requireWorkspaceConfiguration } from "@/lib/auth/session";
import { isPersonalMode } from "@/lib/runtime/mode";
import { resolvePersonalActor } from "@/server/runtime/personal";
import { audit, auditTx } from "@/server/audit";
import { shDayKey } from "@/lib/ui/sh-time";
import { storage } from "@/lib/storage";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanLeadMatter } from "@/lib/permissions";
import { canReadDocument } from "@/lib/approvals/documents";
import { approvalTransaction } from "@/lib/approvals/service";
import { checkRoleMutation } from "@/lib/roles/service";
import { enqueueMaterialProcessing } from "@/server/documents/material-processing";
import { decryptBuffer, encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { buildContext, templateMatterInputs, readTemplatePath, applyTemplateValues, renderDocxBuffer, detectMissing, extractDocxVariables, type RenderContext } from "@/lib/template-engine";
import { missingTemplateTargets, type TemplatePreparation } from "@/lib/template-render-fields";
import { suggestFolderByTemplateCategory } from "@/lib/default-folders";
import {
  templateListFilterSchema,
  templateToggleSchema,
  templateRenderSchema, templatePrepareSchema
} from "./schemas";
import { revalidateMatter } from "@/server/matters/route";
import { ActionError } from "@/lib/action-error";

export async function listTemplates(input?: z.input<typeof templateListFilterSchema>) {
  await requireSession("personal");
  const filter = templateListFilterSchema.parse(input ?? {});

  const where: Prisma.DocumentTemplateWhereInput = {};
  if (filter.onlyEnabled) where.enabled = true;
  if (filter.category) where.category = filter.category;
  if (filter.matterCategory) {
    // applicableCategories 为空数组 = 全适用；包含目标也匹配
    where.OR = [
      { applicableCategories: { isEmpty: true } },
      { applicableCategories: { has: filter.matterCategory } }
    ];
  }

  return prisma.documentTemplate.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      category: true,
      description: true,
      applicableCategories: true,
      variables: true,
      isBuiltIn: true,
      enabled: true,
      updatedAt: true
    }
  });
}

export async function getTemplate(id: string) {
  await requireSession("personal");
  return prisma.documentTemplate.findUnique({
    where: { id },
    include: {
      docxBlob: { select: { id: true, name: true, size: true } },
      createdBy: { select: { id: true, name: true } }
    }
  });
}

export async function toggleTemplate(input: z.infer<typeof templateToggleSchema>) {
  const session = await requireWorkspaceConfiguration();
  const data = templateToggleSchema.parse(input);

  await prisma.documentTemplate.update({
    where: { id: data.id },
    data: { enabled: data.enabled }
  });

  await audit({
    userId: session.user.id,
    action: "TEMPLATE_TOGGLE",
    targetType: "DocumentTemplate",
    targetId: data.id,
    detail: { enabled: data.enabled }
  });

  revalidatePath("/admin/templates");
  revalidatePath("/admin/templates");
  return { ok: true };
}

function templateFields(variables: string[], context: RenderContext): TemplatePreparation["fields"] {
  return variables.map(path => {
    const value = readTemplatePath(context, path);
    const editable = value === null || typeof value !== "object";
    return { path, editable, value: value == null ? "" : editable ? String(value) : JSON.stringify(value),
      missing: value == null || String(value).trim() === "" };
  });
}

async function templateWriteContext(db: Prisma.TransactionClient, user: Awaited<ReturnType<typeof requireSession>>["user"], matterId: string) {
  await checkRoleMutation(db, user, "documents.write");
  const actor = await db.user.findUnique({ where: { id: user.id }, select: { active: true, role: true } });
  if (!actor?.active || actor.role !== user.role) throw new ActionError("当前资格已变化，请刷新后重试");
  await db.$queryRaw`SELECT id FROM "Matter" WHERE id = ${matterId} FOR UPDATE`;
  const matter = await db.matter.findFirst({ where: { id: matterId, deletedAt: null, OR: [
    { ownerId: user.id }, { members: { some: { userId: user.id, role: { in: ["LEAD", "CO_LEAD"] } } } },
  ] }, select: { internalCode: true, category: true, status: true } });
  if (!matter) throw new ActionError("仅案件主办/协办可生成文书");
  if (matter.status === "ARCHIVED") throw new ActionError("案件已归档，不能生成新文书");
  return matter;
}

/** Preparation reads actual template fields and exact targets; it has no writes. */
export async function prepareTemplate(input: z.input<typeof templatePrepareSchema>): Promise<TemplatePreparation> {
  const session = await requireSession("documents.write");
  const data = templatePrepareSchema.parse(input);
  await assertMatterWritable(data.matterId);
  await assertCanLeadMatter(session.user.id, data.matterId, "仅案件主办/协办可起草文书");
  const template = await prisma.documentTemplate.findUnique({ where: { id: data.templateId }, include: { docxBlob: true } });
  if (!template?.enabled || !template.docxBlob || template.docxBlob.deletedAt) throw new ActionError("模板不可用，请重新选择");
  const inputs = await templateMatterInputs(data.matterId, template.category);
  if (template.applicableCategories.length && !template.applicableCategories.includes(inputs.matter.category)) throw new ActionError("模板不适用于当前案件类别");
  const selection = data.selection ?? inputs.selection;
  const context = await buildContext({ matterId: data.matterId, userId: session.user.id, templateCategory: template.category, selection, matterInputs: inputs });
  const variables = z.array(z.string().max(100)).max(100).parse(template.variables);
  return { templateId: template.id, templateUpdatedAt: template.updatedAt.toISOString(), templateSourceDocumentId: template.docxBlob.id,
    selection, choices: inputs.choices, fields: templateFields(variables, context) };
}

/** Generates one reviewed draft. Master records remain untouched on success, cancel, or failure. */
export async function renderTemplate(input: z.infer<typeof templateRenderSchema>) {
  const session = await requireSession("documents.write");
  const data = templateRenderSchema.parse(input);
  const requestHash = createHash("sha256").update(JSON.stringify({ ...data,
    expectedValues: Object.fromEntries(Object.entries(data.expectedValues).sort()),
    overrides: Object.fromEntries(Object.entries(data.overrides).sort()),
  })).digest("hex");
  let writtenPath: string | null = null;
  let result: { ok: true; documentId: string; fileName: string; missing: string[] };
  try {
    result = await approvalTransaction(async db => {
      const matter = await templateWriteContext(db, session.user, data.matterId);
      const existing = await db.document.findUnique({ where: { generationRequestKey: data.requestKey } });
      if (existing) {
        if (existing.uploadedById !== session.user.id || existing.matterId !== data.matterId || existing.generationRequestHash !== requestHash || existing.deletedAt || !await canReadDocument(session.user.id, existing, db)) {
          throw new ActionError("生成请求已用于其他内容，请重新核对后生成");
        }
        return { ok: true as const, documentId: existing.id, fileName: existing.name, missing: [] };
      }
      const template = await db.documentTemplate.findUnique({ where: { id: data.templateId }, include: { docxBlob: true } });
      if (!template?.enabled || !template.docxBlob || template.docxBlob.deletedAt) throw new ActionError("模板不可用，请重新选择");
      if (template.updatedAt.toISOString() !== data.templateUpdatedAt) throw new ActionError("模板已变化，请重新加载并核对字段");
      if (template.applicableCategories.length && !template.applicableCategories.includes(matter.category)) throw new ActionError("模板不适用于当前案件类别");
      const variables = z.array(z.string().max(100)).max(100).parse(template.variables);
      const inputs = await templateMatterInputs(data.matterId, template.category, db);
      const unselected = missingTemplateTargets(variables, data.selection, inputs.choices);
      if (unselected.length) throw new ActionError(`请先选择本次文书的${unselected.join("、")}`);
      const sourceContext = await buildContext({ matterId: data.matterId, userId: session.user.id, templateCategory: template.category, selection: data.selection, db, matterInputs: inputs });
      if (templateFields(variables, sourceContext).some(field => data.expectedValues[field.path] !== field.value)) {
        throw new ActionError("案件或主体资料已变化，请重新加载字段并核对，补填内容尚未保存");
      }
      const context = applyTemplateValues(sourceContext, data.overrides, variables, template.category);
      const missing = detectMissing(variables, context);
      if (missing.length) throw new ActionError(`请补全 ${missing.length} 个空白字段后再生成`);
      let folderId = data.folderId;
      if (folderId) {
        const folder = await db.documentFolder.findUnique({ where: { id: folderId }, select: { matterId: true } });
        if (folder?.matterId !== data.matterId) throw new ActionError("目标卷宗与案件不匹配");
      } else {
        const name = suggestFolderByTemplateCategory(template.category, matter.category);
        if (name) folderId = (await db.documentFolder.findFirst({ where: { matterId: data.matterId, name }, select: { id: true } }))?.id ?? null;
      }
      const raw = await storage.readFile(template.docxBlob.path);
      const templateBuffer = template.docxBlob.encrypted ? decryptBuffer(raw, template.docxBlob.iv ?? "", template.docxBlob.authTag ?? "") : raw;
      const rendered = renderDocxBuffer(templateBuffer, context);
      const encrypted = encryptBuffer(rendered);
      writtenPath = await storage.writeFile(`m_${data.matterId}`, encrypted.ciphertext);
      const fileName = `${template.name}_${matter.internalCode}_${shDayKey(new Date())}.docx`;
      const doc = await db.document.create({ data: {
        matterId: data.matterId, procedureId: data.selection.procedureId, folderId, templateId: template.id, familyId: randomUUID(),
        templateContextSnapshot: { context, selection: data.selection, templateSource: { documentId: template.docxBlob.id, sha256: template.docxBlob.sha256 }, reviewedById: session.user.id, reviewedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
        generationRequestKey: data.requestKey, generationRequestHash: requestHash,
        name: fileName, category: "OTHER", status: "DRAFT", sourceOrigin: "TEAM_PRODUCED",
        path: writtenPath, mimeType: DOCX_MIME, size: rendered.length, sha256: sha256(rendered),
        encrypted: true, algorithm: encrypted.algorithm, iv: encrypted.iv.toString("base64"), authTag: encrypted.authTag.toString("base64"),
        tags: ["模板生成", template.name], uploadedById: session.user.id,
      } });
      await enqueueMaterialProcessing(db, { documentId: doc.id, requestedById: session.user.id });
      await auditTx(db, { userId: session.user.id, action: "TEMPLATE_RENDER", targetType: "Document", targetId: doc.id,
        detail: { templateId: template.id, templateSourceDocumentId: template.docxBlob.id, matterId: data.matterId, selection: data.selection } });
      return { ok: true as const, documentId: doc.id, fileName, missing: [] };
    });
  } catch (error) {
    if (writtenPath) {
      // A failed transaction response can arrive after COMMIT. Preserve any published original.
      let saved;
      try { saved = await prisma.document.findUnique({ where: { generationRequestKey: data.requestKey }, select: { path: true } }); }
      catch { throw new ActionError("文书生成结果尚未确认，请保留本次操作并重试"); }
      if (saved?.path !== writtenPath) await storage.deleteFile(writtenPath);
    }
    throw error;
  }
  await revalidateMatter(data.matterId);
  return result;
}

/* ---------- v1.x 收尾：律师自定义文书模板上传（v5 §4.4 挂账清偿） ---------- */

const uploadTemplateSchema = z.object({
  name: z.string().min(1, "模板名称必填").max(80),
  category: z.enum([
    "INTAKE", "RETAINER", "LITIGATION", "EXECUTION", "HEARING",
    "WORK_PRODUCT", "ARCHIVE", "CLOSING", "BLANK"
  ]),
  description: z.string().max(300).optional().or(z.literal("")),
  applicableCategories: z.array(z.enum([
    "CIVIL_COMMERCIAL", "LABOR_ARBITRATION", "COMMERCIAL_ARBITRATION", "CRIMINAL",
    "ADMINISTRATIVE", "NON_LITIGATION", "LEGAL_COUNSEL", "SPECIAL_PROJECT"
  ])).default([]),
  extraVariables: z.array(z.string().regex(/^[A-Za-z_$][\w$.]*$/, "变量须为点分路径，如 client.name")).default([])
});

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_TEMPLATE_SIZE = 10 * 1024 * 1024;

/**
 * 上传自定义 docx 模板。文件加密落 storage，元数据与 blob Document 同事务创建；
 * 变量清单自动提取（页眉页脚一并扫描），手工补充变量兜底拆分 run 漏检。
 */
export async function uploadDocumentTemplate(formData: FormData) {
  const session = await requireWorkspaceConfiguration();
  const data = uploadTemplateSchema.parse({
    name: formData.get("name"),
    category: formData.get("category"),
    description: formData.get("description") || undefined,
    applicableCategories: String(formData.get("applicableCategories") ?? "").split(",").map(s => s.trim()).filter(Boolean),
    extraVariables: String(formData.get("extraVariables") ?? "").split(/[，,]/).map(s => s.trim()).filter(Boolean)
  });

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ActionError("请选择 docx 模板文件");
  if (file.size > MAX_TEMPLATE_SIZE) throw new ActionError("模板文件不得超过 10MB");
  const isDocx = file.type === DOCX_MIME || file.name.toLowerCase().endsWith(".docx");
  if (!isDocx) throw new ActionError("仅支持 .docx 模板文件");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.subarray(0, 2).toString("latin1") !== "PK") throw new ActionError("文件不是有效的 docx（ZIP 头缺失）");

  const variables = [...new Set([...extractDocxVariables(buffer), ...data.extraVariables])].sort();

  const enc = encryptBuffer(buffer);
  const created = await prisma.$transaction(async tx => {
    if (isPersonalMode()) await resolvePersonalActor(tx, session.user.id);
    const path = await storage.writeFile("templates", enc.ciphertext);
    const tmpl = await tx.documentTemplate.create({
      data: {
        name: data.name,
        category: data.category,
        description: data.description || null,
        applicableCategories: data.applicableCategories,
        variables,
        isBuiltIn: false,
        createdBy: { connect: { id: session.user.id } },
        docxBlob: {
          create: {
            name: file.name,
            mimeType: DOCX_MIME,
            size: file.size ?? buffer.length,
            path,
            encrypted: true,
            iv: enc.iv.toString("base64"),
            authTag: enc.authTag.toString("base64"),
            uploadedById: session.user.id,
            sourceOrigin: "TEAM_PRODUCED" as const
          }
        }
      },
      select: { id: true }
    });
    await auditTx(tx, {
      userId: session.user.id,
      action: "TEMPLATE_UPLOAD",
      targetType: "DocumentTemplate",
      targetId: tmpl.id,
      detail: {
        name: data.name,
        category: data.category,
        fileName: file.name,
        fileSize: file.size,
        extractedVariableCount: variables.length
      }
    });
    return tmpl;
  });

  revalidatePath("/admin/document-templates");
  return { ok: true as const, id: created.id, variableCount: variables.length };
}

/** 管理后台列表（含停用；带创建人与文件信息） */
export async function listTemplatesForAdmin() {
  await requireWorkspaceConfiguration();
  return prisma.documentTemplate.findMany({
    orderBy: [{ isBuiltIn: "asc" }, { category: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true, name: true, category: true, description: true,
      applicableCategories: true, variables: true, isBuiltIn: true, enabled: true,
      updatedAt: true,
      createdBy: { select: { name: true } },
      docxBlob: { select: { name: true, size: true } }
    }
  });
}
