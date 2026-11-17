// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextRecordInput } from "@/lib/matters/context";
import { sha256 } from "@/lib/storage/crypto";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("采用关系测试仅允许隔离 _test 数据库");
  return { url, files: new Map<string, Buffer>(), afterWrite: undefined as (() => Promise<void>) | undefined };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/adoption_test") };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storage: {
  writeFileAt: async (path: string, bytes: Buffer) => { config.files.set(path, Buffer.from(bytes)); await config.afterWrite?.(); },
  readFile: async (path: string) => { const bytes = config.files.get(path); if (!bytes) throw new Error("合成原件不存在"); return bytes; },
  deleteFile: async (path: string) => { config.files.delete(path); },
} }));
import { prisma as db } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { saveMatterContext, confirmMatterContext, readMatterContext, readMatterContextRecord } from "@/server/matters/context-service";
import { readContextInputChoice, readDocumentContextInputs } from "@/server/matters/context-inputs";
import { getMatterContextInputChoice, recordMatterContext } from "@/server/matters/context-actions";
import { uploadDocument, uploadNewVersion } from "@/server/documents/actions";
import { ingestMaterial, assertDocumentCanBePurged } from "@/server/documents/material-ingest";
import { getDocumentDetail } from "@/server/documents/detail-actions";
import { canReadDocument, documentReadGrant } from "@/lib/approvals/documents";
import { assertDocumentDerivationAccess } from "@/server/documents/derivation-access";
import { saveReviewToMatter } from "@/server/ai/save-review";
import { createClientBrief } from "@/server/deliveries/actions";
import { saveResearch } from "@/server/research/service";
import { createResearchDraft } from "@/server/research/draft";
import { emptyResearchContent } from "@/server/research/contracts";

const users: string[] = [], matters: string[] = [], roles: string[] = [], groups: string[] = [];
async function fixture() {
  const user = await db.user.create({ data: { name: "合成采用律师", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  users.push(user.id);
  const matter = await db.matter.create({ data: { title: "合成采用事项", internalCode: `ADOPTION-${randomUUID()}`, ownerId: user.id } }); matters.push(matter.id);
  const actor = { id: user.id, role: user.role, runtimeMode: "SERVER" as const };
  vi.mocked(requireSession).mockResolvedValue({ user: actor, expires: "2099-01-01" } as Awaited<ReturnType<typeof requireSession>>);
  return { actor, matter };
}
function context(matterId: string, extra: Partial<ContextRecordInput> = {}): ContextRecordInput {
  return { matterId, requestKey: randomUUID(), kind: "GOAL", visibility: "MATTER", content: "合成客户目标", sourceDescription: "合成电话说明",
    occurredAt: new Date().toISOString(), ...extra };
}
async function selected(f: Awaited<ReturnType<typeof fixture>>, recordId: string) {
  return (await readContextInputChoice(db, f.actor, f.matter.id, recordId)).selection;
}
function original(f: Awaited<ReturnType<typeof fixture>>) {
  const bytes = Buffer.from("合成出稿原件");
  return { userId: f.actor.id, requestKey: randomUUID(), bytes, document: { name: "合成稿.txt", matterId: f.matter.id,
    category: "OTHER" as const, mimeType: "text/plain", size: bytes.length, sha256: sha256(bytes), encrypted: false, uploadedById: f.actor.id, tags: [] } };
}

describe.skipIf(!config.url)("G15 实际采用入口、当前授权与不可变关系 / PostgreSQL", () => {
  beforeAll(async () => { await db.$connect(); });
  beforeEach(() => { config.afterWrite = undefined; });
  afterAll(async () => {
    const intents = await db.materialIngestIntent.findMany({ where: { requestedById: { in: users } }, select: { id: true } });
    const runs = await db.documentParseRun.findMany({ where: { requestedById: { in: users } }, select: { id: true } });
    await db.jobQueue.updateMany({ where: { dedupeKey: { in: [...intents.map(row => `document.ingest:${row.id}`), ...runs.map(row => `document.parse:${row.id}`)] }, status: { not: "SUCCESS" } },
      data: { status: "DEAD", leaseToken: null, leaseUntil: null, lastError: "合成采用场景已结束" } });
    await db.document.updateMany({ where: { matterId: { in: matters } }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groups } }, data: { active: false } });
    config.files.clear(); await db.$disconnect();
  });

  it("OPTION公开Action并发采用只保存一次；仅确认变化可见，成功重放不被后来版本阻断", async () => {
    const f = await fixture(), goal = await saveMatterContext(db, f.actor, context(f.matter.id));
    const selection = (await getMatterContextInputChoice(f.matter.id, goal.id)).selection;
    const input = context(f.matter.id, { kind: "OPTION", content: "合成明确方案", contextInputs: [selection] });
    const results = await Promise.all([recordMatterContext(input), recordMatterContext(input)]);
    expect(results.map(row => row.replayed).sort()).toEqual([false, true]);
    const option = results[0];
    expect(await db.optionContextInput.count({ where: { optionRecordId: option.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: option.id, action: "MATTER_CONTEXT_CREATE" } })).toBe(1);
    await confirmMatterContext(db, f.actor, { matterId: f.matter.id, id: goal.id, expectedVersion: 1, acknowledged: true });
    expect((await readMatterContextRecord(db, f.actor, f.matter.id, option.id)).contextInputs?.inputs[0]).toMatchObject({ historical: false, changed: true, adoptedConfirmedAt: null });
    expect((await recordMatterContext(input)).replayed).toBe(true);
    await expect(saveMatterContext(db, f.actor, { ...input, requestKey: randomUUID() })).rejects.toThrow("确认变化");
    const goal2 = await saveMatterContext(db, f.actor, context(f.matter.id, { supersedesId: goal.id, content: "合成新目标" }));
    const historic = await selected(f, goal.id);
    const option2 = await saveMatterContext(db, f.actor, context(f.matter.id, { kind: "OPTION", contextInputs: [historic] }));
    expect((await readMatterContextRecord(db, f.actor, f.matter.id, option2.id)).contextInputs?.inputs[0]).toMatchObject({ historical: true, changed: false });
    await confirmMatterContext(db, f.actor, { matterId: f.matter.id, id: goal2.id, expectedVersion: 2, acknowledged: true });
    expect((await readMatterContextRecord(db, f.actor, f.matter.id, option2.id)).contextInputs?.inputs[0].changed).toBe(false);
    await saveMatterContext(db, f.actor, context(f.matter.id, { supersedesId: goal2.id }));
    expect((await readMatterContextRecord(db, f.actor, f.matter.id, option2.id)).contextInputs?.inputs[0]).toMatchObject({ historical: true, changed: true });
    await expect(saveMatterContext(db, f.actor, context(f.matter.id, { supersedesId: option2.id, kind: "OPTION" }))).rejects.toThrow("明确沿用或调整");
    const cleared = await saveMatterContext(db, f.actor, context(f.matter.id, { supersedesId: option2.id, kind: "OPTION", contextInputs: [] }));
    expect(await db.optionContextInput.count({ where: { optionRecordId: cleared.id } })).toBe(0);
    const key = { optionRecordId_contextRecordId: { optionRecordId: option.id, contextRecordId: goal.id } };
    await expect(db.optionContextInput.update({ where: key, data: { adoptedConfirmedAt: new Date() } })).rejects.toThrow();
    await expect(db.optionContextInput.delete({ where: key })).rejects.toThrow();
    expect((await db.matterContextRecord.findUniqueOrThrow({ where: { id: goal.id } })).version).toBe(1);
  });

  it("原OPTION的FINANCE采用限制正文、更正、确认及重放；无选择仍可正常记录", async () => {
    const f = await fixture(), goal = await saveMatterContext(db, f.actor, context(f.matter.id, { visibility: "FINANCE", content: "合成保密预算指示" }));
    const option = await saveMatterContext(db, f.actor, context(f.matter.id, { kind: "OPTION", contextInputs: [await selected(f, goal.id)] }));
    const name = `adoption-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: [
      { permissionKey: "matters.read", scope: "OWN" }, { permissionKey: "matters.write", scope: "OWN" },
      { permissionKey: "documents.download", scope: "OWN" }, { permissionKey: "documents.write", scope: "OWN" },
    ] } } }); roles.push(role.id);
    const member = await db.user.create({ data: { role: "CUSTOM", roleDefinitionId: role.id, name: "合成受限协办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only" } }); users.push(member.id);
    await db.matterMember.create({ data: { matterId: f.matter.id, userId: member.id, role: "CO_LEAD" } });
    const actor = { id: member.id, role: member.role };
    const visible = await readMatterContext(db, actor, f.matter.id);
    expect(visible.records.find(row => row.id === option.id)).toMatchObject({ readable: false, content: null, contextInputs: { inputs: [], unavailable: true } });
    await expect(readMatterContextRecord(db, actor, f.matter.id, option.id)).rejects.toThrow("无权读取");
    await expect(saveMatterContext(db, actor, context(f.matter.id, { kind: "OPTION", supersedesId: option.id, contextInputs: [] }))).rejects.toThrow("原方案采用");
    await expect(confirmMatterContext(db, actor, { matterId: f.matter.id, id: option.id, expectedVersion: 1, acknowledged: true })).rejects.toThrow("方案采用");
    await expect(saveMatterContext(db, actor, context(f.matter.id, { kind: "OPTION", contextInputs: [await selected(f, goal.id)] }))).rejects.toThrow("无权读取");
    expect((await saveMatterContext(db, actor, context(f.matter.id, { kind: "OPTION", contextInputs: [] }))).ok).toBe(true);
  });

  it("普通上传及新版本Action保存确切输入，元数据和同键指纹不丢选择，失权不重放", async () => {
    const f = await fixture(), goal = await saveMatterContext(db, f.actor, context(f.matter.id));
    const selection = await selected(f, goal.id), key = randomUUID();
    const form = new FormData(); form.set("matterId", f.matter.id); form.set("name", "合成上传.pdf"); form.set("category", "OTHER");
    form.set("file", new File(["%PDF-1.4\nsynthetic"], "合成上传.pdf", { type: "application/pdf" }));
    form.set("requestKey", key); form.set("contextInputs", JSON.stringify([selection]));
    const saved = await uploadDocument(form);
    if (!saved.ok) throw new Error(saved.message);
    expect(await db.documentContextInput.findFirst({ where: { documentId: saved.id } })).toMatchObject({ contextRecordId: goal.id, currentRecordIdAtAdoption: goal.id, adoptedConfirmedAt: null });
    // This is still an unapproved single-version upload with no other references.
    await expect(assertDocumentCanBePurged(db, saved.id)).rejects.toThrow("须保留原件");
    const nextGoal = await saveMatterContext(db, f.actor, context(f.matter.id, { supersedesId: goal.id }));
    expect(await uploadDocument(form)).toEqual(saved);
    form.set("contextInputs", "[]"); await expect(uploadDocument(form)).rejects.toThrow("其他内容");
    const file = new File(["%PDF-1.4\nsynthetic-v2"], "新稿.pdf", { type: "application/pdf" });
    await expect(uploadNewVersion({ documentId: saved.id, file, requestKey: randomUUID() })).rejects.toThrow("明确沿用或调整");
    await expect(uploadNewVersion({ documentId: saved.id, file, requestKey: randomUUID(), contextInputs: [selection] })).rejects.toThrow("新修订或确认变化");
    const newInput = { documentId: saved.id, file, requestKey: randomUUID(), contextInputs: [await selected(f, goal.id)] };
    const revised = await uploadNewVersion(newInput);
    expect(await uploadNewVersion(newInput)).toEqual(revised);
    expect(await db.documentContextInput.findFirst({ where: { documentId: revised.id } })).toMatchObject({ contextRecordId: goal.id, currentRecordIdAtAdoption: nextGoal.id });
    expect((await getDocumentDetail(f.matter.id, revised.id)).contextInputs.inputs[0]).toMatchObject({ historical: true, changed: false });
    await db.user.update({ where: { id: f.actor.id }, data: { active: false } });
    await expect(uploadNewVersion(newInput)).rejects.toThrow();
  });

  it.each(["确认变化", "来源撤回"])("存储与提交间%s时不发布文书、关系或上传审计", async change => {
    const f = await fixture();
    const source = change === "来源撤回" ? await ingestMaterial(original(f)) : null;
    const goal = await saveMatterContext(db, f.actor, context(f.matter.id, { sourceDocumentId: source?.id }));
    const documentCount = await db.document.count({ where: { matterId: f.matter.id } });
    const auditCount = await db.auditLog.count({ where: { userId: f.actor.id, action: "DOCUMENT_UPLOAD" } });
    const data = { ...original(f), contextInputs: [await selected(f, goal.id)] };
    config.afterWrite = async () => {
      config.afterWrite = undefined;
      if (source) await db.document.update({ where: { id: source.id }, data: { deletedAt: new Date() } });
      else await confirmMatterContext(db, f.actor, { matterId: f.matter.id, id: goal.id, expectedVersion: 1, acknowledged: true });
    };
    const reason = source ? "无权读取" : "确认变化";
    await expect(ingestMaterial(data)).rejects.toThrow(reason);
    expect(await db.materialIngestIntent.findUnique({ where: { id: data.requestKey } })).toMatchObject({ state: "STORED", documentId: null });
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(documentCount);
    expect(await db.documentContextInput.count({ where: { contextRecordId: goal.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { userId: f.actor.id, action: "DOCUMENT_UPLOAD" } })).toBe(auditCount);
    await expect(ingestMaterial(data)).rejects.toThrow(reason);
    if (!source) {
      const saved = await ingestMaterial({ ...data, requestKey: randomUUID(), contextInputs: [await selected(f, goal.id)] });
      expect(await db.documentContextInput.count({ where: { documentId: saved.id } })).toBe(1);
    }
  });

  it("研究分析稿和人工简报使用真实生成入口，输入只属于新Document；原请求重放与简报新稿保留守卫", async () => {
    const f = await fixture(), goal = await saveMatterContext(db, f.actor, context(f.matter.id, { kind: "INSTRUCTION" }));
    const selection = await selected(f, goal.id);
    const research = await saveResearch(db, f.actor, { ...emptyResearchContent(), matterId: f.matter.id, requestKey: randomUUID(), supersedesId: null, expectedVersion: null, question: "合成实际研究问题" });
    const draftInput = { matterId: f.matter.id, researchRevisionId: research.id, requestKey: randomUUID(), contextInputs: [selection] };
    const draft = await createResearchDraft(db, f.actor, draftInput);
    const briefInput = { matterId: f.matter.id, requestKey: randomUUID(), title: "合成实际客户简报", content: "合成待客户核实内容", contextInputs: [selection] };
    const brief = await createClientBrief(briefInput);
    expect(await db.documentContextInput.count({ where: { documentId: { in: [draft.documentId, brief.id] } } })).toBe(2);
    expect((await db.document.findUniqueOrThrow({ where: { id: brief.id } })).status).toBe("DRAFT");
    await saveMatterContext(db, f.actor, context(f.matter.id, { supersedesId: goal.id, kind: "INSTRUCTION" }));
    expect((await createResearchDraft(db, f.actor, draftInput)).documentId).toBe(draft.documentId);
    expect(await createClientBrief(briefInput)).toEqual(brief);
    await expect(createResearchDraft(db, f.actor, { ...draftInput, contextInputs: [] })).rejects.toThrow("生成标识");
    const { contextInputs: ignored, ...withoutInputs } = briefInput; void ignored;
    await expect(createClientBrief({ ...withoutInputs, requestKey: randomUUID(), priorDocumentId: brief.id })).rejects.toThrow("明确沿用或调整");
    const nextBrief = await createClientBrief({ ...briefInput, requestKey: randomUUID(), priorDocumentId: brief.id, contextInputs: [] });
    expect(nextBrief.id).not.toBe(brief.id);
    expect(await db.documentContextInput.count({ where: { documentId: nextBrief.id } })).toBe(0);
    expect(await db.deliveryRecord.count({ where: { matterId: f.matter.id } })).toBe(0);
  });

  it("原件或Note撤回立即阻断采用成果；数据库拒绝跨案、类型错误和错误末版", async () => {
    const f = await fixture(), other = await fixture();
    const source = await ingestMaterial(original(f));
    const goal = await saveMatterContext(db, f.actor, context(f.matter.id, { sourceDocumentId: source.id }));
    const request = { ...original(f), contextInputs: [await selected(f, goal.id)] }, output = await ingestMaterial(request);
    const document = await db.document.findUniqueOrThrow({ where: { id: output.id } });
    expect(await canReadDocument(f.actor.id, document, db)).toBe(true);
    const foreign = await ingestMaterial(original(other));
    await expect(db.documentContextInput.create({ data: { documentId: foreign.id, contextRecordId: goal.id, currentRecordIdAtAdoption: goal.id } })).rejects.toThrow();
    const constraint = await saveMatterContext(db, f.actor, context(f.matter.id, { kind: "CONSTRAINT" }));
    await expect(db.documentContextInput.create({ data: { documentId: output.id, contextRecordId: constraint.id, currentRecordIdAtAdoption: constraint.id } })).rejects.toThrow();
    const wrongTail = await saveMatterContext(db, f.actor, context(f.matter.id));
    const independent = await ingestMaterial(original(f));
    await expect(db.documentContextInput.create({ data: { documentId: independent.id, contextRecordId: goal.id, currentRecordIdAtAdoption: wrongTail.id } })).rejects.toThrow("position or confirmation");
    await db.document.update({ where: { id: source.id }, data: { deletedAt: new Date() } });
    expect(await canReadDocument(f.actor.id, document, db)).toBe(false);
    expect(await readDocumentContextInputs(db, f.actor.id, document.id, f.matter.id)).toEqual({ inputs: [], unavailable: true });
    await expect(ingestMaterial(request)).rejects.toThrow("无权读取");
    const note = await db.note.create({ data: { matterId: f.matter.id, authorId: f.actor.id, occurredAt: new Date(), content: "合成原沟通", tags: [], attachments: [] } });
    const fromNote = await saveMatterContext(db, f.actor, context(f.matter.id, { sourceNoteId: note.id }));
    const noteOutput = await ingestMaterial({ ...original(f), contextInputs: [await selected(f, fromNote.id)] });
    await db.note.update({ where: { id: note.id }, data: { deletedAt: new Date() } });
    expect(await canReadDocument(f.actor.id, await db.document.findUniqueOrThrow({ where: { id: noteOutput.id } }), db)).toBe(false);
  });

  it("真实报告来源链保留独立审批正文资格，原指示/报告/原件不随之开放，真实原件撤回后正文拒绝", async () => {
    const f = await fixture(), stored = await ingestMaterial(original(f));
    const source = await db.document.findUniqueOrThrow({ where: { id: stored.id } });
    const review = await db.reviewRecord.create({ data: { matterId: f.matter.id, documentId: source.id, reviewedById: f.actor.id,
      itemCount: 0, itemsJson: [], textPreviewChars: 20, sourceSha256: source.sha256,
      coverageJson: { totalChars: 20, totalSegments: 1, segments: [{ index: 1, chars: 20, status: "SUCCEEDED", errorCode: null }], stopReason: null },
    } });
    const savedReport = await saveReviewToMatter({ matterId: f.matter.id, documentId: source.id, recordId: review.id });
    const report = await db.document.findUniqueOrThrow({ where: { id: savedReport.documentId } });
    expect(await db.reviewRecord.findUniqueOrThrow({ where: { id: review.id } })).toMatchObject({ reportDocumentId: report.id, sourceSha256: source.sha256 });
    const goal = await saveMatterContext(db, f.actor, context(f.matter.id, { sourceDocumentId: report.id }));
    const saved = await ingestMaterial({ ...original(f), contextInputs: [await selected(f, goal.id)] });
    // Only the submitted status is fixture data; report generation and every current grant below are real services.
    const output = await db.document.update({ where: { id: saved.id }, data: { status: "PENDING_REVIEW" } });
    const name = `adoption-approval-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name } }); roles.push(role.id);
    const reviewer = await db.user.create({ data: { name: "合成仅审批人", email: `${randomUUID()}@example.invalid`, role: "CUSTOM", roleDefinitionId: role.id, passwordHash: "disabled-test-only" } }); users.push(reviewer.id);
    const group = await db.approvalPermissionGroup.create({ data: { name, members: { create: { userId: reviewer.id } },
      rules: { create: { action: "DOCUMENT_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } }); groups.push(group.id);
    expect(await canReadDocument(reviewer.id, output, db)).toBe(true);
    expect(await canReadDocument(reviewer.id, report, db)).toBe(false);
    expect(await canReadDocument(reviewer.id, source, db)).toBe(false);
    expect(await readDocumentContextInputs(db, reviewer.id, output.id, f.matter.id)).toEqual({ inputs: [], unavailable: true });
    await expect(readMatterContextRecord(db, reviewer, f.matter.id, goal.id)).rejects.toThrow("无权读取");
    for (const purpose of ["EXPORT", "SUBMIT"] as const) await expect(assertDocumentDerivationAccess(reviewer.id, output.id, { purpose, db })).rejects.toThrow();
    const submittedReport = await db.document.update({ where: { id: report.id }, data: { status: "PENDING_REVIEW" } });
    expect(await documentReadGrant(reviewer.id, submittedReport, db)).toBe("DOCUMENT_APPROVAL");
    expect(await canReadDocument(reviewer.id, submittedReport, db)).toBe(false);
    expect(await canReadDocument(reviewer.id, output, db)).toBe(true);
    await db.document.update({ where: { id: source.id }, data: { deletedAt: new Date() } });
    expect(await canReadDocument(reviewer.id, output, db)).toBe(false);
  });
});
