import { NextResponse } from "next/server";
import { z } from "zod";
import { draftExtension } from "@/lib/desktop/working-format";
import { ActionError } from "@/lib/action-error";
import { requireSession } from "@/lib/auth/session";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { formatDeadlineDue } from "@/lib/deadline-due";
import { procedureTypeLabel, litigationStandingLabel, matterStatusLabel } from "@/lib/enums";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { prisma } from "@/lib/prisma";
import { prepareDeliverySchema, registerDeliveryEventSchema } from "@/server/deliveries/contracts";
import { exportDeliveryForActor } from "@/server/deliveries/export";
import { getDeliveryDetail, getDeliveryOptions, prepareDelivery, registerDeliveryEvent, listDeliveryRecords } from "@/server/deliveries/actions";
import { canReadDocument } from "@/lib/approvals/documents";
import { listFoldersByMatter, createFolder, renameFolder, moveDocumentToFolder } from "@/server/document-folders/actions";
import { listDocumentPage, uploadDocument } from "@/server/documents/actions";
import { evidenceTextSchema, revisionInputSchema, sourceInputSchema } from "@/server/evidence/contracts";
import { createEvidenceItem, updateEvidenceItem, addEvidenceSource, removeEvidenceSource, listEvidenceItems, getEvidenceFormOptions, confirmEvidenceItem } from "@/server/evidence/actions";
import { getMatterFinance } from "@/server/finance/actions";
import { getMatterById, updateMatterBasicInfo } from "@/server/matters/actions";
import { createNote, listNotes, updateNote } from "@/server/notes/actions";
import { getResearchList, getResearch, saveResearchRevision, checkResearchRevision, formResearchDraft } from "@/server/research/actions";
import { emptyResearchContent, researchAnalysisSchema, researchCheckSchema, researchDraftSchema } from "@/server/research/contracts";
import { getMatterBrief, getMatterContext, getMatterContextInputOptions, getMatterContextSourceOptions, recordMatterContext, confirmMatterContextRecord, getMatterContextHistory } from "@/server/matters/context-actions";
import { getTaskWorkspace } from "@/server/tasks/workflow-actions";
import { createTask, toggleTaskCompleted, updateTask } from "@/server/tasks/actions";
import { listActiveSealPurposes } from "@/server/approval-permissions/actions";
import { listTemplates, prepareTemplate, renderTemplate, uploadDocumentTemplate } from "@/server/document-templates/actions";
import { templatePrepareSchema, templateRenderSchema } from "@/server/document-templates/schemas";
import { sealApproveSchema, sealRejectSchema } from "@/server/seals/schemas";
import { listSealTypeConfigs, createSealRequest, stampSealRequest, cancelSealRequest, approveSealRequest, rejectSealRequest, listSealRequests } from "@/server/seals/actions";

import { matterUpdateBasicSchema } from "@/server/matters/schemas";
import { contextRecordSchema, contextConfirmSchema, contextSourcePageSchema } from "@/lib/matters/context";
import { addProcedure, updateProcedure, createProcedureStage, addDeadline, addHearing } from "@/server/procedures/actions";
import { procedureCreateSchema, procedureUpdateSchema, procedureStageCreateSchema, deadlineCreateSchema, hearingCreateSchema } from "@/server/procedures/schemas";

const headers = { "Cache-Control": "no-store" };
const idSchema = z.string().cuid();
const sections = z.enum(["overview", "context", "materials", "templates", "evidence-items", "research", "tasks", "delivery", "records", "finance", "seal"]);
const createSchema = z.object({
  action: z.literal("create-note"), matterId: idSchema, content: z.string().trim().min(1).max(5000),
  channel: z.enum(["PHONE", "WECHAT", "EMAIL", "MEETING", "COURT", "OTHER"]),
});
const taskFields = z.object({
  matterId: idSchema, title: z.string(), description: z.string(), stageId: idSchema.or(z.literal("")),
  priority: z.number().int().min(0).max(2),
});
const explicitContextRecord = z.preprocess((value, ctx) => {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "contextInputs")) {
    ctx.addIssue({ code: "custom", message: "请明确沿用或调整原方案采用的目标和指示。" });
    return z.NEVER;
  }
  return value;
}, contextRecordSchema);
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create-volume"), matterId: idSchema, name: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("rename-volume"), matterId: idSchema, folderId: idSchema, name: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("file-in-volume"), matterId: idSchema, documentId: idSchema, folderId: idSchema.nullable() }),
  createSchema,
  z.object({ action: z.literal("edit-matter"), data: matterUpdateBasicSchema.omit({ teamAccessRestricted: true }).required({ causeId: true, causeFreeText: true, claimAmount: true, ourStanding: true }).extend({ expectedUpdatedAt: z.coerce.date() }) }),
  z.object({ action: z.literal("add-procedure"), data: procedureCreateSchema.pick({ matterId: true, type: true, engagement: true, customLabel: true, caseNumber: true, handlingAgency: true }).extend({ isExternalLead: z.literal(false).default(false) }) }),
  z.object({ action: z.literal("edit-procedure"), matterId: idSchema, data: procedureUpdateSchema.pick({ id: true, expectedUpdatedAt: true, type: true, customLabel: true, caseNumber: true, handlingAgency: true, changeReason: true }) }),
  z.object({ action: z.literal("add-stage"), matterId: idSchema, data: procedureStageCreateSchema }),
  z.object({ action: z.literal("add-hearing"), matterId: idSchema, data: hearingCreateSchema }),
  z.object({ action: z.literal("add-deadline"), matterId: idSchema, data: deadlineCreateSchema }),
  z.object({ action: z.literal("save-context"), data: explicitContextRecord }),
  z.object({ action: z.literal("confirm-context"), data: contextConfirmSchema }),
  z.object({ action: z.literal("prepare-template"), data: templatePrepareSchema }),
  z.object({ action: z.literal("render-template"), data: templateRenderSchema }),
  z.object({ action: z.literal("approve-seal"), matterId: idSchema, data: sealApproveSchema }),
  z.object({ action: z.literal("reject-seal"), matterId: idSchema, data: sealRejectSchema }),
  z.object({ action: z.literal("cancel-seal"), matterId: idSchema, data: z.object({ id: idSchema }) }),
  z.object({ action: z.literal("create-evidence"), data: evidenceTextSchema.extend({ matterId: idSchema, requestKey: z.string().uuid(),
    sourceDocumentId: idSchema.nullable(), sourcePage: z.number().int().positive().nullable(), sourceRelation: z.enum(["SUPPORTS", "REBUTS", "CONTEXT"]) }) }),
  z.object({ action: z.literal("revise-evidence"), matterId: idSchema, data: revisionInputSchema.and(evidenceTextSchema) }),
  z.object({ action: z.literal("link-evidence"), matterId: idSchema, data: revisionInputSchema.and(sourceInputSchema) }),
  z.object({ action: z.literal("unlink-evidence"), matterId: idSchema, data: revisionInputSchema.extend({ sourceId: idSchema }) }),
  z.object({ action: z.literal("prepare-delivery"), data: prepareDeliverySchema }),
  z.object({ action: z.literal("record-delivery-event"), matterId: idSchema, data: registerDeliveryEventSchema }),
  z.object({ action: z.literal("export-delivery"), matterId: idSchema, deliveryId: idSchema, requestKey: z.string().uuid() }),
  taskFields.extend({ action: z.literal("create-task"), requestKey: z.string().uuid(), dueAt: z.iso.datetime({ offset: true }).pipe(z.coerce.date()).optional() }),
  taskFields.extend({ action: z.literal("update-task"), id: idSchema, revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal("complete-task"), matterId: idSchema, id: idSchema, revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal("create-research"), matterId: idSchema, requestKey: z.string().uuid(), researchedAt: z.iso.datetime({ offset: true }),
    question: z.string(), scope: z.string(), conclusion: z.string(), unresolved: z.string() }),
  z.object({
    action: z.literal("revise-research"), matterId: idSchema, supersedesId: idSchema,
    expectedVersion: z.number().int().positive(), requestKey: z.string().uuid(),
    analysis: researchAnalysisSchema,
  }),
  researchCheckSchema.extend({ action: z.literal("check-research") }),
  researchDraftSchema.extend({ action: z.literal("draft-research") }),
  createSchema.extend({
    action: z.literal("update-note"), id: idSchema, expectedUpdatedAt: z.coerce.date(),
    occurredAt: z.coerce.date(), withWhom: z.string().max(80).optional(),
    tags: z.array(z.string().max(20)),
  }),
  z.object({ action: z.literal("confirm-evidence"), evidenceItemId: idSchema, expectedRevision: z.number().int().positive(), confirm: z.literal(true) }),
]);
const json = (value: unknown) => NextResponse.json(value, { headers });
function denied(request: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(request.headers, { method: request.method })) return new Response(null, { status: 403, headers });
}

function failure(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: "案件请求无效。" }, { status: 400, headers });
  if (error instanceof ActionError) return NextResponse.json({ error: error.message }, { status: 403, headers });
  throw error;
}

async function requireSealInMatter(matterId: string, id: string) {
  if (!await prisma.sealRequest.count({ where: { id, matterId } })) throw new ActionError("用印申请不存在或不属于当前案件");
}

async function requireDeliveryInMatter(matterId: string, deliveryId: string) {
  const match = await prisma.deliveryRecord.count({ where: { id: deliveryId, matterId } });
  if (!match) throw new ActionError("交付清单不存在或不属于当前案件");
}

export async function GET(request: Request) {
  const blocked = denied(request);
  if (blocked) return blocked;
  const query = new URL(request.url).searchParams;
  try {
    const id = idSchema.parse(query.get("matter"));
    const section = sections.parse(query.get("section"));
    const cursor = query.has("cursor") ? idSchema.parse(query.get("cursor")) : undefined;
    if (section === "materials") {
      const version = z.enum(["all", "latest", "historical"]).parse(query.get("version") ?? "all");
      const folder = query.get("folder") ?? "*";
      const [documents, folders] = await Promise.all([listDocumentPage({
        matterId: id, limit: 100, search: z.string().trim().max(200).parse(query.get("q") ?? ""),
        folderId: folder === "*" ? undefined : folder === "" ? null : idSchema.parse(folder),
        isLatest: version === "all" ? undefined : version === "latest",
      }, cursor), listFoldersByMatter(id)]);
      return json({ nextCursor: documents.nextCursor, folders: folders.map(({ id, name }) => ({ id, name })), documents: documents.items.map(({ id, name, version, isLatest, mimeType, status, sourceOrigin, folderId }) => ({
        id, name, version, isLatest, mimeType, status, sourceOrigin, folderId, editable: isLatest && !!draftExtension({ status, sourceOrigin, mimeType }),
      })) });
    }
    if (section === "context") {
      if (query.get("inputs") === "1") return json(await getMatterContextInputOptions(id, query.get("after") ?? undefined));
      if (query.get("sources") === "1") {
        const page = query.has("after") ? contextSourcePageSchema.parse({ type: query.get("type"), cursor: query.get("after") }) : undefined;
        return json(await getMatterContextSourceOptions(id, page));
      }
      const record = query.get("history");
      if (record) return json(await getMatterContextHistory(id, idSchema.parse(record), query.has("before") ? z.coerce.number().int().positive().parse(query.get("before")) : undefined));
      return json(await getMatterContext(id, query.get("after") ?? undefined));
    }
    if (section === "evidence-items") {
      if (query.get("options") === "1") return json(await getEvidenceFormOptions(id));
      return json({ items: await listEvidenceItems(id) });
    }
    if (section === "research") {
      const record = query.get("record");
      return json(record === null ? await getResearchList(id, cursor) : await getResearch(id, idSchema.parse(record)));
    }
    if (section === "delivery") {
      if (query.get("options") === "1") return json(await getDeliveryOptions(id));
      const record = query.get("record");
      if (!record) return json(await listDeliveryRecords(id, cursor));
      const deliveryId = idSchema.parse(record);
      await requireDeliveryInMatter(id, deliveryId);
      return json(await getDeliveryDetail(deliveryId));
    }
    if (section === "finance") {
      const { stats, entries } = await getMatterFinance(id);
      return json({ stats, entries: entries.map(({ id, type, amount, occurredAt }) => ({ id, type, amount, occurredAt })) });
    }
    const matter = await getMatterById(id);
    if (!matter) return new Response(null, { status: 404, headers });
    if (!matter.businessAccess && section !== "overview") return new Response(null, { status: 403, headers });
    if (section === "overview") {
      const { title, internalCode, status, category, cause, causeFreeText, claimAmount, owner, primaryClient } = matter;
      const brief = matter.businessAccess ? await getMatterBrief(id) : null;
      const session = await requireSession();
      const canEdit = matter.businessAccess && status !== "ARCHIVED" && hasCustomPermission(session.user, "matters.write")
        && (matter.ownerId === session.user.id || matter.members.some(m => m.userId === session.user.id && (m.role === "LEAD" || m.role === "CO_LEAD")));
      const editor = canEdit ? { id, updatedAt: matter.updatedAt, title, causeId: matter.causeId, causeFreeText, causeName: cause?.name,
        claimAmount, ourStanding: matter.ourStanding, standings: litigationStandingLabel } : null;
      return json({ title, internalCode, status, statusLabel: matterStatusLabel[status], category, brief, editor, cause: cause?.name ?? causeFreeText, claimAmount, owner: owner.name, client: primaryClient?.name });
    }
    if (section === "tasks") {
      const workspace = await getTaskWorkspace({ matterId: id, includeClosed: true });
      return json({ schedule: {
        canWrite: workspace.canWrite, procedureTypes: procedureTypeLabel,
        tasks: workspace.tasks.map(({ id, title, description, dueAt, priority, stageId, stageName, procedureTitle, responsibility, activeWaiting, prerequisites }) => ({
          id, title, description, dueAt, priority, stageId, stageName, procedureTitle, state: responsibility.state,
          assignee: responsibility.name, revision: responsibility.revision, waitingFor: activeWaiting?.waitingFor,
          blockingCount: prerequisites.filter(item => item.state !== "DONE").length,
        })),
        untracked: workspace.untrackedTasks,
        procedures: matter.procedures.map(({ id, type, customLabel, caseNumber, handlingAgency, updatedAt, engagement, deadlines, hearings, stages }) => ({
          id, type, customLabel, caseNumber, handlingAgency, updatedAt, engagement, name: [customLabel ?? procedureTypeLabel[type], caseNumber].filter(Boolean).join(" · "),
          deadlines: deadlines.map(({ id, title, dueAt, duePrecision, completed }) => ({ id, title, dueLabel: formatDeadlineDue(dueAt, duePrecision), completed })),
          hearings: hearings.map(({ id, title, startsAt }) => ({ id, title, startsAt })),
          stages: stages.filter(stage => stage.status === "ACTIVE").map(({ id, name }) => ({ id, name })),
        })),
      } });
    }
    if (section === "records") {
      const [notes, session] = await Promise.all([listNotes(id), requireSession()]);
      const canEditNotes = matter.status !== "ARCHIVED" && hasCustomPermission(session.user, "schedule.write");
      return json({
        notes: notes.map(({ id, channel, content, occurredAt, updatedAt, withWhom, tags, authorId, author }) => ({ id, channel, content, occurredAt, updatedAt, withWhom, tags, author: author.name, editable: canEditNotes && authorId === session.user.id })),
        events: matter.timelineEvents.map(({ id, title, occurredAt }) => ({ id, title, occurredAt })),
      });
    }
    if (section === "templates") {
      const templates = await listTemplates();
      return json({ templates: templates.filter(t => !t.applicableCategories.length || t.applicableCategories.includes(matter.category))
        .map(({ id, name }) => ({ id, name })) });
    }
    const [seals, types, purposes, session] = await Promise.all([
      listSealRequests({ matterId: id, scope: "all" }), listSealTypeConfigs(), listActiveSealPurposes(), requireSession(),
    ]);
    return json({ sealWorkspace: {
      canRequest: matter.status !== "ARCHIVED" && hasCustomPermission(session.user, "seals.request"),
      types: types.filter(t => t.enabled).map(({ type, label }) => ({ type, label })), purposes,
      seals: seals.map(row => ({ id: row.id, code: row.code, documentTitle: row.documentTitle, status: row.status, requestedAt: row.requestedAt,
        sealType: row.sealType, purpose: row.purpose, requestedBy: row.requestedBy.name, approvedAt: row.approvedAt, stampedAt: row.stampedAt,
        approveNote: row.approveNote, draftDoc: row.draftDoc, stampedDoc: row.stampedDoc, canApprove: row.canApprove, canStamp: row.canStamp,
        canCancel: row.status === "PENDING" && row.requestedById === session.user.id })),
    } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const blocked = denied(request);
  if (blocked) return blocked;
  try {
    if (request.headers.get("content-type")?.startsWith("multipart/form-data;")) {
      const data = await request.formData().catch(() => null);
      if (data?.get("action") === "create-seal" || data?.get("action") === "stamp-seal") {
        const matterId = idSchema.parse(data.get("matterId"));
        if (data.get("action") === "stamp-seal") {
          await requireSealInMatter(matterId, idSchema.parse(data.get("id")));
          return json(await stampSealRequest(data));
        }
        // This desktop form explicitly selects a local PDF for this case.
        const fields = new FormData();
        for (const field of ["matterId", "draftDoc", "documentTitle", "sealType", "purposeConfigId", "purpose", "copies", "pageCount", "requireCrossPageSeal", "requestNote"]) {
          const value = data.get(field);
          if (value !== null) fields.set(field, value);
        }
        return json(await createSealRequest(fields));
      }
      if (data?.get("action") === "add-template") return json(await uploadDocumentTemplate(data));
      const file = data?.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "请选择要上传的材料。" }, { status: 400, headers });
      const form = new FormData();
      form.set("file", file);
      form.set("matterId", idSchema.parse(data?.get("matterId")));
      form.set("name", z.string().trim().min(1).max(255).parse(data?.get("name")));
      form.set("category", z.string().parse(data?.get("category")));
      const sourceOrigin = data?.get("sourceOrigin");
      if (sourceOrigin != null) form.set("sourceOrigin", z.literal("TEAM_PRODUCED").parse(sourceOrigin));
      form.set("requestKey", z.string().uuid().parse(data?.get("requestKey")));
      const result = await uploadDocument(form);
      if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400, headers });
      return json({ ok: true });
    }
    const input = mutation.parse(await request.json().catch(() => null));
    if (input.action === "create-volume") return json(await createFolder(input));
    if (input.action === "rename-volume") {
      const owned = await prisma.documentFolder.findFirst({ where: { id: input.folderId, matterId: input.matterId }, select: { id: true } });
      if (!owned) throw new ActionError("卷宗不属于当前案件");
      return json(await renameFolder({ id: owned.id, name: input.name }));
    }
    if (input.action === "file-in-volume") {
      const { user } = await requireSession("documents.write");
      const doc = await prisma.document.findFirst({
        where: { id: input.documentId, matterId: input.matterId, deletedAt: null },
        select: { id: true, matterId: true, intakeId: true, uploadedById: true },
      });
      if (!doc || !await canReadDocument(user.id, doc)) throw new ActionError("材料不存在或不属于当前案件");
      return json(await moveDocumentToFolder({ documentId: doc.id, folderId: input.folderId }));
    }
    if (input.action === "edit-matter") return json(await updateMatterBasicInfo(input.data));
    if (input.action === "save-context") return json(await recordMatterContext(input.data));
    if (input.action === "confirm-context") return json(await confirmMatterContextRecord(input.data));
    if (input.action === "add-procedure") return json(await addProcedure(input.data));
    if (input.action === "edit-procedure" || input.action === "add-stage" || input.action === "add-deadline" || input.action === "add-hearing") {
      const procedureId = input.action === "edit-procedure" ? input.data.id : input.data.procedureId;
      if (!await prisma.matterProcedure.count({ where: { id: procedureId, matterId: input.matterId } })) throw new ActionError("程序不存在或不属于当前案件");
      if (input.action === "edit-procedure") return json(await updateProcedure(input.data));
      if (input.action === "add-stage") return json(await createProcedureStage(input.data));
      if (input.action === "add-hearing") return json(await addHearing(input.data));
      return json(await addDeadline(input.data));
    }
    if (input.action === "prepare-template") return json(await prepareTemplate(input.data));
    if (input.action === "render-template") return json(await renderTemplate(input.data));
    if (input.action === "approve-seal" || input.action === "reject-seal" || input.action === "cancel-seal") {
      await requireSealInMatter(input.matterId, input.data.id);
      if (input.action === "approve-seal") return json(await approveSealRequest(input.data));
      if (input.action === "reject-seal") return json(await rejectSealRequest(input.data));
      return json(await cancelSealRequest(input.data));
    }
    if (input.action === "create-evidence") return json(await createEvidenceItem(input.data));
    if (input.action === "revise-evidence" || input.action === "link-evidence" || input.action === "unlink-evidence") {
      const exists = await prisma.evidenceItem.count({ where: { id: input.data.evidenceItemId, matterId: input.matterId } });
      if (!exists) throw new ActionError("要点不存在或不属于本案");
      if (input.action === "revise-evidence") return json(await updateEvidenceItem(input.data));
      if (input.action === "link-evidence") return json(await addEvidenceSource(input.data));
      return json(await removeEvidenceSource(input.data));
    }
    if (input.action === "prepare-delivery") return json(await prepareDelivery(input.data));
    if (input.action === "record-delivery-event") {
      await requireDeliveryInMatter(input.matterId, input.data.deliveryId);
      return json(await registerDeliveryEvent(input.data));
    }
    if (input.action === "export-delivery") {
      const { user } = await requireSession("matters.export");
      await requireDeliveryInMatter(input.matterId, input.deliveryId);
      const result = await exportDeliveryForActor(user.id, input.deliveryId, { requestKey: input.requestKey });
      return new Response(new Uint8Array(result.buffer), { headers: { ...headers, "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`, "X-Content-Type-Options": "nosniff" } });
    }
    if (input.action === "create-task") return json(await createTask(input));
    if (input.action === "update-task") return json(await updateTask(input));
    if (input.action === "complete-task") return json(await toggleTaskCompleted(input.id, { matterId: input.matterId, revision: input.revision }));
    if (input.action === "create-research") return json(await saveResearchRevision({
      ...emptyResearchContent(), ...input, supersedesId: null, expectedVersion: null,
    }));
    if (input.action === "revise-research") {
      const { matterId, supersedesId, expectedVersion, requestKey, analysis } = input;
      const previous = await getResearch(matterId, supersedesId);
      if (!previous.readable || !previous.content) throw new ActionError("当前无法读取原研究及其来源");
      return json(await saveResearchRevision({
        ...previous.content, ...analysis, matterId, supersedesId, expectedVersion, requestKey,
      }));
    }
    if (input.action === "check-research") return json(await checkResearchRevision(input));
    if (input.action === "draft-research") return json(await formResearchDraft(input));
    if (input.action === "confirm-evidence") return json(await confirmEvidenceItem(input));
    if (input.action === "update-note") return json(await updateNote(input));
    return json(await createNote({ ...input, tags: [], occurredAt: new Date() }));
  } catch (error) {
    return failure(error);
  }
}
