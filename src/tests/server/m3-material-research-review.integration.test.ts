// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceActor } from "@/lib/runtime/actor";
import { decryptBuffer, sha256 } from "@/lib/storage/crypto";
import { createM3Docx, createM3FormatWorkPackage, M3_XLSX_MIME, type M3FormatFile } from "../fixtures/m3-format-work-packages";
import type { SourceInput } from "@/server/evidence/contracts";
import { emptyLawMetadata, emptyResearchContent, type ResearchContent } from "@/server/research/contracts";
import type { MaterialSourceListItem } from "@/server/documents/material-processing";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("真实格式工作包仅允许隔离的 _test 数据库");
  return { url, actor: null as WorkspaceActor | null, files: new Map<string, Buffer>() };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/formats_test") };
});
vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async () => ({ user: config.actor })),
  getSession: vi.fn(async () => ({ user: config.actor })),
  requireWorkspaceConfiguration: vi.fn(async () => { throw new Error("本轮工作包不修改全局配置"); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Controlled session/cache/blob boundaries only. Real bytes, encryption, services,
// authorization, PostgreSQL, immutable parse snapshots and audit remain in use.
// This is SERVER engineering evidence, not HTTP/browser or professional acceptance.
vi.mock("@/lib/storage", () => ({ storage: {
  writeFile: vi.fn(async (directory: string, bytes: Buffer) => {
    const path = `${directory}/${randomUUID()}.bin`;
    config.files.set(path, Buffer.from(bytes)); return path;
  }),
  writeFileAt: vi.fn(async (path: string, bytes: Buffer) => { config.files.set(path, Buffer.from(bytes)); }),
  readFile: vi.fn(async (path: string) => {
    const bytes = config.files.get(path);
    if (!bytes) throw new Error("本轮合成原件不存在");
    return Buffer.from(bytes);
  }),
  deleteFile: vi.fn(async (path: string) => { config.files.delete(path); }),
} }));

import { prisma as db } from "@/lib/prisma";
import { resolveRoleUser } from "@/lib/roles/service";
import { canReadDocument } from "@/lib/approvals/documents";
import { completeJob } from "@/server/cron/queue";
import { processMaterialJob } from "@/server/documents/material-processing";
import { getMaterialProcessingStatuses, getMaterialSource, listMaterialSources, retryMaterialProcessing } from "@/server/documents/processing-actions";
import { approveDocument, submitDocumentForReview, uploadDocument, uploadNewVersion } from "@/server/documents/actions";
import { addEvidenceSource, confirmEvidenceItem, createEvidenceItem, getEvidenceItem, listEvidenceRevisions, resolveEvidenceSource } from "@/server/evidence/actions";
import { readResearch, readResearchOptions, readResearchSource, saveResearch } from "@/server/research/service";
import { createResearchDraft } from "@/server/research/draft";
import { prepareTemplate, renderTemplate } from "@/server/document-templates/actions";
import { checkReviewIssue, createReviewIssue, getDocumentReview, getDocumentReviewPositionOptions, getSavedDocumentReviewPosition, respondReviewIssue } from "@/server/document-reviews/actions";

const users: string[] = [], matters: string[] = [], clients: string[] = [];
const groups: string[] = [], templates: string[] = [], templateBlobs: string[] = [];
const scenarios = [
  { kind: "civil", name: "诉讼真实格式→事实争点→研究与模板→定位复核及独立批准", category: "CIVIL_COMMERCIAL", procedure: "FIRST_INSTANCE" },
  { kind: "arbitration", name: "仲裁真实格式→事实争点→研究与模板→定位复核及独立批准", category: "COMMERCIAL_ARBITRATION", procedure: "COMMERCIAL_ARBITRATION" },
] as const;

async function fixture(scenario: typeof scenarios[number]) {
  const owner = await db.user.create({ data: { name: "合成经办律师", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  users.push(owner.id);
  const reviewer = await db.user.create({ data: { name: "合成本案独立复核律师", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  users.push(reviewer.id);
  const group = await db.approvalPermissionGroup.create({ data: { name: `合成格式审批-${randomUUID()}`,
    members: { create: { userId: reviewer.id } }, rules: { create: { action: "DOCUMENT_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } });
  groups.push(group.id);
  const client = await db.client.create({ data: { name: "合成格式委托人", type: "COMPANY", phone: "主档原电话", ownerUserId: owner.id, tags: [] } });
  clients.push(client.id);
  const matter = await db.matter.create({ data: { title: `合成${scenario.kind}格式工作包`, internalCode: `M3-FORMAT-${randomUUID()}`,
    category: scenario.category, ownerId: owner.id, primaryClientId: client.id, serviceScope: "仅工程合成验收，专业验收待完成" } });
  matters.push(matter.id);
  await db.matterMember.create({ data: { matterId: matter.id, userId: reviewer.id, role: "CO_LEAD" } });
  const party = await db.party.create({ data: { matterId: matter.id, role: "OPPOSING_PARTY", name: "合成选中对方", phone: "对方原电话", ordinal: 1 } });
  const procedure = await db.matterProcedure.create({ data: { matterId: matter.id, type: scenario.procedure, order: 1,
    leadLawyerId: owner.id, engagement: "ENGAGED", status: "PENDING", handlingAgency: "合成程序受理机构（未核实真实机构）" } });
  const actor: WorkspaceActor = { id: owner.id, name: owner.name, email: owner.email, avatar: owner.avatar, systemRole: owner.systemRole,
    ...await resolveRoleUser(owner.id, owner.role), runtimeMode: "SERVER" };
  const reviewerActor: WorkspaceActor = { id: reviewer.id, name: reviewer.name, email: reviewer.email, avatar: reviewer.avatar, systemRole: reviewer.systemRole,
    ...await resolveRoleUser(reviewer.id, reviewer.role), runtimeMode: "SERVER" };
  config.actor = actor;
  return { owner, reviewer, actor, reviewerActor, client, matter, party, procedure };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

function asFile(file: M3FormatFile) {
  return new File([new Uint8Array(file.bytes)], file.name, { type: file.mimeType });
}
async function upload(f: Fixture, file: M3FormatFile) {
  const form = new FormData();
  form.set("file", asFile(file)); form.set("name", file.name); form.set("matterId", f.matter.id);
  form.set("procedureId", f.procedure.id); form.set("category", "EVIDENCE"); form.set("encrypted", "true");
  form.set("sourceOrigin", "CLIENT_PROVIDED"); form.set("requestKey", randomUUID());
  const result = await uploadDocument(form);
  if (!result.ok) throw new Error(result.message);
  const document = await db.document.findUniqueOrThrow({ where: { id: result.id } });
  expect(document).toMatchObject({ sha256: sha256(file.bytes), size: file.bytes.length, encrypted: true, uploadedById: f.owner.id });
  expect(originalBytes(document)).toEqual(file.bytes);
  return document;
}
function originalBytes(document: { path: string; encrypted: boolean; iv: string | null; authTag: string | null; sha256: string | null; size: number | null }) {
  const stored = config.files.get(document.path);
  if (!stored) throw new Error("本轮原件缺失");
  const bytes = document.encrypted ? decryptBuffer(stored, document.iv!, document.authTag!) : stored;
  expect(sha256(bytes)).toBe(document.sha256); expect(bytes.length).toBe(document.size);
  return bytes;
}

/** No worker, global claim, synthetic anchor or hand-written published snapshot. */
async function processExactDocument(f: Fixture, documentId: string) {
  const [pending] = await getMaterialProcessingStatuses({ matterId: f.matter.id, documentIds: [documentId] });
  expect(pending).toMatchObject({ documentId, state: "PENDING", inProgress: true });
  if (!pending.runId) throw new Error("真实上传未产生解析任务");
  const runId = pending.runId;
  const run = await db.documentParseRun.findUniqueOrThrow({ where: { id: runId } });
  expect(run).toMatchObject({ documentId, requestedById: f.owner.id, generation: pending.generation });
  const queued = await db.jobQueue.findUniqueOrThrow({ where: { dedupeKey: `document.parse:${runId}` } });
  expect(queued).toMatchObject({ type: "document.parse", payload: { runId }, status: "PENDING" });
  const lease = { id: queued.id, leaseToken: randomUUID() };
  await db.jobQueue.update({ where: { id: queued.id, status: "PENDING" }, data: {
    status: "RUNNING", leaseToken: lease.leaseToken, leaseUntil: new Date(Date.now() + 300_000),
  } });
  await processMaterialJob({ runId }, lease);
  expect(await completeJob(lease)).toBe(true);
  const [status] = await getMaterialProcessingStatuses({ matterId: f.matter.id, documentIds: [documentId] });
  expect(status.runId).toBe(runId); expect(status.inProgress).toBe(false);
  expect(["READY", "PARTIAL"]).toContain(status.state);
  const listed = await listMaterialSources({ matterId: f.matter.id, documentIds: [documentId], limit: 100 });
  expect(listed.nextOffset).toBeNull(); expect(listed.items.length).toBeGreaterThan(0);
  const document = await db.document.findUniqueOrThrow({ where: { id: documentId } });
  const sources = [];
  for (const item of listed.items) {
    const source = await getMaterialSource({ documentId, runId: item.runId, anchorId: item.anchorId });
    if (source.status !== "AVAILABLE") throw new Error("刚发布的固定来源不可读取");
    expect(item).toMatchObject({ documentId, documentSha256: document.sha256, runId });
    expect(source).toMatchObject({ document: { id: documentId, sha256: document.sha256 }, run: { id: runId },
      anchor: { anchorId: item.anchorId, parseGenerationId: runId, source: { documentId, matterId: f.matter.id, sha256: document.sha256 } } });
    sources.push({ item, source });
  }
  return { document, runId, status, sources };
}
type Processed = Awaited<ReturnType<typeof processExactDocument>>;
function sourceContaining(processed: Processed, text: string) {
  const source = processed.sources.find(source => source.source.anchor.text.includes(text));
  if (!source) throw new Error(`实际解析来源中未找到：${text}`);
  return source.item;
}
function reference(item: MaterialSourceListItem, relation: SourceInput["relation"]): SourceInput {
  return { documentId: item.documentId, parseRunId: item.runId, anchorId: item.anchorId, relation };
}
function position(item: MaterialSourceListItem) { return { parseRunId: item.runId, anchorId: item.anchorId }; }

async function evidence(f: Fixture, kind: "FACT" | "CLAIM" | "ISSUE", content: string, sources: SourceInput[], confirm: boolean) {
  const created = await createEvidenceItem({ requestKey: randomUUID(), matterId: f.matter.id, kind, title: `${kind}：${content.slice(0, 60)}`, content });
  let revision = (await getEvidenceItem(created.id)).item.revision;
  for (const source of sources) {
    const linked = await addEvidenceSource({ evidenceItemId: created.id, expectedRevision: revision, ...source });
    expect(linked.revision).toBeGreaterThan(revision); revision = linked.revision;
    const resolved = await resolveEvidenceSource({ evidenceItemId: created.id, sourceId: linked.sourceId, revision });
    expect(resolved).toMatchObject({ status: "AVAILABLE", legacy: false });
  }
  if (confirm) expect((await confirmEvidenceItem({ evidenceItemId: created.id, expectedRevision: revision, confirm: true })).revision).toBe(revision);
  const { item } = await getEvidenceItem(created.id);
  expect(item).toMatchObject({ kind, revision, content });
  expect(Boolean(item.confirmedAt)).toBe(confirm);
  expect((await listEvidenceRevisions({ evidenceItemId: created.id })).items.length).toBe(sources.length);
  return item;
}

async function parallelTemplate(f: Fixture) {
  const variables = ["client.name", "client.phone", "opposing.name", "opposing.phone", "proceeding.court"];
  const file = await createM3Docx("合成主体程序核对模板.docx", variables.map(path => `{{${path}}}`));
  const blob = await db.document.create({ data: { name: file.name, path: `m3-format-template/${randomUUID()}.docx`,
    uploadedById: f.owner.id, mimeType: file.mimeType, size: file.bytes.length, sha256: sha256(file.bytes), tags: ["合成验收"] } });
  templateBlobs.push(blob.id); config.files.set(blob.path, file.bytes);
  const template = await db.documentTemplate.create({ data: { name: "合成主体程序核对模板", category: "LITIGATION", applicableCategories: [],
    variables, docxBlobId: blob.id, createdById: f.owner.id } }); templates.push(template.id);
  const prepared = await prepareTemplate({ matterId: f.matter.id, templateId: template.id,
    selection: { clientId: f.client.id, opposingPartyId: f.party.id, thirdPartyId: null, procedureId: f.procedure.id } });
  expect(prepared.fields.find(field => field.path === "client.phone")?.value).toBe(f.client.phone);
  const generated = await renderTemplate({ requestKey: randomUUID(), matterId: f.matter.id, templateId: prepared.templateId,
    templateUpdatedAt: prepared.templateUpdatedAt, selection: prepared.selection, expectedValues: prepared.expectedValues,
    expectedSubjects: prepared.expectedSubjects, overrides: { "client.phone": "仅本稿补填电话", "opposing.phone": "仅本稿对方电话" }, reviewed: true, folderId: null });
  const document = await db.document.findUniqueOrThrow({ where: { id: generated.documentId } });
  expect(document).toMatchObject({ status: "DRAFT", approvedById: null, procedureId: f.procedure.id,
    templateContextSnapshot: { selection: prepared.selection, templateSource: { documentId: blob.id, sha256: blob.sha256 },
      context: { client: { phone: "仅本稿补填电话" }, opposing: { name: f.party.name, phone: "仅本稿对方电话" }, proceeding: { court: f.procedure.handlingAgency } } } });
  const xml = new PizZip(originalBytes(document)).file("word/document.xml")!.asText();
  for (const text of [f.client.name, f.party.name, f.procedure.handlingAgency!, "仅本稿补填电话", "仅本稿对方电话"]) expect(xml).toContain(text);
  expect(xml).not.toContain("{{"); expect(xml).not.toContain("主档原电话");
  expect(await db.client.findUniqueOrThrow({ where: { id: f.client.id } })).toEqual(f.client);
  expect(await db.party.findUniqueOrThrow({ where: { id: f.party.id } })).toEqual(f.party);
    expect(await db.documentResearchSource.count({ where: { documentId: document.id } })).toBe(0);
  expect(await db.documentParseRun.count({ where: { documentId: document.id } })).toBe(1);
  await processExactDocument(f, document.id); // Already enqueued by renderTemplate; no retry.
  return document;
}

describe.skipIf(!config.url)("M3 两类真实格式工作包：真实 PG 服务集成", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    // Only jobs owned by these newly created users. Keep intents, parse snapshots,
    // citations, research/review revisions and audit; do not mutate global policy.
    const runs = await db.documentParseRun.findMany({ where: { requestedById: { in: users } }, select: { id: true } });
    const intents = await db.materialIngestIntent.findMany({ where: { requestedById: { in: users } }, select: { id: true } });
    const keys = [...runs.map(run => `document.parse:${run.id}`), ...intents.map(intent => `document.ingest:${intent.id}`)];
    await db.jobQueue.updateMany({ where: { dedupeKey: { in: keys }, status: { not: "SUCCESS" } },
      data: { status: "DEAD", leaseToken: null, leaseUntil: null, lastError: "本轮合成格式工作包已结束" } });
    expect(await db.jobQueue.count({ where: { dedupeKey: { in: keys }, status: { in: ["PENDING", "RUNNING"] } } })).toBe(0);
    await db.documentTemplate.updateMany({ where: { id: { in: templates } }, data: { enabled: false } });
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groups } }, data: { active: false } });
    await db.document.updateMany({ where: { OR: [{ matterId: { in: matters } }, { id: { in: templateBlobs } }] }, data: { deletedAt: new Date() } });
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    config.actor = null; config.files.clear(); await db.$disconnect();
  });

  for (const scenario of scenarios) it(scenario.name, async () => {
    const f = await fixture(scenario);
    const work = await createM3FormatWorkPackage(scenario.kind);
    expect(work).toMatchObject({ provenance: "SYNTHETIC", professionalReview: "PENDING", runtimeMode: "SERVER" });
    const contract = await processExactDocument(f, (await upload(f, work.contract)).id);
    const recorded = await processExactDocument(f, (await upload(f, work.recorded)).id);
    const claim = await processExactDocument(f, (await upload(f, work.claim)).id);
    const oldVersion = await processExactDocument(f, (await upload(f, work.versionOriginal)).id);
    const pdf = await processExactDocument(f, (await upload(f, work.pdf)).id);
    expect(new PizZip(work.contract.bytes).file("word/document.xml")!.asText()).toContain("<w:tbl>");
    expect(contract.sources.every(source => source.item.location.kind === "TEXT")).toBe(true);
    const spreadsheet = work.versionOriginal.mimeType === M3_XLSX_MIME ? oldVersion : recorded;
    expect(spreadsheet.status.state).toBe("PARTIAL"); expect(spreadsheet.status.coverage?.unsupported).toHaveLength(1);
    expect(spreadsheet.sources.map(source => source.item.location)).toContainEqual({ kind: "TABLE", sheet: "付款台账", rowStart: 8, rowEnd: 8, columnStart: 3, columnEnd: 3 });
    expect(spreadsheet.sources.some(source => source.item.location.kind === "TABLE" && source.item.location.rowStart === 10 && source.item.location.columnStart === 6)).toBe(false);
    expect(pdf.status).toMatchObject({ state: "PARTIAL", coverage: { unitKind: "PAGE", totalUnits: 3, ready: 2, pending: [2], failed: [], unsupported: [] } });
    expect(pdf.sources.map(source => source.item.location)).toEqual([{ kind: "PAGE", page: 1 }, { kind: "PAGE", page: 3 }]);
    expect(pdf.document.pageCount).toBe(3);
    const pdfFile = await PDFDocument.load(originalBytes(pdf.document));
    const imageObjects = pdfFile.getPages()[1].node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
    expect(imageObjects.keys().some(key => {
      const image = imageObjects.lookup(key);
      return image instanceof PDFRawStream && image.dict.get(PDFName.of("Subtype"))?.toString() === "/Image"
        && Number(image.dict.get(PDFName.of("Width"))?.toString()) > 100;
    })).toBe(true); // A blank page with no text would not satisfy the image contract.
    const pdfText = await getDocumentProxy(new Uint8Array(work.pdf.bytes));
    try { expect((await (await pdfText.getPage(2)).getTextContent()).items).toHaveLength(0); }
    finally { await pdfText.destroy(); }
    const support = sourceContaining(pdf, work.pdfSupport), rebuttal = sourceContaining(pdf, work.pdfRebuttal);
    const recordedSource = sourceContaining(recorded, work.factText), claimSource = sourceContaining(claim, work.claimText);
    const oldSource = sourceContaining(oldVersion, work.versionOldText), contractSource = contract.sources[0].item;
    await evidence(f, "FACT", `材料载明：${work.factText} 此记录不等于本系统业务到账确认。`, [reference(recordedSource, "SUPPORTS")], true);
    await evidence(f, "CLAIM", work.claimText, [reference(claimSource, "CONTEXT")], false);
    const issue = await evidence(f, "ISSUE", work.question, [reference(support, "SUPPORTS"), reference(rebuttal, "REBUTS"), reference(oldSource, "CONTEXT")], true);
    const selected = (await readResearchOptions(db, f.actor, f.matter.id)).issues.find(item => item.id === issue.id);
    if (!selected) throw new Error("真实研究候选未返回本案争点");
    expect(selected.selection).toMatchObject({ kind: "CURRENT", issueId: issue.id, revision: issue.revision, confirmedAt: issue.confirmedAt!.toISOString() });
    const sourceInputs = [reference(contractSource, "CONTEXT"), reference(recordedSource, "SUPPORTS"), reference(claimSource, "CONTEXT"),
      reference(oldSource, "CONTEXT"), reference(support, "SUPPORTS"), reference(rebuttal, "REBUTS")];
    const content: ResearchContent = { ...emptyResearchContent(), question: work.question, purpose: "合成材料对照及待复核分析稿", issueSelection: selected.selection,
      scope: "只记录合成材料及未知项；PDF 第2页图片未启用 OCR，不宣称读取其内容。未查询外部法源。",
      queryLog: [{ sourceDocumentId: pdf.document.id, query: "阅读三页合成PDF的可用文字层", location: "第1、3页", access: "FULLTEXT", outcome: "READ", notes: "第2页仅图片，尚未识别；不得计为整份已读" },
        { query: "适用法源及真实程序信息", location: "", access: "NONE", outcome: "NOT_OBTAINED", notes: "未取得、未核实" }],
      rule: "尚未取得可核实法源，不能由材料记载推出法律结论。",
      supportingAnalysis: [...work.expected.support, "草稿待纠正引用：验收依据暂误标为付款材料。"].join("；"),
      opposingAnalysis: scenario.kind === "civil" ? work.expected.adverse.join("；") : "客户提出验收异议；真实验收状态待核实。",
      conclusion: "付款条件与最终可主张金额待核实；材料及当事人陈述不能直接作为专业结论。",
      unresolved: work.expected.unknown.join("；"), nextSteps: "补充原件后核对；本稿尚需复核。",
      sources: sourceInputs.map(source => ({ ...source, lawMetadata: emptyLawMetadata() })) };
    const r1 = await saveResearch(db, f.actor, { ...content, matterId: f.matter.id, requestKey: randomUUID(), supersedesId: null, expectedVersion: null });
    const r1View = await readResearch(db, f.actor, f.matter.id, r1.id);
    expect(r1View).toMatchObject({ version: 1, readable: true, checkedAt: null, issue: { id: issue.id, revision: issue.revision } });
    expect(r1View.content?.jurisdiction).toBe(""); expect(r1View.content?.relevantDate).toBe("");
    expect(r1View.sources).toHaveLength(sourceInputs.length);
    expect(r1View.sources).toEqual(expect.arrayContaining(sourceInputs.map(source => expect.objectContaining(source))));
    const parsedSources = [contract, recorded, claim, oldVersion, pdf].flatMap(material => material.sources);
    for (const source of r1View.sources) {
      expect(source.lawMetadata).toEqual(emptyLawMetadata());
      const original = parsedSources.find(parsed => parsed.item.documentId === source.documentId && parsed.item.anchorId === source.anchorId)!;
      expect(await db.researchSource.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({
        documentId: original.item.documentId, documentSha256: original.item.documentSha256,
        parseRunId: original.item.runId, anchorId: original.item.anchorId, location: original.source.anchor.location,
      });
      expect(await getMaterialSource({ documentId: original.item.documentId, runId: original.item.runId, anchorId: original.item.anchorId }))
        .toMatchObject({ status: "AVAILABLE", anchor: original.source.anchor });
      const opened = await readResearchSource(db, f.actor, f.matter.id, r1.id, source.id);
      // The compact research-list label and material-reader label use different
      // presentation wording; the resolved reader must match the actual source.
      expect(opened).toMatchObject({ status: "AVAILABLE", documentVersion: source.version, legacy: false,
        locationLabel: original.item.locationLabel, text: original.source.anchor.text });
    }
    const draft = await createResearchDraft(db, f.actor, { matterId: f.matter.id, researchRevisionId: r1.id, requestKey: randomUUID() });
    const draftRow = await db.document.findUniqueOrThrow({ where: { id: draft.documentId } });
    const draftXml = new PizZip(originalBytes(draftRow)).file("word/document.xml")!.asText();
    expect(draftXml).toContain(r1.id); expect(draftXml).toContain("研究待核对");
    expect(draftXml).not.toContain(work.versionNewText); // V2 has not yet been supplied to this matter.
    for (const unknown of work.expected.unknown) expect(draftXml).toContain(unknown);
    for (const forbidden of work.expected.forbiddenConclusions) expect(draftXml).not.toContain(forbidden);
    expect(await db.documentParseRun.count({ where: { documentId: draft.documentId } })).toBe(0);
    const requested = await retryMaterialProcessing({ documentId: draft.documentId, expectedGeneration: draftRow.parseGeneration });
    const parsedDraft = await processExactDocument(f, draft.documentId);
    expect(parsedDraft.runId).toBe(requested.runId);
    const subject = sourceContaining(parsedDraft, "草稿待纠正引用");

    const uploadedV2 = await uploadNewVersion({ documentId: oldVersion.document.id, requestKey: randomUUID(), file: asFile(work.versionNew) });
    const newVersion = await processExactDocument(f, uploadedV2.id);
    expect(newVersion.document).toMatchObject({ familyId: oldVersion.document.familyId, version: oldVersion.document.version + 1, sha256: sha256(work.versionNew.bytes) });
    expect(newVersion.document.sha256).not.toBe(oldVersion.document.sha256);
    const newSource = sourceContaining(newVersion, work.versionNewText);
    const newExtraSource = work.versionExtraText ? sourceContaining(newVersion, work.versionExtraText) : null;
    expect(await getMaterialSource({ documentId: oldSource.documentId, runId: oldSource.runId, anchorId: oldSource.anchorId })).toMatchObject({ status: "AVAILABLE", document: { version: 1, sha256: oldVersion.document.sha256 } });
    const corrected = ["纠正引用：区分交付/签收记载与质量或服务验收。", ...work.expected.conflicts,
      work.versionNewText, ...work.expected.unknown, "补充未识别的第2页图片原件及付款凭证，再核对适用法源；不确认业务到账。"];
    const r2 = await saveResearch(db, f.actor, { ...content, matterId: f.matter.id, requestKey: randomUUID(), supersedesId: r1.id, expectedVersion: r1.version,
      supportingAnalysis: work.expected.support.join("；"), opposingAnalysis: [...work.expected.adverse, ...work.expected.conflicts].join("；"),
      nextSteps: corrected.join("；"), sources: [...content.sources, ...[newSource, ...(newExtraSource ? [newExtraSource] : [])]
        .map(source => ({ ...reference(source, "CONTEXT"), lawMetadata: emptyLawMetadata() }))] });
    const r2View = await readResearch(db, f.actor, f.matter.id, r2.id);
    expect(r2View.version).toBe(2); expect(r2View.content?.nextSteps).toContain(work.versionNewText);
    expect(r2View.sources).toEqual(expect.arrayContaining([expect.objectContaining(reference(newSource, "CONTEXT"))]));
    if (newExtraSource) expect(r2View.sources).toEqual(expect.arrayContaining([expect.objectContaining(reference(newExtraSource, "CONTEXT"))]));
    const oldResearch = await readResearch(db, f.actor, f.matter.id, r1.id);
    expect(oldResearch.current).toBe(false); expect(oldResearch.content).toEqual(r1View.content);
    expect(oldResearch.sources).toEqual(r1View.sources.map(source => ({ ...source, changed: source.documentId === oldSource.documentId })));
    expect(await db.documentResearchSource.findMany({ where: { documentId: draft.documentId }, select: { researchRevisionId: true } })).toEqual([{ researchRevisionId: r1.id }]);
    expect(originalBytes(await db.document.findUniqueOrThrow({ where: { id: draft.documentId } }))).toEqual(originalBytes(draftRow));
    const template = await parallelTemplate(f);

    await submitDocumentForReview(draft.documentId);
    config.actor = f.reviewerActor;
    expect(f.reviewer.id).not.toBe(f.owner.id);
    expect(await canReadDocument(f.reviewer.id, newVersion.document)).toBe(true);
    const subjectOptions = await getDocumentReviewPositionOptions({ documentId: draft.documentId, slot: "SUBJECT" });
    expect(subjectOptions.items).toContainEqual(subject);
    const reviewSpecs = [
      { title: "错引：验收依据误标付款材料", basis: support, note: "交付/签收记载不能冒充质量或服务验收；应纠正稿件中的付款材料错引。" },
      { title: "金额矛盾：两份付款记载需逐项核对", basis: newExtraSource ?? claimSource, note: work.expected.conflicts.join("；") },
      { title: "遗漏：反向依据与未识别页的补查步骤", basis: rebuttal, note: "应列入反向材料、第2页待识别图片及未决条件的补查步骤。" },
    ];
    const reviews = [];
    for (const spec of reviewSpecs) {
      expect((await getDocumentReviewPositionOptions({ documentId: draft.documentId, slot: "BASIS", sourceDocumentId: spec.basis.documentId })).items).toContainEqual(spec.basis);
      const review = await createReviewIssue({ requestId: randomUUID(), documentId: draft.documentId, title: spec.title,
        location: "真实解析的分析草稿", position: position(subject), basis: spec.note, basisDocumentId: spec.basis.documentId, basisPosition: position(spec.basis) });
      expect(await getSavedDocumentReviewPosition({ issueId: review.id, slot: "SUBJECT" })).toMatchObject({ status: "AVAILABLE", documentVersion: 1, locationLabel: subject.locationLabel });
      expect(await getSavedDocumentReviewPosition({ issueId: review.id, slot: "BASIS" })).toMatchObject({ status: "AVAILABLE", documentVersion: spec.basis.documentVersion, locationLabel: spec.basis.locationLabel });
      reviews.push({ ...review, basis: spec.basis });
    }
    config.actor = f.actor;
    const revisionFile = await createM3Docx("合成分析稿修订V2.docx", ["研究来源仍为原稿固定的 R1；另存 R2 不自动改绑。", ...corrected]);
    const revision = await uploadNewVersion({ documentId: draft.documentId, requestKey: randomUUID(), file: asFile(revisionFile) });
    const parsedRevision = await processExactDocument(f, revision.id), revisionSource = sourceContaining(parsedRevision, "纠正引用");
    expect(originalBytes(parsedRevision.document)).toEqual(revisionFile.bytes);
    expect(parsedRevision.document).toMatchObject({ familyId: draftRow.familyId, version: 2, status: "DRAFT", approvedById: null });
    expect(await db.documentResearchSource.findMany({ where: { documentId: revision.id }, select: { researchRevisionId: true } })).toEqual([{ researchRevisionId: r1.id }]);
    expect((await getDocumentReviewPositionOptions({ documentId: draft.documentId, slot: "REVISION", sourceDocumentId: revision.id })).items).toContainEqual(revisionSource);
    await submitDocumentForReview(revision.id);
    for (const review of reviews) {
      config.actor = f.actor;
      const response = await respondReviewIssue({ requestId: randomUUID(), issueId: review.id, expectedVersion: review.version, disposition: "ACCEPT",
        note: "已在真实DOCX修订版逐项回应，未知项继续保留。", revisionDocumentId: revision.id, revisionLocation: "修订表格的抽取文本", revisionPosition: position(revisionSource) });
      config.actor = f.reviewerActor;
      await checkReviewIssue({ requestId: randomUUID(), issueId: review.id, expectedVersion: response.version, resolved: true,
        note: "工程场景已核对本条修订及固定来源；不代表真实专业验收。" });
    }
    const resolved = await getDocumentReview(draft.documentId);
    expect(resolved.issues).toHaveLength(3);
    for (const issue of resolved.issues) {
      expect(issue.state).toBe("RESOLVED");
      const original = reviews.find(review => review.id === issue.id)!;
      expect(await getSavedDocumentReviewPosition({ issueId: issue.id, slot: "SUBJECT" })).toMatchObject({
        status: "AVAILABLE", documentVersion: 1, locationLabel: subject.locationLabel, text: expect.stringContaining("草稿待纠正引用"),
      });
      expect(await getSavedDocumentReviewPosition({ issueId: issue.id, slot: "BASIS" })).toMatchObject({
        status: "AVAILABLE", documentVersion: original.basis.documentVersion, locationLabel: original.basis.locationLabel,
        text: expect.stringContaining(original.basis.excerpt),
      });
      const event = issue.events.find(event => event.kind === "RESPONSE");
      if (!event) throw new Error("实际复核回应未保存");
      expect(await getSavedDocumentReviewPosition({ issueId: issue.id, slot: "REVISION", eventId: event.id })).toMatchObject({
        status: "AVAILABLE", documentVersion: 2, locationLabel: revisionSource.locationLabel, text: expect.stringContaining("纠正引用"),
      });
    }
    expect(await db.document.findUniqueOrThrow({ where: { id: revision.id } })).toMatchObject({ status: "PENDING_REVIEW", approvedById: null });
    await approveDocument(revision.id, "合成独立审批动作；不代表真实用户或专业验收通过。");
    expect(await db.document.findUniqueOrThrow({ where: { id: revision.id } })).toMatchObject({ status: "APPROVED", approvedById: f.reviewer.id });
    expect(await db.document.findUniqueOrThrow({ where: { id: draft.documentId } })).toMatchObject({ status: "PENDING_REVIEW", approvedById: null });
    expect((await getDocumentReview(revision.id)).issues).toHaveLength(0);
    expect((await getDocumentReview(draft.documentId)).issues).toEqual(resolved.issues);
    expect(await db.document.findUniqueOrThrow({ where: { id: template.id } })).toMatchObject({ status: "DRAFT", approvedById: null });
    config.actor = f.actor;
    const fresh = await createResearchDraft(db, f.actor, { matterId: f.matter.id, researchRevisionId: r2.id, requestKey: randomUUID() });
    expect(await db.document.findUniqueOrThrow({ where: { id: fresh.documentId } })).toMatchObject({ status: "DRAFT", approvedById: null });
    expect(await db.documentResearchSource.findMany({ where: { documentId: fresh.documentId }, select: { researchRevisionId: true } })).toEqual([{ researchRevisionId: r2.id }]);
    expect(await db.documentResearchSource.findMany({ where: { documentId: draft.documentId }, select: { researchRevisionId: true } })).toEqual([{ researchRevisionId: r1.id }]);
    expect((await readResearch(db, f.actor, f.matter.id, r1.id)).content).toEqual(r1View.content);
    expect(await db.auditLog.count({ where: { targetId: revision.id, action: "DOCUMENT_APPROVE", userId: f.reviewer.id } })).toBe(1);
  }, 120_000);

  it("个人成果另存新修订，保留固定原文，拒绝旧基线和跨案请求", async () => {
    const f = await fixture(scenarios[0]);
    const original = await upload(f, await createM3Docx("争点出处.docx", ["合成付款原文"]));
    const processed = await processExactDocument(f, original.id);
    const position = reference(sourceContaining(processed, "合成付款原文"), "SUPPORTS");
    const issue = await evidence(f, "ISSUE", "合成付款争点", [position], false);
    const content = { ...emptyResearchContent(), question: "合成付款争点", scope: "卷内材料",
      conclusion: "初稿结论", sources: [{ ...position, lawMetadata: emptyLawMetadata() }],
      issueSelection: { kind: "CURRENT" as const, issueId: issue.id, revision: issue.revision, confirmedAt: null } };
    const before = await saveResearch(db, f.actor, { ...content, matterId: f.matter.id,
      supersedesId: null, expectedVersion: null, requestKey: randomUUID() });
    const origin = "http://127.0.0.1:40188";
    const token = randomUUID().replaceAll("-", "").repeat(2);
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "PERSONAL");
    vi.stubEnv("LEXORDER_PERSONAL_ORIGIN", origin);
    vi.stubEnv("LEXORDER_PERSONAL_CHANNEL_TOKEN", token);
    const manifest = { version: 2, mode: "PERSONAL", workspaceId: randomUUID(), actorId: f.actor.id };
    const folder = await mkdtemp(join(tmpdir(), "lexorder-artifact-test-"));
    const manifestPath = join(folder, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await db.systemSetting.create({ data: { key: "personal-workspace", value: manifest } });
    await db.user.update({ where: { id: f.actor.id }, data: { role: "INDEPENDENT_LAWYER", systemRole: "NONE", passwordHash: "!personal-no-login" } });
    vi.stubEnv("LEXORDER_PERSONAL_WORKSPACE_ID", manifest.workspaceId);
    vi.stubEnv("LEXORDER_PERSONAL_ACTOR_ID", manifest.actorId);
    vi.stubEnv("LEXORDER_PERSONAL_MANIFEST", manifestPath);
    const actor: WorkspaceActor = { ...f.actor, role: "INDEPENDENT_LAWYER", systemRole: "NONE", runtimeMode: "PERSONAL" };
    config.actor = actor;
    try {
      const { POST } = await import("@/app/api/personal/matter-workspace/route");
      const request = { action: "revise-research", matterId: f.matter.id, supersedesId: before.id, expectedVersion: 1,
        requestKey: randomUUID(), analysis: { rule: "", exceptions: "", supportingAnalysis: "", opposingAnalysis: "",
          conclusion: "核对后的结论", unresolved: "待补另一份材料", nextSteps: "" } };
      const send = (body: object, authorized = true) => POST(new Request(origin + "/api/personal/matter-workspace", {
        method: "POST", headers: { host: new URL(origin).host, origin, ...(authorized ? { cookie: "lexorder_local_channel=" + token } : {}) },
        body: JSON.stringify(body),
      }));
      expect((await send(request, false)).status).toBe(403);
      expect((await send({ ...request, matterId: f.client.id })).status).toBe(403);
      const response = await send(request);
      const saved = await response.json();
      expect(response.status, saved.error).toBe(200);
      expect(saved).toMatchObject({ version: 2, replayed: false });
      expect(await (await send(request)).json()).toMatchObject({ id: saved.id, replayed: true });
      expect((await send({ ...request, requestKey: randomUUID() })).status).toBe(403);
      const reopened = await readResearch(db, actor, f.matter.id, saved.id);
      expect(reopened).toMatchObject({ version: 2, checkedAt: null, issue: { id: issue.id, revision: issue.revision },
        content: { question: content.question, scope: content.scope, conclusion: request.analysis.conclusion, unresolved: request.analysis.unresolved },
        sources: [position] });
      expect(await readResearchSource(db, actor, f.matter.id, saved.id, reopened.sources[0].id)).toMatchObject({
        status: "AVAILABLE", documentVersion: 1, text: expect.stringContaining("合成付款原文"),
      });
      expect(await readResearch(db, actor, f.matter.id, before.id)).toMatchObject({
        current: false, content: { conclusion: content.conclusion },
      });
    } finally {
      vi.unstubAllEnvs();
      await db.systemSetting.delete({ where: { key: "personal-workspace" } });
      await unlink(manifestPath);
      await rmdir(folder);
    }
  }, 30000);
});
