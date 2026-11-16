// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceActor } from "@/lib/runtime/actor";
import { sha256 } from "@/lib/storage/crypto";
import { Prisma } from "@prisma/client";
import PizZip from "pizzip";
import { emptyLawMetadata, emptyResearchContent } from "@/server/research/contracts";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("业务链测试仅允许隔离 _test 数据库");
  return { url, actor: null as WorkspaceActor | null, files: new Map<string, Buffer>() };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/chain_test") };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: config.actor })), getSession: vi.fn(async () => ({ user: config.actor })), requireWorkspaceConfiguration: vi.fn(async () => {
  if (config.actor?.systemRole !== "SUPER_ADMIN") throw new Error("合成配置操作必须使用独立系统管理员");
  return { user: config.actor };
}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Only the session boundary, Next cache and blob adapter are replaced. The selected
// business actions, authorization, database transitions, audit and ZIP export are real.
// This is service integration evidence, never browser or legal-professional acceptance.
vi.mock("@/lib/storage", () => ({ storage: {
  writeFile: vi.fn(async (directory: string, bytes: Buffer) => { const path = `${directory}/${randomUUID()}.bin`; config.files.set(path, Buffer.from(bytes)); return path; }),
  writeFileAt: vi.fn(async (path: string, bytes: Buffer) => { config.files.set(path, Buffer.from(bytes)); }),
  readFile: vi.fn(async (path: string) => {
    const bytes = config.files.get(path);
    if (!bytes) throw new Error("合成原件不存在");
    return Buffer.from(bytes);
  }),
  deleteFile: vi.fn(async (path: string) => { config.files.delete(path); }),
} }));

import { prisma as db } from "@/lib/prisma";
import { resolveRoleUser } from "@/lib/roles/service";
import { canReadDocument } from "@/lib/approvals/documents";
import { createEvidenceItem, confirmEvidenceItem } from "@/server/evidence/actions";
import { checkResearch, readResearch, readResearchOptions, saveResearch } from "@/server/research/service";
import { createResearchDraft } from "@/server/research/draft";
import { saveMatterContext, confirmMatterContext, readMatterContext } from "@/server/matters/context-service";
import { submitDocumentForReview, approveDocument, rejectDocument, uploadNewVersion } from "@/server/documents/actions";
import { createDocumentReviewIssue, respondDocumentReviewIssue, checkDocumentReviewIssue, readDocumentReview } from "@/server/document-reviews/service";
import { createTask, toggleTaskCompleted } from "@/server/tasks/actions";
import { getTaskWorkflow, startTaskWaiting, finishTaskWaiting, saveTaskDependencies } from "@/server/tasks/workflow-actions";
import { createClientBriefForActor } from "@/server/deliveries/brief";
import { prepareDeliveryForActor, getDeliveryDetailForActor, registerDeliveryEventForActor } from "@/server/deliveries/service";
import { exportDeliveryForActor } from "@/server/deliveries/export";
import { buildArchiveProfessionalHistory } from "@/server/archive/professional-history";
import { updateProcedure } from "@/server/procedures/actions";
import { saveClosure } from "@/server/archive/closure-actions";
import { assertClosureReady } from "@/server/archive/closure";
import { saveArchivePolicy } from "@/server/archive/policy";
import { archiveMatter, approveArchiveRecord } from "@/server/archive/actions";
import { buildArchiveZip, type buildArchiveManifest } from "@/server/archive/export";
import { ARCHIVE_MANUAL_CHECKS, parseArchiveSnapshot, requiredArchiveVerificationIds } from "@/lib/archive/snapshot";
import { checklistForCategory } from "@/lib/archive/checklists";
import { BUILTIN_TEMPLATES } from "@/lib/template-builder";
import type { ArchiveSubmitInput } from "@/server/archive/schemas";

const users: string[] = [], matters: string[] = [], clients: string[] = [], roles: string[] = [], groups: string[] = [];
const templates: string[] = [], templateBlobs: string[] = [], policies: string[] = [];
let previousPolicy: Prisma.JsonValue | undefined;
let policySaved = false;

async function prepareArchiveConfiguration() {
  const admin = await db.user.create({ data: { name: "合成归档配置管理员", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER", systemRole: "SUPER_ADMIN" } });
  users.push(admin.id);
  config.actor = { id: admin.id, name: admin.name, email: admin.email, avatar: admin.avatar, systemRole: admin.systemRole,
    ...await resolveRoleUser(admin.id, admin.role), runtimeMode: "SERVER" };
  previousPolicy = (await db.systemSetting.findUnique({ where: { key: "archivePolicy" } }))?.value;
  const policyBytes = Buffer.from("合成工程归档制度：逐项核对实际原件，未具备材料须逐项说明并由独立审批人明确核准例外。不代表律所正式制度。", "utf8");
  const policyPath = `m3-chain-policy/${randomUUID()}.txt`; config.files.set(policyPath, policyBytes);
  const policy = await db.firmFile.create({ data: { name: "合成归档验收制度.txt", path: policyPath, category: "POLICY", mimeType: "text/plain",
    size: policyBytes.length, sha256: sha256(policyBytes), uploadedById: admin.id, tags: ["合成验收"] } }); policies.push(policy.id);
  await saveArchivePolicy({ name: "合成工程归档制度", version: "synthetic-1", effectiveAt: "2026-01-01", sourceFileId: policy.id }); policySaved = true;
  for (const template of BUILTIN_TEMPLATES.filter(row => ["archive_cover", "archive_catalog"].includes(row.key))) {
    // Use the production builders and production render path; these are initial template
    // files, not fake rendered documents or pre-approved archive records.
    const bytes = await template.buildBuffer();
    const path = `m3-chain-template/${randomUUID()}.docx`; config.files.set(path, bytes);
    const blob = await db.document.create({ data: { name: `${template.name}.docx`, path, category: "OTHER", uploadedById: admin.id,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: bytes.length, sha256: sha256(bytes), tags: ["合成内置模板"] } }); templateBlobs.push(blob.id);
    const row = await db.documentTemplate.create({ data: { name: template.name, category: template.category, description: template.description,
      applicableCategories: template.applicableCategories, docxBlobId: blob.id, variables: template.variables,
      isBuiltIn: true, enabled: true, createdById: admin.id } }); templates.push(row.id);
  }
}

const scenarios = [
  { name: "诉讼", category: "CIVIL_COMMERCIAL", procedure: "FIRST_INSTANCE", question: "合成合同款中哪些金额仍有争议" },
  { name: "仲裁", category: "COMMERCIAL_ARBITRATION", procedure: "COMMERCIAL_ARBITRATION", question: "合成服务成果的付款条件是否已齐备" },
  { name: "无程序顾问", category: "LEGAL_COUNSEL", procedure: null, question: "合成合作草案尚需客户补充哪些信息" },
] as const;

async function fixture(scenario: typeof scenarios[number]) {
  const owner = await db.user.create({ data: { name: "合成经办律师", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  users.push(owner.id);
  const roleName = `chain-reviewer-${randomUUID()}`;
  const role = await db.roleDefinition.create({ data: { name: roleName, normalizedName: roleName } }); roles.push(role.id);
  const reviewer = await db.user.create({ data: { name: "合成独立审批人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "CUSTOM", roleDefinitionId: role.id } });
  users.push(reviewer.id);
  const group = await db.approvalPermissionGroup.create({ data: { name: `合成审批资格-${randomUUID()}`, members: { create: { userId: reviewer.id } },
    rules: { create: [{ action: "DOCUMENT_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] }, { action: "ARCHIVE_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] }] } } }); groups.push(group.id);
  const client = await db.client.create({ data: { name: "合成验收客户", type: "ORGANIZATION", ownerUserId: owner.id, tags: [] } }); clients.push(client.id);
  const matter = await db.matter.create({ data: { title: `合成${scenario.name}业务链`, internalCode: `M3-CHAIN-${randomUUID()}`, category: scenario.category,
    ownerId: owner.id, primaryClientId: client.id, serviceScope: "仅工程合成验收，不代表法律意见" } }); matters.push(matter.id);
  if (scenario.procedure) await db.matterProcedure.create({ data: { matterId: matter.id, type: scenario.procedure, order: 1, engagement: "ENGAGED", status: "PENDING", leadLawyerId: owner.id } });
  const bytes = Buffer.from("合成材料：价款及成果交付存在待核事项。合成客户回复：先补充证据，不授权立即提交实体请求。无真实客户数据。", "utf8");
  const path = `m3-chain/${randomUUID()}.txt`; config.files.set(path, bytes);
  const source = await db.document.create({ data: { matterId: matter.id, name: "合成客户材料和回复.txt", path, mimeType: "text/plain", size: bytes.length,
    sha256: sha256(bytes), sourceOrigin: "CLIENT_PROVIDED", uploadedById: owner.id, tags: [], familyId: randomUUID() } });
  const actor = { id: owner.id, name: owner.name, email: owner.email, avatar: owner.avatar, systemRole: owner.systemRole,
    ...await resolveRoleUser(owner.id, owner.role), runtimeMode: "SERVER" as const };
  const reviewerActor = { id: reviewer.id, name: reviewer.name, email: reviewer.email, avatar: reviewer.avatar, systemRole: reviewer.systemRole,
    ...await resolveRoleUser(reviewer.id, reviewer.role), runtimeMode: "SERVER" as const };
  return { owner, reviewer, actor, reviewerActor, matter, source };
}

describe.skipIf(!config.url)("M3 合成事项从争点到交付及明确缺项例外归档 / 真实 PostgreSQL 服务链", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); await prepareArchiveConfiguration(); });
  afterAll(async () => {
    const parseRuns = await db.documentParseRun.findMany({ where: { requestedById: { in: users } }, select: { id: true } });
    await db.jobQueue.updateMany({ where: { dedupeKey: { in: parseRuns.map(run => `document.parse:${run.id}`) }, status: { not: "SUCCESS" } },
      data: { status: "DEAD", leaseToken: null, leaseUntil: null, lastError: "合成业务链场景已结束" } });
    await db.documentTemplate.updateMany({ where: { id: { in: templates } }, data: { enabled: false } });
    await db.document.updateMany({ where: { id: { in: templateBlobs } }, data: { deletedAt: new Date() } });
    await db.firmFile.updateMany({ where: { id: { in: policies } }, data: { archivedAt: new Date() } });
    if (policySaved) {
      if (previousPolicy === undefined) await db.systemSetting.deleteMany({ where: { key: "archivePolicy" } });
      else await db.systemSetting.update({ where: { key: "archivePolicy" }, data: { value: previousPolicy as Prisma.InputJsonValue } });
    }
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groups } }, data: { active: false } });
    await db.$disconnect(); config.files.clear(); vi.unstubAllEnvs();
  });

  it.each(scenarios)("$name：真实服务贯通并经明确缺项例外归档，不预置确认、批准或发送事实", async scenario => {
    const f = await fixture(scenario); config.actor = f.actor;
    const issue = await createEvidenceItem({ matterId: f.matter.id, requestKey: randomUUID(), kind: "ISSUE", title: scenario.question,
      content: "合成争点：区分已取得材料、相反解释与尚待客户确认内容。", sourceDocumentId: f.source.id, sourceRelation: "CONTEXT" });
    await confirmEvidenceItem({ evidenceItemId: issue.id, expectedRevision: 1, confirm: true });
    const selection = (await readResearchOptions(db, f.actor, f.matter.id)).issues.find(row => row.id === issue.id)!.selection;
    const research = await saveResearch(db, f.actor, { ...emptyResearchContent(), matterId: f.matter.id, requestKey: randomUUID(), supersedesId: null, expectedVersion: null,
      issueSelection: selection, question: scenario.question, purpose: "人工合成业务链验证", jurisdiction: "中国大陆（合成场景，不确认具体适用法）", relevantDate: "2019-06-10",
      scope: "仅已选材料，未取得完整原始往来", supportingAnalysis: "合成合同文字支持进一步核对", opposingAnalysis: "付款条件与实际成果仍可能有相反解释",
      unresolved: "缺少完整往来和专业判断", conclusion: "工程示例，不形成法律结论", nextSteps: "请求补充材料并由律师复核",
      queryLog: [{ query: "合成原始往来", location: "客户交付材料", access: "NONE", outcome: "NOT_OBTAINED", notes: "未取得部分材料不等于不存在" }],
      sources: [{ documentId: f.source.id, relation: "REBUTS", lawMetadata: emptyLawMetadata() }] });
    await checkResearch(db, f.actor, { matterId: f.matter.id, id: research.id, expectedVersion: 1, acknowledged: true, note: "仅合成操作核对；法律专业结论仍待真人验收" });
    const reopened = await readResearch(db, f.actor, f.matter.id, research.id);
    expect(reopened.issue).toMatchObject({ id: issue.id, revision: 1, revisionId: null });
    expect(reopened.issue!.confirmedAt).not.toBeNull();
    expect(reopened.content).toMatchObject({ relevantDate: "2019-06-10", unresolved: "缺少完整往来和专业判断" });
    expect(await db.evidenceItemRevision.count({ where: { evidenceItemId: issue.id } })).toBe(0);

    const context = { matterId: f.matter.id, visibility: "MATTER" as const, occurredAt: new Date().toISOString(), sourceDocumentId: f.source.id };
    const option = await saveMatterContext(db, f.actor, { ...context, requestKey: randomUUID(), kind: "OPTION", content: "合成律师建议：先补材料再决定请求范围", sourceDescription: "合成工程建议，非客户决定" });
    const decision = await saveMatterContext(db, f.actor, { ...context, requestKey: randomUUID(), kind: "DECISION", content: "合成客户回复：先补证据，不授权立即提交实体请求", sourceDescription: "合成材料中明确记录的测试客户回复" });
    await confirmMatterContext(db, f.actor, { matterId: f.matter.id, id: decision.id, expectedVersion: 1, acknowledged: true });
    const records = (await readMatterContext(db, f.actor, f.matter.id)).records;
    expect(records.find(row => row.id === option.id)).toMatchObject({ kind: "OPTION", confirmationStatus: "PENDING" });
    expect(records.find(row => row.id === decision.id)).toMatchObject({ kind: "DECISION", confirmationStatus: "CONFIRMED" });
    expect((await db.matter.findUniqueOrThrow({ where: { id: f.matter.id } })).serviceScope).toBe(f.matter.serviceScope);

    const draft = await createResearchDraft(db, f.actor, { matterId: f.matter.id, researchRevisionId: research.id, requestKey: randomUUID() });
    await submitDocumentForReview(draft.documentId);
    expect((await db.document.findUniqueOrThrow({ where: { id: draft.documentId } })).status).toBe("PENDING_REVIEW");
    expect(await canReadDocument(f.reviewer.id, f.source)).toBe(false);
    const review = await createDocumentReviewIssue(f.reviewer.id, { requestId: randomUUID(), documentId: draft.documentId, title: "明确尚未获得客户授权",
      location: "下一步", basis: "请将建议与测试客户回复明确分开。审批附件资格不代表已阅读底层来源。", basisDocumentId: null });
    const revision = await uploadNewVersion({ documentId: draft.documentId, requestKey: randomUUID(),
      file: new File(["合成分析稿修订：仅建议补证据；合成客户尚未授权提交实体请求。法律结论仍待真人专业复核。"], "合成分析稿修订.txt", { type: "text/plain" }) });
    await submitDocumentForReview(revision.id);
    const response = await respondDocumentReviewIssue(f.owner.id, { requestId: randomUUID(), issueId: review.id, expectedVersion: 1,
      disposition: "ACCEPT", note: "已在修订稿明确区分建议与授权", revisionDocumentId: revision.id, revisionLocation: "全文首段" });
    await checkDocumentReviewIssue(f.reviewer.id, { requestId: randomUUID(), issueId: review.id, expectedVersion: response.version,
      resolved: true, note: "合成操作已核对修订位置，未宣称核读无权来源" });
    expect((await readDocumentReview(f.reviewer.id, draft.documentId)).issues[0].state).toBe("RESOLVED");
    expect(await db.document.findUniqueOrThrow({ where: { id: revision.id } })).toMatchObject({ status: "PENDING_REVIEW", approvedById: null });
    config.actor = f.reviewerActor;
    await approveDocument(revision.id, "合成独立审批操作，不等同本系统专业验收");
    await rejectDocument(draft.documentId, "合成旧稿由明确修订版接续，原文和问题历史保留");
    config.actor = f.actor;
    expect(await db.documentResearchSource.findMany({ where: { documentId: revision.id }, select: { researchRevisionId: true } })).toEqual([{ researchRevisionId: research.id }]);

    const waitingTask = await createTask({ matterId: f.matter.id, title: "补齐合成客户材料", priority: 0, requestKey: randomUUID() });
    const dependent = await createTask({ matterId: f.matter.id, title: "依据补充材料完成合成接续", priority: 0, requestKey: randomUUID() });
    await saveTaskDependencies({ taskId: dependent.id, revision: (await getTaskWorkflow(dependent.id)).task.responsibility.revision,
      prerequisiteIds: [waitingTask.id], reason: "先取得材料再推进后续" });
    const waitingId = randomUUID();
    await startTaskWaiting({ taskId: waitingTask.id, revision: (await getTaskWorkflow(waitingTask.id)).task.responsibility.revision,
      waitingId, waitingFor: "合成客户", expectedResult: "合成往来文件", nextCheckAt: new Date(Date.now() + 86400000), reason: "材料尚待补充" });
    await expect(toggleTaskCompleted(waitingTask.id)).rejects.toThrow(/等待/);
    await expect(toggleTaskCompleted(dependent.id)).rejects.toThrow(/前置/);
    await finishTaskWaiting({ taskId: waitingTask.id, revision: (await getTaskWorkflow(waitingTask.id)).task.responsibility.revision,
      waitingId, result: "合成验收中已记录测试资料到达，未操作真实客户" });
    expect((await getTaskWorkflow(waitingTask.id)).task.responsibility.state).toBe("OPEN");
    await toggleTaskCompleted(waitingTask.id); await toggleTaskCompleted(dependent.id);

    const brief = await createClientBriefForActor(f.owner.id, { matterId: f.matter.id, requestKey: randomUUID(), title: "合成阶段简报",
      content: "已形成合成研究和修订稿；客户仅同意补材料。未取得资料和真实专业判断仍未完成。" });
    await submitDocumentForReview(brief.id); config.actor = f.reviewerActor;
    await approveDocument(brief.id, "合成独立审批操作"); config.actor = f.actor;
    const delivery = await prepareDeliveryForActor(f.owner.id, { matterId: f.matter.id, requestKey: randomUUID(), documentIds: [revision.id, brief.id],
      recipientName: "合成客户", recipientContact: "合成现场交接", purpose: "合成阶段交付", disclosureScope: "仅本清单的两个具体版本", unresolvedItems: "真人律师专业验收未完成" });
    await exportDeliveryForActor(f.owner.id, delivery.id, { requestKey: randomUUID() });
    expect(await db.deliveryEvent.count({ where: { deliveryId: delivery.id, kind: "SENT" } })).toBe(0);
    for (const [kind, note] of [["SENT", "合成现场交接登记；没有实际外发"], ["RECEIVED", "合成客户仅确认收到"], ["REPLIED", "合成客户回复：仍不授权实体提交"]] as const) {
      await registerDeliveryEventForActor(f.owner.id, { deliveryId: delivery.id, requestKey: randomUUID(), kind, occurredAt: new Date().toISOString(), channel: "合成当面", note });
    }
    const sent = await getDeliveryDetailForActor(f.owner.id, delivery.id);
    expect(sent.items.map(item => item.documentId)).toEqual([revision.id, brief.id]);
    expect(sent.events.map(event => event.kind)).toEqual(expect.arrayContaining(["EXPORTED", "SENT", "RECEIVED", "REPLIED"]));
    expect(sent.events.some(event => event.kind === "CONTENT_CONFIRMED")).toBe(false);
    const nextBrief = await createClientBriefForActor(f.owner.id, { matterId: f.matter.id, requestKey: randomUUID(), priorDocumentId: brief.id,
      title: "合成阶段简报二版", content: "另存新的草稿，不改原交付清单或借用旧批准" });
    expect(await db.document.findUniqueOrThrow({ where: { id: nextBrief.id } })).toMatchObject({ status: "DRAFT", approvedById: null });
    expect((await getDeliveryDetailForActor(f.owner.id, delivery.id)).items.map(item => item.documentId)).toEqual([revision.id, brief.id]);

    // The professional history consumes the records genuinely produced above.
    // Actual archive submission, independent exception approval and ZIP export follow;
    // missing legal/business documents remain explicit exceptions, never invented files.
    const history = await buildArchiveProfessionalHistory(db, f.matter.id, [draft.documentId, revision.id, brief.id]);
    expect(history.research[0]).toMatchObject({ id: research.id, issueSnapshot: { evidenceItemId: issue.id, revision: 1 } });
    expect(history.reviews).toEqual(expect.arrayContaining([expect.objectContaining({ id: review.id, state: "RESOLVED" })]));
    expect(history.deliveries).toEqual(expect.arrayContaining([expect.objectContaining({ id: delivery.id })]));
    if (!scenario.procedure) expect(await db.matterProcedure.count({ where: { matterId: f.matter.id } })).toBe(0);

    // Record only this synthetic scenario's actual end. Do not infer a judicial result.
    const currentProcedures = await db.matterProcedure.findMany({ where: { matterId: f.matter.id } });
    for (const procedure of currentProcedures) await updateProcedure({ id: procedure.id, expectedUpdatedAt: procedure.updatedAt,
      status: "CONCLUDED", concludedAt: new Date(), outcomeNote: "合成测试已结束；不记作真实判决或调解" });
    await saveClosure({ matterId: f.matter.id, revision: null, financeOwnerId: null, serviceCompletedAt: new Date(),
      reason: "合成工程场景的服务操作已结束，当前无未处置责任；原始格式材料缺项将明确申请归档例外" });
    expect(await assertClosureReady(db, f.matter.id)).not.toBeNull();

    const checklist = checklistForCategory(scenario.category);
    const items: ArchiveSubmitInput["checklistItems"] = Object.fromEntries(checklist.items.filter(item => !item.autoGenerated).map(item => [item.id, {
      status: "MISSING" as const, documentIds: [], note: "合成工程场景未提供此项真实格式材料，明确保留缺项并申请例外；不以分析稿冒充" } ]));
    if (scenario.category === "LEGAL_COUNSEL") {
      items.legal_opinions_compendium = { status: "ATTACHED", documentIds: [draft.documentId, revision.id], note: "合成分析稿原版与实际修订版，保留原复核历史" };
      items.consultation_log = { status: "ATTACHED", documentIds: [brief.id], note: "仅本合成阶段的研究及客户指示摘要，未提供全期咨询记录；期满、续约或终止说明仍保留缺项" };
    } else {
      items.evidence_catalog = { status: "ATTACHED", documentIds: [f.source.id], note: "本合成包仅提供该证据材料，不证明目录或专业内容齐备" };
      items.case_summary = { status: "ATTACHED", documentIds: [draft.documentId, revision.id, brief.id], note: "本合成场景的分析、复核及交付记录；其他必交格式材料逐项保留缺项" };
    }
    const submission = { matterId: f.matter.id, summary: "仅合成工程归档：研究、修订、复核及交付实际记录；委托和裁判等缺项明确申请例外", closedReason: "OTHER" as const,
      completedAt: new Date(), checklistItems: items, manualChecks: Object.fromEntries(ARCHIVE_MANUAL_CHECKS.map(check => [check.id, {
        confirmed: true, note: "已核对本合成包的实际原件、范围及明确缺项；不表示真实律师专业验收" } ])), forceWithMissing: false };
    await expect(archiveMatter(submission)).rejects.toThrow(/必交项/);
    const submitted = await archiveMatter({ ...submission, forceWithMissing: true });
    const archive = await db.archiveRecord.findFirstOrThrow({ where: { matterId: f.matter.id, archiveNo: submitted.archiveNo } });
    expect(archive).toMatchObject({ status: "PENDING_REVIEW", reviewedAt: null, reviewedById: null, frozenManifest: null });
    expect(archive.coverDocId).not.toBeNull(); expect(archive.catalogDocId).not.toBeNull();
    expect(archive.missingItems.length).toBeGreaterThan(0);
    expect((await db.matter.findUniqueOrThrow({ where: { id: f.matter.id } })).status).not.toBe("ARCHIVED");
    const snapshot = parseArchiveSnapshot(archive.checklistJson)!;
    config.actor = f.reviewerActor;
    await expect(approveArchiveRecord({ archiveId: archive.id, verificationIds: requiredArchiveVerificationIds(snapshot), exceptionApproved: false,
      note: "尚未明确核准合成缺项" })).rejects.toThrow(/缺项|例外/);
    await approveArchiveRecord({ archiveId: archive.id, verificationIds: requiredArchiveVerificationIds(snapshot), exceptionApproved: true,
      note: "合成独立审批人逐项核准仅为工程验证的明确缺项；不视作真实案件完整卷宗或律师专业验收" });
    const approved = await db.archiveRecord.findUniqueOrThrow({ where: { id: archive.id } });
    expect(approved).toMatchObject({ status: "APPROVED", reviewedById: f.reviewer.id });
    expect((await db.matter.findUniqueOrThrow({ where: { id: f.matter.id } })).status).toBe("ARCHIVED");
    const frozen = approved.frozenManifest as unknown as Awaited<ReturnType<typeof buildArchiveManifest>>;
    expect(frozen.professionalHistory.research[0].id).toBe(research.id);
    expect(frozen.professionalHistory.reviews.map(row => row.id)).toContain(review.id);
    expect(frozen.professionalHistory.deliveries.map(row => row.id)).toContain(delivery.id);
    const eventCount = await db.deliveryEvent.count({ where: { deliveryId: delivery.id } });
    config.actor = f.actor;
    const archiveFile = await buildArchiveZip(archive.id, f.actor);
    const zip = new PizZip(archiveFile.buffer);
    expect(JSON.parse(zip.file(`${archive.archiveNo}/manifest.json`)!.asText())).toEqual(frozen);
    expect(Object.keys(zip.files).filter(path => path.includes("封皮和目录/") && !zip.files[path].dir)).toHaveLength(2);
    expect(await db.deliveryEvent.count({ where: { deliveryId: delivery.id } })).toBe(eventCount);
    await expect(saveResearch(db, f.actor, { ...emptyResearchContent(), matterId: f.matter.id, requestKey: randomUUID(), supersedesId: null, expectedVersion: null,
      question: "归档后不得继续普通研究写入" })).rejects.toThrow(/归档/);
  }, 30000);
});
