import { fragmentsSchema, type FragmentSelection } from "@/lib/workbench/fixed-fragments";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type SkillCommission } from "@prisma/client";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { prisma } from "@/lib/prisma";
import { PERSONAL_SKILL_MCP_PATH, personalRuntime } from "@/lib/runtime/personal-channel";
import { getAiSettings } from "@/lib/ai/settings";
import { canReadDocument } from "@/lib/approvals/documents";
import { auditTx } from "@/server/audit";
import { loadFixedFragments } from "@/server/ai/fixed-fragments";
import { contextAccess, type ContextAccess, type ContextActor } from "@/server/matters/context-service";
import { currentResearchIssueSchema, emptyLawMetadata, emptyResearchContent, researchSaveSchema } from "@/server/research/contracts";
import type { EvidenceSourceView, SourceReference } from "@/server/evidence/contracts";
import { sourceReader, sourceReferences } from "@/server/evidence/source-links";
import { issueSourceAdditions, readResearchIssueSnapshot } from "@/server/research/issue-snapshot";
import { captureIssueInput, loadResearch, presentResearch, researchReferenceSelect, researchReferencesForRead, researchTransaction, storeResearchRevision } from "@/server/research/service";
import { assertSkillCitations, assertSignoffFocus, effectiveAiExecution, externalSkillResultSchema, followUpRequestSchema, followUpSchema, signoffAiExecutionSchema, signoffMethod, skillDecisionsSchema, skillResultSchema,
  type FollowUp, type SignoffAiExecution, type SignoffItemOrigin, type SignoffKind } from "./signoff-contract";
import { countNewFragments, decisionParagraphs, removePriorDecision } from "./signoff-follow-up";

const identity = { matterId: z.cuid(), id: z.uuid() };
export const signoffActions = [
  z.strictObject({ action: z.literal("create-signoff"), matterId: z.cuid(), researchId: z.cuid(), requestKey: z.uuid(),
    ranges: fragmentsSchema, followUp: followUpRequestSchema.optional() }),
  z.strictObject({ action: z.literal("create-issue-signoff"), matterId: z.cuid(), requestKey: z.uuid(), ranges: fragmentsSchema,
    issue: currentResearchIssueSchema, researchedAt: z.iso.datetime({ offset: true }) }),
  z.strictObject({ action: z.literal("export-signoff"), ...identity, confirmed: z.literal(true) }),
  z.strictObject({ action: z.literal("submit-signoff"), ...identity, result: externalSkillResultSchema }),
  z.strictObject({ action: z.literal("adopt-signoff"), ...identity, decisions: skillDecisionsSchema }),
  z.strictObject({ action: z.literal("run-signoff-ai"), ...identity, confirmed: z.literal(true), model: z.string().min(1).max(160), origin: z.url().max(400) }),
  z.strictObject({ action: z.literal("grant-signoff-host"), ...identity, host: z.enum(["CODEX", "WORKBUDDY"]), confirmed: z.literal(true) }),
  z.strictObject({ action: z.literal("revoke-signoff-host"), ...identity, grantId: z.uuid() }),
] as const;
type SignoffAction = z.infer<(typeof signoffActions)[number]>;
const grantDuration = 30 * 60_000;
export const hashSkillToken = (token: string) => createHash("sha256").update(token).digest("hex");
type HostGrant = { id: string; tokenHash: string };
const liveGrant = (time = new Date()) => ({ revokedAt: null, expiresAt: { gt: time } });
export async function readBase(tx: Prisma.TransactionClient, access: ContextAccess, id: string) {
  const row = await loadResearch(tx, access.matter.id, id);
  const view = await presentResearch(tx, access, row);
  if (!view.content || !view.issue) throw new ActionError("请使用本案有可读固定争点的研究版本");
  return { row, view, issue: view.issue, content: view.content };
}

export function baselineCurrent(base: Awaited<ReturnType<typeof readBase>>, run?: Pick<SkillCommission, "baseCheckedAt">) {
  return base.view.current && !base.issue.changed && !base.issue.confirmationChanged &&
    (!run || (run.baseCheckedAt?.toISOString() ?? null) === base.view.checkedAt);
}

function storedResult(run: SkillCommission) {
  return run.result == null ? null : skillResultSchema.parse(run.result);
}

async function getRun(tx: Prisma.TransactionClient, access: ContextAccess, id: string) {
  const run = await tx.skillCommission.findFirst({ where: { id, matterId: access.matter.id } });
  if (!run || run.methodVersion !== signoffMethod.version) throw new ActionError("本案没有可用的委托记录");
  return run;
}

function recordedItems(run: SkillCommission): SignoffItemOrigin[] {
  const result = storedResult(run);
  if (!run.adoptedResearchId || !result || !run.decisions) throw new ActionError("请从已保存律师取舍的委托继续复核");
  const own = skillDecisionsSchema.parse(run.decisions).map(entry => ({ kind: result.candidates[entry.candidate].kind, commissionId: run.id }));
  const carried = run.followUp == null ? [] : followUpSchema.parse(run.followUp).carried;
  return [...own, ...carried];
}

async function readRecordedItems(tx: Prisma.TransactionClient, access: ContextAccess, items: SignoffItemOrigin[]) {
  const inputs = new Map<string, { candidates: NonNullable<ReturnType<typeof storedResult>>["candidates"];
    decisions: ReturnType<typeof skillDecisionsSchema.parse>; ranges: FragmentSelection[] }>();
  for (const id of new Set(items.map(item => item.commissionId))) {
    const run = await getRun(tx, access, id);
    const result = storedResult(run);
    if (!run.adoptedResearchId || !result || !run.decisions) throw new ActionError("原律师取舍已不可用");
    await readBase(tx, access, run.baseResearchId);
    inputs.set(id, { candidates: result.candidates, decisions: skillDecisionsSchema.parse(run.decisions), ranges: fragmentsSchema.parse(run.ranges) });
  }
  const recorded = items.map(origin => {
    const { candidates, decisions, ranges } = inputs.get(origin.commissionId)!;
    const index = candidates.findIndex(item => item.kind === origin.kind);
    const decision = decisions.find(entry => entry.candidate === index);
    if (!decision) throw new ActionError("该核对项的原律师取舍不可用");
    const cited = candidates[index].citations.map(citation => ranges[citation.fragment - 1]);
    return { origin, decision, ranges, cited };
  });
  const allCitations = recorded.flatMap(item => item.cited);
  const reader = await sourceReader(access.user.id, access.matter.id, allCitations, tx);
  if (!allCitations.every(range => reader.canRead(range.documentId))) throw new ActionError("原律师取舍的固定出处已撤回或无权读取");
  return recorded.map(item => ({ ...item, citedDocuments: item.cited.map(range => reader.documentById(range.documentId)!) }));
}

type MaterialVersionImpact = {
  previous: { id: string; name: string; version: number };
  latest: { id: string; name: string; version: number };
};

async function materialVersionImpacts(tx: Prisma.TransactionClient, access: ContextAccess,
  items: Awaited<ReturnType<typeof readRecordedItems>>) {
  const citedByItem = items.map(({ origin, citedDocuments }) => {
    const byFamily = new Map<string, (typeof citedDocuments)[number]>();
    for (const document of citedDocuments) {
      if (!document.familyId) continue;
      const prior = byFamily.get(document.familyId);
      if (!prior || prior.version < document.version) byFamily.set(document.familyId, document);
    }
    return { ...origin, cited: [...byFamily.values()].filter(document => !document.isLatest) };
  });
  const families = [...new Set(citedByItem.flatMap(item => item.cited.map(document => document.familyId!)))];
  const latest = new Map<string, MaterialVersionImpact["latest"]>();
  if (families.length) {
    const replacements = await tx.document.findMany({
      where: { matterId: access.matter.id, deletedAt: null, isLatest: true, familyId: { in: families } },
      select: { id: true, matterId: true, intakeId: true, uploadedById: true, familyId: true, name: true, version: true },
    });
    for (const document of replacements) {
      if (await canReadDocument(access.user.id, document, tx)) {
        latest.set(document.familyId!, { id: document.id, name: document.name, version: document.version });
      }
    }
  }
  return citedByItem.map(({ cited, ...origin }) => ({
    ...origin,
    newerMaterials: cited.flatMap(previous => {
      const replacement = latest.get(previous.familyId!);
      return replacement && replacement.version > previous.version ? [{
        previous: { id: previous.id, name: previous.name, version: previous.version }, latest: replacement,
      }] : [];
    }),
  }));
}

export async function readFollowUpPriorDecision(tx: Prisma.TransactionClient, access: ContextAccess, run: SkillCommission, followUp: FollowUp) {
  const prior = await getRun(tx, access, run.priorCommissionId!);
  const target = recordedItems(prior).find(item => item.kind === followUp.kind);
  if (!target) throw new ActionError("原核对项已不可用");
  const [recorded] = await readRecordedItems(tx, access, [target, ...followUp.carried]);
  return recorded.decision;
}

async function followUpBasis(tx: Prisma.TransactionClient, access: ContextAccess, prior: SkillCommission) {
  const items = recordedItems(prior);
  const adopted = await tx.researchRevision.findFirst({
    where: { id: prior.adoptedResearchId!, matterId: access.matter.id }, select: { seriesId: true, version: true },
  });
  if (!adopted) throw new ActionError("采用修订不属于本案");
  const newerSkill = await tx.researchRevision.count({
    where: { matterId: access.matter.id, seriesId: adopted.seriesId, version: { gt: adopted.version }, adoptedCommission: { isNot: null } },
  });
  if (newerSkill) throw new ActionError("请从该研究最新的已采用委托继续复核");
  const head = await tx.researchRevision.findFirst({
    where: { matterId: access.matter.id, seriesId: adopted.seriesId, successor: { is: null } }, select: { id: true },
  });
  if (!head) throw new ActionError("当前研究修订不可用");
  const base = await readBase(tx, access, head.id);
  if (!base.view.canRevise) throw new ActionError("当前研究不可修改，请先核对研究基线");
  return { base, items };
}

type IssueSupplementMaterial = { id: string; name: string; version: number };
type ReviewableIssueSupplement = IssueSupplementMaterial & { eligibleKinds: SignoffKind[] };
function supplementMaterials(references: SourceReference[], views: EvidenceSourceView[], prefix = "") {
  const keys = new Set(references.map(source => prefix + source.id));
  const documents = new Map<string, IssueSupplementMaterial>();
  for (const source of views) if (keys.has(source.id) && source.status === "AVAILABLE") {
    documents.set(source.documentId!, { id: source.documentId!, name: source.documentName!, version: source.documentVersion! });
  }
  return [...documents.values()];
}

async function previewIssueSupplement(tx: Prisma.TransactionClient, access: ContextAccess, base: Awaited<ReturnType<typeof readBase>>) {
  const previous = readResearchIssueSnapshot(base.row);
  const current = base.row.issue;
  if (!previous || !current) return null;
  const issue = { kind: "CURRENT" as const, issueId: base.issue.id, revision: current.revision, confirmedAt: current.confirmedAt?.toISOString() ?? null };
  const snapshot = await captureIssueInput(tx, access, issue);
  const additions = snapshot && issueSourceAdditions(previous, snapshot);
  if (!additions?.length) return null;
  const reader = await sourceReader(access.user.id, access.matter.id, additions, tx);
  const materials = supplementMaterials(additions, additions.map(reader.view));
  return materials.length ? { researchId: base.view.id, expectedVersion: base.view.version, issue, materials } : null;
}

async function openIssueSupplements(tx: Prisma.TransactionClient, run: SkillCommission, original: Awaited<ReturnType<typeof readBase>>,
  head: Awaited<ReturnType<typeof readBase>>, recorded: Awaited<ReturnType<typeof readRecordedItems>>) {
  // Each new receipt sees the current dispute snapshot. Re-open from the first
  // adopted snapshot so completing one selected source doesn't dismiss siblings.
  const initial = run.priorCommissionId ? await tx.researchRevision.findFirst({
    where: { matterId: run.matterId, seriesId: head.view.seriesId, adoptedCommission: { isNot: null } },
    orderBy: { version: "asc" }, select: { matterId: true, issueId: true, issueRevisionId: true, issueSnapshot: true,
      issue: { select: { matterId: true } } },
  }) : original.row;
  const previous = initial && readResearchIssueSnapshot(initial);
  const current = readResearchIssueSnapshot(head.row);
  const additions = previous && current && issueSourceAdditions(previous, current);
  if (!additions?.length) return [];
  return supplementMaterials(additions, head.issue.sources, "issue:").flatMap(material => {
    const references = additions.filter(source => source.documentId === material.id);
    const eligibleKinds = recorded.filter(({ ranges }) => references.some(source => !ranges.some(range =>
      range.documentId === source.documentId && (!source.parseRunId || (range.parseRunId === source.parseRunId && range.anchorId === source.anchorId)),
    ))).map(item => item.origin.kind);
    return eligibleKinds.length ? [{ ...material, eligibleKinds }] : [];
  });
}

const aiJobKey = (id: string) => "skill.signoff:" + id;
const savedAiExecution = (value: Prisma.JsonValue) => value == null ? null : signoffAiExecutionSchema.parse(value);
const aiInFlight = (execution: SignoffAiExecution | null) => execution?.state === "QUEUED" || execution?.state === "DISPATCHED";

function viewSummary(run: Pick<SkillCommission, "id" | "createdAt" | "exportedAt" | "submittedAt" | "adoptedResearchId" | "aiExecution">,
  execution = savedAiExecution(run.aiExecution)) {
  return { id: run.id, createdAt: run.createdAt, exportedAt: run.exportedAt,
    submittedAt: run.submittedAt, adoptedResearchId: run.adoptedResearchId, aiState: execution?.state ?? null };
}

type SignoffHistoryScope = { issueId: string } | { researchId: string };
const historyPageSize = 10;

export async function readSignoffList(actor: ContextActor, matterId: string, scope: SignoffHistoryScope, beforeId?: string) {
  return researchTransaction(prisma, async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const issue = "issueId" in scope ? await tx.evidenceItem.findFirst({
      where: { id: scope.issueId, matterId, kind: "ISSUE" },
      select: { id: true, sourceDocumentId: true, sourcePage: true, sources: { where: { removedAt: null } } },
    }) : null;
    if ("issueId" in scope && !issue) throw new ActionError("争点不存在或不属于本案");
    const seriesId = "researchId" in scope ? (await readBase(tx, access, scope.researchId)).view.seriesId : undefined;
    const where = {
      matterId, methodVersion: signoffMethod.version,
      baseResearch: issue ? { issueId: issue.id } : { seriesId },
    } satisfies Prisma.SkillCommissionWhereInput;
    const before = beforeId ? await tx.skillCommission.findFirst({
      where: { ...where, id: beforeId }, select: { id: true, createdAt: true },
    }) : null;
    if (beforeId && !before) throw new ActionError("委托列表的翻页位置已失效，请重新打开");
    const rows = await tx.skillCommission.findMany({
      where: { ...where, ...(before ? { OR: [
        { createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } },
      ] } : {}) },
      select: { id: true, createdAt: true, exportedAt: true, submittedAt: true, adoptedResearchId: true,
        aiExecution: true, ranges: true, baseCheckedAt: true,
        baseResearch: { select: { ...researchReferenceSelect, version: true, checkedAt: true, successor: { select: { id: true } } } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: historyPageSize + 1,
    });
    const page = rows.slice(0, historyPageSize).map(row => ({
      row, ranges: fragmentsSchema.parse(row.ranges),
      references: researchReferencesForRead(row.baseResearch),
      issueSnapshot: readResearchIssueSnapshot(row.baseResearch),
    }));
    const issueReferences = issue ? sourceReferences(issue) : [];
    const reader = await sourceReader(actor.id, matterId, [
      ...issueReferences,
      ...page.flatMap(entry => [...entry.ranges, ...(entry.references?.ownReferences ?? []), ...(entry.references?.issueReferences ?? [])]),
    ], tx);
    if (!issueReferences.every(reader.documentFor)) throw new ActionError("争点来源已撤回或无权读取");
    const visible = page.flatMap(({ row, ranges, references, issueSnapshot }) => {
      if (!references || !issueSnapshot || !references.ownReferences.every(reader.documentFor) ||
          !references.issueReferences.every(reader.documentFor) || !ranges.every(range => reader.canRead(range.documentId))) return [];
      const base = row.baseResearch;
      const current = !base.successor && issueSnapshot.revision === base.issue?.revision &&
        issueSnapshot.confirmedAt === (base.issue.confirmedAt?.toISOString() ?? null) &&
        (row.baseCheckedAt?.toISOString() ?? null) === (base.checkedAt?.toISOString() ?? null);
      return [{ row, execution: savedAiExecution(row.aiExecution), researchVersion: base.version,
        issueRevision: issueSnapshot.revision, baselineCurrent: current }];
    });
    const waitingKeys = visible.filter(item => aiInFlight(item.execution)).map(item => aiJobKey(item.row.id));
    const deadJobs = waitingKeys.length ? await tx.jobQueue.findMany({
      where: { dedupeKey: { in: waitingKeys }, status: "DEAD" }, select: { dedupeKey: true },
    }) : [];
    const deadKeys = new Set(deadJobs.map(job => job.dedupeKey));
    const items = visible.map(({ row, execution, ...context }) => ({
      ...viewSummary(row, effectiveAiExecution(execution, deadKeys.has(aiJobKey(row.id)))), ...context,
    }));
    return { items, nextCursor: rows.length > historyPageSize ? page[page.length - 1].row.id : null };
  });
}

export async function readSignoffExcerpt(actor: ContextActor, matterId: string, id: string, fragmentIndex: number) {
  return researchTransaction(prisma, async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const run = await getRun(tx, access, id);
    await readBase(tx, access, run.baseResearchId);
    const [fragment] = await loadFixedFragments(tx, access, fragmentsSchema.parse(run.ranges), false, fragmentIndex);
    return { text: fragment.text };
  });
}

export async function readSignoff(actor: ContextActor, matterId: string, id: string) {
  return researchTransaction(prisma, async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const run = await getRun(tx, access, id);
    const base = await readBase(tx, access, run.baseResearchId);
    const fragments = await loadFixedFragments(tx, access, fragmentsSchema.parse(run.ranges));
    const result = storedResult(run);
    const saved = savedAiExecution(run.aiExecution);
    const job = aiInFlight(saved) ? await tx.jobQueue.findUnique({ where: { dedupeKey: aiJobKey(run.id) }, select: { status: true } }) : null;
    const execution = effectiveAiExecution(saved, job?.status === "DEAD");
    const grants = access.canWrite ? await tx.skillHostGrant.findMany({
      where: { commissionId: run.id, ...liveGrant() }, select: { id: true, host: true, expiresAt: true }, orderBy: { createdAt: "desc" },
    }) : [];
    const current = baselineCurrent(base, run);
    const followUp = run.followUp == null ? null : followUpSchema.parse(run.followUp);
    let continuation: { researchId: string; items: (SignoffItemOrigin & { newerMaterials: MaterialVersionImpact[] })[];
      issueSupplements: ReviewableIssueSupplement[] } | null = null;
    let pendingIssueUpdate: Awaited<ReturnType<typeof previewIssueSupplement>> = null;
    let issueUpdateRequiresReview = false;
    if (access.canWrite && run.adoptedResearchId) {
      try {
        const head = await followUpBasis(tx, access, run);
        if (!baselineCurrent(head.base)) {
          issueUpdateRequiresReview = true;
          pendingIssueUpdate = await previewIssueSupplement(tx, access, head.base);
          issueUpdateRequiresReview = !pendingIssueUpdate;
        } else {
          const recorded = await readRecordedItems(tx, access, head.items);
          continuation = { researchId: head.base.view.id, items: await materialVersionImpacts(tx, access, recorded),
            issueSupplements: await openIssueSupplements(tx, run, base, head.base, recorded) };
        }
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
      }
    }
    const carried = followUp ? (await readRecordedItems(tx, access, followUp.carried)).map(({ origin, decision }) => ({
      ...origin, value: decision.value, reason: decision.reason, disposition: decision.disposition,
    })) : [];
    const settings = access.canWrite && current && !run.exportedAt && !execution && !result && grants.length === 0 ? await getAiSettings(tx) : null;
    const provider = settings?.configured && URL.canParse(settings.baseUrl) ? { model: settings.textModel, origin: new URL(settings.baseUrl).origin } : null;
    return { ...viewSummary(run, execution), method: signoffMethod, baseResearchId: run.baseResearchId, issue: base.issue.title,
      baselineCurrent: current, canWrite: access.canWrite, result, grants, decisions: run.decisions, continuation, pendingIssueUpdate, issueUpdateRequiresReview,
      followUp: followUp ? { priorId: run.priorCommissionId, kind: followUp.kind, newFragments: followUp.newFragments, carried } : null,
      aiProvider: provider, aiExecution: execution ? {
        state: execution.state, model: execution.model, sentCharacters: execution.sentCharacters,
        queuedAt: execution.queuedAt, finishedAt: execution.finishedAt, usage: execution.usage, error: execution.error,
      } : null,
      fragments: fragments.map(({ index, name, version, location, documentId, parseRunId, anchorId, start, end }) =>
        ({ index, name, version, location, documentId, parseRunId, anchorId, start, end })) };
  });
}

export async function changeSignoff(actor: ContextActor, action: SignoffAction, grant?: HostGrant) {
  return researchTransaction(prisma, async tx => {
    const access = await contextAccess(tx, actor, action.matterId, true);
    if (grant && action.action !== "export-signoff" && action.action !== "submit-signoff") throw new ActionError("宿主仅可读取固定输入和提交待核稿");
    if (action.action === "create-signoff" || action.action === "create-issue-signoff") {
      const prior = await tx.skillCommission.findUnique({
        where: { authorId_requestKey: { authorId: actor.id, requestKey: action.requestKey } },
      });
      if (prior) {
        if (prior.matterId !== action.matterId ||
            JSON.stringify(fragmentsSchema.parse(prior.ranges)) !== JSON.stringify(action.ranges)) throw new ActionError("请求已用于不同的委托");
        const base = await readBase(tx, access, prior.baseResearchId);
        const priorFocus = prior.followUp == null ? undefined : followUpSchema.parse(prior.followUp).kind;
        if (action.action === "create-signoff" ? prior.baseResearchId !== action.researchId ||
          (prior.priorCommissionId ?? undefined) !== action.followUp?.priorId || priorFocus !== action.followUp?.kind :
          prior.priorCommissionId !== null ||
          base.issue.id !== action.issue.issueId || base.issue.revision !== action.issue.revision ||
          base.issue.confirmedAt !== action.issue.confirmedAt || base.content.researchedAt !== new Date(action.researchedAt).toISOString()) throw new ActionError("请求已用于不同的委托");
        return { ...viewSummary(prior), baseResearchId: prior.baseResearchId };
      }
      await loadFixedFragments(tx, access, action.ranges, true);
      let researchId: string;
      let checkedAt: string | null = null;
      let followUp: FollowUp | undefined;
      if (action.action === "create-signoff") {
        researchId = action.researchId;
        let base: Awaited<ReturnType<typeof readBase>>;
        if (action.followUp) {
          const { priorId, kind } = action.followUp;
          const prior = await getRun(tx, access, priorId);
          const basis = await followUpBasis(tx, access, prior);
          base = basis.base;
          if (base.view.id !== researchId) throw new ActionError("研究已更新，请重新从委托记录发起补件复核");
          if (!basis.items.some(item => item.kind === kind)) throw new ActionError("该核对项还没有可续办的律师取舍");
          const existing = await readRecordedItems(tx, access, basis.items);
          for (const item of existing) removePriorDecision(base.content, item.origin.kind, item.decision);
          const newFragments = countNewFragments(action.ranges, existing.find(item => item.origin.kind === kind)!.ranges);
          if (!newFragments) throw new ActionError("已选片段均在该核对项的历史委托中，请加入新版本或新片段");
          const carried = basis.items.filter(item => item.kind !== kind);
          followUp = followUpSchema.parse({ kind, carried, newFragments });
        } else {
          base = await readBase(tx, access, researchId);
        }
        if (!baselineCurrent(base) || !base.view.canRevise) throw new ActionError("请在最新争点与研究版本发起委托");
        checkedAt = base.view.checkedAt;
      } else {
        const issue = await tx.evidenceItem.findFirst({ where: { id: action.issue.issueId, matterId: action.matterId, kind: "ISSUE" }, select: { title: true } });
        if (!issue) throw new ActionError("请重新选择本案争点");
        const research = await storeResearchRevision(tx, access, researchSaveSchema.parse({
          ...emptyResearchContent(), matterId: action.matterId, requestKey: action.requestKey, researchedAt: action.researchedAt,
          question: issue.title, purpose: signoffMethod.title, issueSelection: action.issue, supersedesId: null, expectedVersion: null,
        }));
        researchId = research.id;
      }
      const row = await tx.skillCommission.create({ data: {
        matterId: action.matterId, authorId: actor.id, baseResearchId: researchId, baseCheckedAt: checkedAt,
        methodVersion: signoffMethod.version, requestKey: action.requestKey, ranges: action.ranges,
        ...(followUp && action.action === "create-signoff" ? { priorCommissionId: action.followUp!.priorId, followUp } : {}),
      } });
      await auditTx(tx, { userId: actor.id, targetType: "SkillCommission", targetId: row.id, action: "SKILL_COMMISSION_CREATE",
        detail: { matterId: action.matterId, researchId, ranges: action.ranges.length, method: signoffMethod.version,
          ...(followUp ? { focus: followUp.kind, newFragments: followUp.newFragments, reusedItems: followUp.carried.length } : {}) } });
      return { ...viewSummary(row), baseResearchId: researchId };
    }

    const run = await getRun(tx, access, action.id);
    if (grant) {
      const currentGrant = await tx.skillHostGrant.findFirst({
        where: { id: grant.id, tokenHash: grant.tokenHash, commissionId: run.id, ...liveGrant() }, select: { host: true },
      });
      if (!currentGrant || (action.action === "submit-signoff" && currentGrant.host !== action.result.host)) {
        throw new ActionError("宿主授权已过期、撤回或与结果不符");
      }
    }
    if (action.action === "revoke-signoff-host") {
      const removed = await tx.skillHostGrant.updateMany({
        where: { id: action.grantId, commissionId: run.id, revokedAt: null }, data: { revokedAt: new Date() },
      });
      if (removed.count) await auditTx(tx, { userId: actor.id, targetType: "SkillCommission", targetId: run.id, action: "SKILL_HOST_REVOKE",
        detail: { matterId: run.matterId, grantId: action.grantId } });
      return { revoked: Boolean(removed.count) };
    }
    const base = await readBase(tx, access, run.baseResearchId);
    const ranges = fragmentsSchema.parse(run.ranges);
    const followUp = run.followUp == null ? null : followUpSchema.parse(run.followUp);
    if (action.action === "run-signoff-ai") {
      if (run.aiExecution) return viewSummary(run);
      const settings = await getAiSettings(tx);
      if (!settings.configured || !URL.canParse(settings.baseUrl) || settings.textModel !== action.model || new URL(settings.baseUrl).origin !== action.origin) {
        throw new ActionError("应用 AI 未配置或模型设置已变化，请刷新后确认");
      }
      if (!baselineCurrent(base, run) || run.result || run.exportedAt ||
          await tx.skillHostGrant.count({ where: { commissionId: run.id, ...liveGrant() } })) {
        throw new ActionError("请在当前研究上新建委托，固定本次应用 AI 的材料范围");
      }
      const queuedAt = new Date().toISOString();
      const aiExecution: SignoffAiExecution = { state: "QUEUED", model: action.model, baseUrl: settings.baseUrl, queuedAt };
      await tx.jobQueue.create({ data: {
        type: "skill.signoff", payload: { commissionId: run.id }, dedupeKey: aiJobKey(run.id), maxAttempts: 1,
      } });
      const updated = await tx.skillCommission.update({ where: { id: run.id }, data: { aiExecution } });
      await auditTx(tx, { userId: actor.id, targetType: "SkillCommission", targetId: run.id, action: "SKILL_AI_QUEUE",
        detail: { matterId: run.matterId, model: action.model, rangeCount: ranges.length } });
      return viewSummary(updated);
    }
    if (run.aiExecution && (action.action === "grant-signoff-host" || action.action === "export-signoff" || action.action === "submit-signoff")) {
      throw new ActionError("此委托已交由应用 AI 处理");
    }
    if (action.action === "grant-signoff-host") {
      if (!baselineCurrent(base, run) || run.result) throw new ActionError("请在待执行的当前研究委托上授权");
      await loadFixedFragments(tx, access, ranges, true);
      if (await tx.skillHostGrant.count({ where: { commissionId: run.id, ...liveGrant() } }) >= 3) {
        throw new ActionError("请先撤回一条现有宿主授权");
      }
      const token = randomBytes(32).toString("hex");
      const newGrant = await tx.skillHostGrant.create({ data: {
        commissionId: run.id, tokenHash: hashSkillToken(token), host: action.host, expiresAt: new Date(Date.now() + grantDuration),
      } });
      await auditTx(tx, { userId: actor.id, targetType: "SkillCommission", targetId: run.id, action: "SKILL_HOST_GRANT",
        detail: { matterId: run.matterId, grantId: newGrant.id, host: action.host } });
      return { id: newGrant.id, host: newGrant.host, expiresAt: newGrant.expiresAt, token, endpoint: personalRuntime().origin + PERSONAL_SKILL_MCP_PATH };
    }
    if (action.action === "export-signoff") {
      if (!baselineCurrent(base, run) || run.result) throw new ActionError("只有待执行的当前委托可以读取输入包");
      const fragments = await loadFixedFragments(tx, access, ranges, true);
      if (!run.exportedAt) {
        await tx.skillCommission.update({ where: { id: run.id }, data: { exportedAt: new Date() } });
        await auditTx(tx, { userId: actor.id, targetType: "SkillCommission", targetId: run.id, action: "SKILL_COMMISSION_EXPORT",
          detail: { matterId: run.matterId, ranges: fragments.length } });
      }
      return { commissionId: run.id, methodVersion: run.methodVersion, method: signoffMethod, question: base.issue.title,
        fragments: fragments.map(({ index, name, version, location, text }) => ({ index, name, version, location, text })),
        ...(followUp ? { focus: followUp.kind } : {}),
        ...(grant ? {} : { resultSchema: z.toJSONSchema(externalSkillResultSchema) }) };
    }

    if (action.action === "submit-signoff") {
      if (!run.exportedAt || action.result.commissionId !== run.id || action.result.methodVersion !== run.methodVersion) {
        throw new ActionError("结果与已导出的委托标识或方法版本不符");
      }
      const fragments = await loadFixedFragments(tx, access, ranges, true);
      assertSignoffFocus(action.result, followUp?.kind);
      assertSkillCitations(action.result, fragments);
      const previous = storedResult(run);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(action.result)) throw new ActionError("此委托已有待核稿，新一轮请另建委托");
        return viewSummary(run);
      }
      const saved = await tx.skillCommission.update({ where: { id: run.id }, data: {
        result: action.result, submittedAt: new Date(),
      } });
      await auditTx(tx, { userId: actor.id, targetType: "SkillCommission", targetId: run.id, action: "SKILL_COMMISSION_SUBMIT",
        detail: { matterId: run.matterId, hostReported: action.result.host, count: action.result.candidates.length } });
      return viewSummary(saved);
    }

    const result = storedResult(run);
    if (!result || !run.submittedAt) throw new ActionError("此委托尚无待核结果");
    const fragments = await loadFixedFragments(tx, access, ranges);
    if (run.adoptedResearchId) {
      if (JSON.stringify(skillDecisionsSchema.parse(run.decisions)) !== JSON.stringify(action.decisions)) {
        throw new ActionError("已保存取舍，请在现行研究上另存修订");
      }
      return { id: run.adoptedResearchId, replayed: true };
    }
    if (!baselineCurrent(base, run)) throw new ActionError("研究或争点已更新，旧结果仅供回查");
    if (action.decisions.length !== result.candidates.length) throw new ActionError("请逐项记录取舍后保存修订");
    assertSignoffFocus(result, followUp?.kind);
    assertSkillCitations(result, fragments);
    let researchText = { conclusion: base.content.conclusion, unresolved: base.content.unresolved, supportingAnalysis: base.content.supportingAnalysis };
    if (followUp) {
      const priorDecision = await readFollowUpPriorDecision(tx, access, run, followUp);
      researchText = removePriorDecision(researchText, followUp.kind, priorDecision);
    }
    const adopted: string[] = [];
    const missing: string[] = [];
    const reasons: string[] = [];
    const sources = [...base.content.sources];
    for (const decision of action.decisions) {
      const item = result.candidates[decision.candidate];
      if (!item) throw new ActionError("所选候选不属于此委托");
      if (decision.disposition !== "NEEDS_SOURCE" && !item.citations.length) throw new ActionError("没有原文依据的候选只能标记待补出处");
      const paragraphs = decisionParagraphs(item.kind, decision);
      (paragraphs.field === "unresolved" ? missing : adopted).push(paragraphs.judgment);
      reasons.push(paragraphs.reason);
      for (const citation of item.citations) {
        const source = fragments[citation.fragment - 1];
        const { documentId, parseRunId, anchorId } = source;
        if (!sources.some(existing => existing.documentId === documentId && existing.parseRunId === parseRunId &&
          existing.anchorId === anchorId && existing.relation === citation.relation)) {
          sources.push({ documentId, parseRunId, anchorId, relation: citation.relation, lawMetadata: emptyLawMetadata() });
        }
      }
    }
    const append = (previous: string, paragraphs: string[]) => [previous, ...paragraphs].filter(Boolean).join("\n\n");
    const revision = await storeResearchRevision(tx, access, researchSaveSchema.parse({
      ...base.content, matterId: run.matterId, requestKey: run.id, supersedesId: base.view.id, expectedVersion: base.view.version,
      researchedAt: run.submittedAt.toISOString(), conclusion: append(researchText.conclusion, adopted),
      unresolved: append(researchText.unresolved, missing), supportingAnalysis: append(researchText.supportingAnalysis, reasons), sources,
    }));
    await tx.skillCommission.update({ where: { id: run.id }, data: { adoptedResearchId: revision.id, decisions: action.decisions } });
    await auditTx(tx, { userId: actor.id, targetType: "SkillCommission", targetId: run.id, action: "SKILL_COMMISSION_ADOPT",
      detail: { matterId: run.matterId, researchId: revision.id } });
    return revision;
  });
}
