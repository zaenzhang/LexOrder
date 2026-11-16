// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplatePreparation } from "@/lib/template-render-fields";

const databaseUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("模板生成测试仅允许独立的 _test 数据库");
const mocks = vi.hoisted(() => ({ files: new Map<string, Buffer>(), failAudit: false, failAfterCommit: false, deleteFile: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  return { prisma: url ? createPrismaClient(url) : undefined };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session, requireWorkspaceConfiguration: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/approvals/service", async () => {
  const real = await vi.importActual<typeof import("@/lib/approvals/service")>("@/lib/approvals/service");
  return { ...real, approvalTransaction: async (run: Parameters<typeof real.approvalTransaction>[0]) => {
    const result = await real.approvalTransaction(run);
    if (mocks.failAfterCommit) { mocks.failAfterCommit = false; throw new Error("合成提交回执丢失"); }
    return result;
  } };
});
// Real DOCX render/encryption and PG transaction; only the blob sink is in memory.
vi.mock("@/lib/storage", () => ({ storage: {
  readFile: async (path: string) => { const buffer = mocks.files.get(path); if (!buffer) throw new Error("合成模板不存在"); return buffer; },
  writeFile: async (_scope: string, buffer: Buffer) => { const path = `template-test/${randomUUID()}.docx`; mocks.files.set(path, buffer); return path; },
  deleteFile: async (path: string) => { mocks.deleteFile(path); mocks.files.delete(path); },
} }));
vi.mock("@/server/audit", async () => {
  const real = await vi.importActual<typeof import("@/server/audit")>("@/server/audit");
  return { ...real, auditTx: async (...args: Parameters<typeof real.auditTx>) => {
    if (mocks.failAudit && args[1].action === "TEMPLATE_RENDER") throw new Error("合成审计写入失败");
    return real.auditTx(...args);
  } };
});

import { prisma as db } from "@/lib/prisma";
import { pack, body } from "@/lib/template-builder";
import { encryptIdNumber } from "@/lib/clients/id-number-crypto";
import { prepareTemplate, renderTemplate } from "@/server/document-templates/actions";
const users: string[] = [], matters: string[] = [], clients: string[] = [], templates: string[] = [], blobs: string[] = [];
async function fixture() {
  const user = await db.user.create({ data: { name: "合成起草律师", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  users.push(user.id);
  mocks.session.mockResolvedValue({ user: { id: user.id, role: user.role }, expires: "2099-01-01" });
  const client = await db.client.create({ data: { name: "合成委托人", type: "COMPANY", phone: "主档原电话", legalRep: "合成法定代表人", idNumber: encryptIdNumber("SYNTHETIC-ID"), tags: [] } });
  clients.push(client.id);
  const matter = await db.matter.create({ data: { title: "合成模板事项", internalCode: `TEMPLATE-${randomUUID()}`, ownerId: user.id, primaryClientId: client.id } });
  matters.push(matter.id);
  const firstParty = await db.party.create({ data: { matterId: matter.id, role: "OPPOSING_PARTY", name: "合成对方一", phone: "对方一原电话", ordinal: 1 } });
  const secondParty = await db.party.create({ data: { matterId: matter.id, role: "OPPOSING_PARTY", name: "合成对方二", phone: "对方二原电话", ordinal: 2 } });
  const firstProcedure = await db.matterProcedure.create({ data: { matterId: matter.id, type: "FIRST_INSTANCE", order: 1, handlingAgency: "合成一审法院" } });
  const secondProcedure = await db.matterProcedure.create({ data: { matterId: matter.id, type: "SECOND_INSTANCE", order: 2, handlingAgency: "合成二审法院" } });
  const variables = ["client.phone", "client.idNumber", "client.legalRep", "opposing.name", "opposing.phone", "proceeding.court"];
  const buffer = await pack([body(variables.map(path => `{{${path}}}`).join("；"))]);
  const blob = await db.document.create({ data: { name: "合成模板.docx", path: `template-fixture/${randomUUID()}.docx`, uploadedById: user.id, tags: [], sha256: "b".repeat(64) } });
  blobs.push(blob.id); mocks.files.set(blob.path, buffer);
  const template = await db.documentTemplate.create({ data: { name: "合成主体核对模板", category: "LITIGATION", applicableCategories: [], variables, docxBlobId: blob.id, createdById: user.id } });
  templates.push(template.id);
  return { user, client, matter, firstParty, secondParty, firstProcedure, secondProcedure, template, blob };
}
function renderInput(preparation: TemplatePreparation, matterId: string) {
  return { requestKey: randomUUID(), matterId, templateId: preparation.templateId, templateUpdatedAt: preparation.templateUpdatedAt,
    selection: preparation.selection, expectedValues: Object.fromEntries(preparation.fields.map(field => [field.path, field.value])),
    overrides: { "client.phone": "仅本稿委托人电话", "opposing.phone": "仅本稿对方电话" }, reviewed: true as const, folderId: null };
}
async function chosenPreparation(f: Awaited<ReturnType<typeof fixture>>) {
  return prepareTemplate({ matterId: f.matter.id, templateId: f.template.id,
    selection: { clientId: f.client.id, opposingPartyId: f.secondParty.id, thirdPartyId: null, procedureId: f.secondProcedure.id } });
}

describe.skipIf(!databaseUrl)("模板字段核对与生成：真实 PG", () => {
  beforeAll(async () => { await db.$connect(); });
  beforeEach(() => { mocks.failAudit = false; mocks.failAfterCommit = false; mocks.deleteFile.mockClear(); });
  afterAll(async () => {
    const runs = await db.documentParseRun.findMany({ where: { requestedById: { in: users } }, select: { id: true } });
    await db.jobQueue.updateMany({ where: { dedupeKey: { in: runs.map(run => `document.parse:${run.id}`) }, status: { not: "SUCCESS" } },
      data: { status: "DEAD", leaseToken: null, leaseUntil: null, lastError: "合成模板场景已结束" } });
    await db.documentTemplate.updateMany({ where: { id: { in: templates } }, data: { enabled: false } });
    await db.document.updateMany({ where: { OR: [{ matterId: { in: matters } }, { id: { in: blobs } }] }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    mocks.files.clear(); await db.$disconnect();
  });

  it("实际字段核对、取消和成功生成均不回写主档；选中第二主体/程序，重试仍返回同一草稿", async () => {
    const f = await fixture();
    const initial = await prepareTemplate({ matterId: f.matter.id, templateId: f.template.id });
    expect(initial.selection).toMatchObject({ opposingPartyId: null, procedureId: null });
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(0);
    await expect(renderTemplate({ ...renderInput(initial, f.matter.id), overrides: { "opposing.name": "手填不能冒充具体主体", "opposing.phone": "临时电话", "proceeding.court": "手填法院" } })).rejects.toThrow("请先选择本次文书");
    const preparation = await chosenPreparation(f);
    expect(preparation.fields.find(field => field.path === "client.idNumber")?.value).toBe("SYNTHETIC-ID");
    expect(preparation.fields.find(field => field.path === "client.legalRep")?.value).toBe("合成法定代表人");
    const input = renderInput(preparation, f.matter.id), saved = await renderTemplate(input);
    expect(await renderTemplate(input)).toEqual(saved);
    const doc = await db.document.findUniqueOrThrow({ where: { id: saved.documentId } });
    expect(doc).toMatchObject({ status: "DRAFT", approvedById: null, procedureId: f.secondProcedure.id });
    expect(doc.familyId).toBeTruthy();
    expect(doc.templateContextSnapshot).toMatchObject({ selection: preparation.selection,
      context: { client: { phone: "仅本稿委托人电话" }, opposing: { name: "合成对方二", phone: "仅本稿对方电话" }, proceeding: { court: "合成二审法院" } },
      templateSource: { documentId: f.blob.id, sha256: f.blob.sha256 } });
    expect(await db.client.findUniqueOrThrow({ where: { id: f.client.id } })).toEqual(f.client);
    expect(await db.party.findUniqueOrThrow({ where: { id: f.firstParty.id } })).toEqual(f.firstParty);
    expect(await db.party.findUniqueOrThrow({ where: { id: f.secondParty.id } })).toEqual(f.secondParty);
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "TEMPLATE_RENDER", targetId: doc.id } })).toBe(1);
    expect(await db.documentParseRun.count({ where: { documentId: doc.id } })).toBe(1);
    await expect(renderTemplate({ ...input, overrides: { "client.phone": "同键不同内容" } })).rejects.toThrow("生成请求已用于其他内容");
    await db.user.update({ where: { id: f.user.id }, data: { active: false } });
    await expect(renderTemplate(input)).rejects.toThrow("当前资格已变化");
  });

  it("资料变更需重核；生成后的事务失败清理新文件且回滚稿件、处理队列和审计", async () => {
    const f = await fixture(), preparation = await chosenPreparation(f);
    await db.party.update({ where: { id: f.secondParty.id }, data: { phone: "主档明确更正电话" } });
    await expect(renderTemplate(renderInput(preparation, f.matter.id))).rejects.toThrow("资料已变化");
    const fresh = await chosenPreparation(f), fileCount = mocks.files.size;
    mocks.failAudit = true;
    await expect(renderTemplate(renderInput(fresh, f.matter.id))).rejects.toThrow("合成审计写入失败");
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1);
    expect(mocks.files.size).toBe(fileCount);
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(0);
    expect(await db.documentParseRun.count({ where: { document: { matterId: f.matter.id } } })).toBe(0);
    expect(await db.auditLog.count({ where: { userId: f.user.id, action: { in: ["TEMPLATE_RENDER", "DOCUMENT_PARSE_REQUEST"] } } })).toBe(0);
    expect(await db.client.findUniqueOrThrow({ where: { id: f.client.id } })).toEqual(f.client);
    expect((await db.party.findUniqueOrThrow({ where: { id: f.secondParty.id } })).phone).toBe("主档明确更正电话");
  });

  it("事务已提交但回执丢失时保留已发布原件，原操作重试只返回原稿", async () => {
    const f = await fixture(), preparation = await chosenPreparation(f), input = renderInput(preparation, f.matter.id);
    mocks.failAfterCommit = true;
    await expect(renderTemplate(input)).rejects.toThrow("合成提交回执丢失");
    const saved = await db.document.findUniqueOrThrow({ where: { generationRequestKey: input.requestKey } });
    expect(mocks.files.has(saved.path)).toBe(true);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(await renderTemplate(input)).toMatchObject({ documentId: saved.id, fileName: saved.name });
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: saved.id, action: "TEMPLATE_RENDER" } })).toBe(1);
  });
});
