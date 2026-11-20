import type { EvidenceObservationRun, Prisma } from "@prisma/client";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { aiChat, AiNotConfiguredError, extractJson } from "@/lib/ai/client";
import { getAiSettings } from "@/lib/ai/settings";
import { fragmentsSchema, type FragmentSelection } from "@/lib/workbench/fixed-fragments";
import { prisma } from "@/lib/prisma";
import { loadFixedFragments } from "@/server/ai/fixed-fragments";
import { auditTx } from "@/server/audit";
import { assertCurrentJobLease, type JobLease } from "@/server/cron/queue";
import { contextAccess, type ContextAccess, type ContextActor } from "@/server/matters/context-service";
import { researchTransaction } from "@/server/research/service";
import { resolvePersonalActor } from "@/server/runtime/personal";
import { combineObservationCandidates, fragmentLines, inspectAiObservationResult, readBankReceiptCandidates, readExplicitPleadingCandidates } from "./ai-observation-contract";
import { observationExtractionSchema, observationSystemPrompt, unpackObservationDraft } from "./observation-extraction-skill";
import {
  observationAdoptionSchema, observationCandidatesSchema, observationJobKey, observationMethodVersion, observationRangesSchema,
  observationRunIdSchema, observationRunJob, observationRunReceiptSchema, observationProviderUsageSchema, startObservationRunSchema,
  matterObservationMethodVersion, matterObservationRangesSchema, readObservationInput, startMatterObservationRunSchema,
} from "./analysis-run-contract";

const jobInput = z.strictObject({ runId: observationRunIdSchema });
type Receipt = z.infer<typeof observationRunReceiptSchema>;

async function analysisItem(tx: Prisma.TransactionClient, matterId: string, itemId: string) {
  const item = await tx.evidenceItem.findFirst({
    where: { id: itemId, matterId },
    select: { id: true, matterId: true, revision: true, title: true, sources: {
      where: { removedAt: null },
      select: { id: true, documentId: true, parseRunId: true, anchorId: true, documentSha256: true },
    } },
  });
  if (!item) throw new ActionError("要点不存在或不属于本案");
  return item;
}
type AnalysisItem = Awaited<ReturnType<typeof analysisItem>>;

function freezeRanges(item: AnalysisItem, ranges: z.infer<typeof startObservationRunSchema>["ranges"]) {
  const fixed = observationRangesSchema.parse(ranges.map(range => {
    const source = item.sources.find(entry => entry.id === range.sourceId);
    if (!source?.parseRunId || !source.anchorId) throw new ActionError("只可分析当前要点的固定解析出处");
    const { documentId, parseRunId, anchorId } = source;
    return { ...range, documentId, parseRunId, anchorId };
  }));
  fragmentsSchema.parse(fixed.map(({ documentId, parseRunId, anchorId, start, end }) =>
    ({ documentId, parseRunId, anchorId, start, end })));
  return fixed;
}

type RunScope = Pick<EvidenceObservationRun, "evidenceItemId" | "ranges">;

function runInput(run: RunScope) {
  const { ranges, categoryByDocument } = readObservationInput(run.ranges);
  return {
    ranges: run.evidenceItemId ? observationRangesSchema.parse(ranges) : matterObservationRangesSchema.parse(ranges),
    categoryByDocument,
  };
}

async function freezeObservationInput(tx: Prisma.TransactionClient, access: ContextAccess, ranges: FragmentSelection[]) {
  const fragments = await loadFixedFragments(tx, access, ranges, true);
  return { ranges, categoryByDocument: Object.fromEntries(fragments.map(({ documentId, category }) => [documentId, category])) };
}

type RunMetadata = RunScope & Pick<EvidenceObservationRun,
  "id" | "receipt" | "state" | "baseRevision" | "model" | "createdAt" | "methodVersion">;

function runSummary(run: RunMetadata, itemRevision: number | null, dead = false) {
  const { ranges } = runInput(run);
  const receipt = run.receipt == null ? null : observationRunReceiptSchema.parse(run.receipt);
  const interrupted = dead && run.state === "DISPATCHED";
  return {
    id: run.id, baseRevision: run.baseRevision, stale: run.baseRevision !== itemRevision,
    state: interrupted ? "UNCERTAIN" : dead && run.state === "QUEUED" ? "FAILED" : run.state,
    model: run.model, createdAt: run.createdAt, methodVersion: run.methodVersion,
    rangeCount: ranges.length, authorizedCharacters: ranges.reduce((count, range) => count + range.end - range.start, 0),
    receipt: interrupted ? { ...receipt, error: "INTERRUPTED" } : dead && run.state === "QUEUED" ? { ...receipt, error: "UNAVAILABLE" } : receipt,
  };
}

async function currentRunSummary(tx: Prisma.TransactionClient, run: RunMetadata, itemRevision: number | null) {
  const job = run.state === "QUEUED" || run.state === "DISPATCHED"
    ? await tx.jobQueue.findUnique({ where: { dedupeKey: observationJobKey(run.id) }, select: { status: true } })
    : null;
  return runSummary(run, itemRevision, job?.status === "DEAD");
}

async function reusableObservationRun(tx: Prisma.TransactionClient, where: Prisma.EvidenceObservationRunWhereInput, baseRevision: number | null) {
  const matching = await tx.evidenceObservationRun.findFirst({
    where: { ...where, baseRevision, state: { not: "FAILED" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, evidenceItemId: true, ranges: true, receipt: true, state: true,
      baseRevision: true, model: true, createdAt: true, methodVersion: true },
  });
  if (!matching) return;
  const status = await currentRunSummary(tx, matching, baseRevision);
  if (status.state !== "FAILED") return status;
}

export async function readObservationRuns(actor: ContextActor, matterId: string, evidenceItemId: string | null, runId?: string, cursor?: string) {
  return prisma.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const item = evidenceItemId ? await analysisItem(tx, matterId, evidenceItemId) : null;
    const scope = item ? { evidenceItemId: item.id } : { caseMatterId: matterId };
    if (runId) {
      const run = await tx.evidenceObservationRun.findFirst({ where: { id: runId, authorId: actor.id, ...scope } });
      if (!run) throw new ActionError("该待核批次不属于当前事项");
      const status = await currentRunSummary(tx, run, item?.revision ?? null);
      const { ranges } = runInput(run);
      const excerpts = run.candidates == null ? [] : await loadFixedFragments(tx, access, ranges);
      const caseAdoptions = item ? undefined : await tx.caseObservationCandidateAdoption.findMany({
        where: { runId: run.id }, orderBy: { candidateIndex: "asc" },
        select: { candidateIndex: true, adoption: { select: { evidenceItemId: true, revision: true } } },
      });
      return {
        ...status,
        sources: excerpts.map(({ name, version, location, start, end }, i) => {
          const range = ranges[i];
          return { sourceId: "sourceId" in range ? range.sourceId : null, name, version, location, start, end };
        }),
        candidates: run.candidates == null ? [] : observationCandidatesSchema.parse(run.candidates),
        adoption: run.adoption == null ? null : observationAdoptionSchema.parse(run.adoption),
        ...(caseAdoptions && { canAdopt: access.canWrite, caseAdoptions: caseAdoptions.map(({ candidateIndex, adoption }) =>
          ({ index: candidateIndex, ...adoption })) }),
      };
    }
    const where = { ...scope, authorId: actor.id };
    if (cursor && !await tx.evidenceObservationRun.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) {
      throw new ActionError("分页位置不属于当前分析记录");
    }
    const limit = 20;
    const rows = await tx.evidenceObservationRun.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: item ? limit : limit + 1,
      select: { id: true, evidenceItemId: true, ranges: true, receipt: true, state: true,
        baseRevision: true, model: true, createdAt: true, methodVersion: true },
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    const nextCursor = rows.length > limit ? rows[limit - 1].id : null;
    const runs = nextCursor ? rows.slice(0, limit) : rows;
    const pendingKeys = runs.filter(run => run.state === "QUEUED" || run.state === "DISPATCHED")
      .map(run => observationJobKey(run.id));
    const [deadJobs, settings] = await Promise.all([
      pendingKeys.length ? tx.jobQueue.findMany({
        where: { dedupeKey: { in: pendingKeys }, status: "DEAD" }, select: { dedupeKey: true },
      }) : [],
      access.canWrite ? getAiSettings(tx) : null,
    ]);
    const deadKeys = new Set(deadJobs.map(job => job.dedupeKey));
    const destination = settings?.configured && URL.canParse(settings.baseUrl)
      ? { model: settings.textModel, origin: new URL(settings.baseUrl).origin } : null;
    return { destination, runs: runs.map(run => runSummary(run, item?.revision ?? null, deadKeys.has(observationJobKey(run.id)))),
      ...(!item && { nextCursor }) };
  }, { timeout: 20000 });
}

export async function readMatterObservationExcerpt(actor: ContextActor, matterId: string, runId: string, fragment: number) {
  return prisma.$transaction(async tx => {
    const access = await contextAccess(tx, actor, matterId);
    const run = await tx.evidenceObservationRun.findFirst({
      where: { id: runId, authorId: actor.id, caseMatterId: matterId, state: "READY" },
      select: { ranges: true },
    });
    if (!run) throw new ActionError("该待核批次不属于当前事项");
    const ranges = matterObservationRangesSchema.parse(readObservationInput(run.ranges).ranges);
    const range = ranges[fragment - 1];
    if (!range) throw new ActionError("片段不属于本批次");
    const [excerpt] = await loadFixedFragments(tx, access, [range]);
    return { text: excerpt.text };
  });
}

export async function queueObservationRun(actor: ContextActor, raw: z.input<typeof startObservationRunSchema>) {
  const input = startObservationRunSchema.parse(raw);
  return researchTransaction(prisma, async tx => {
    const access = await contextAccess(tx, actor, input.matterId, true);
    const item = await analysisItem(tx, input.matterId, input.evidenceItemId);
    const existing = await tx.evidenceObservationRun.findUnique({ where: { id: input.runId } });
    if (existing) {
      if (existing.evidenceItemId !== item.id || existing.authorId !== actor.id || existing.baseRevision !== input.expectedRevision ||
        existing.model !== input.model || new URL(existing.baseUrl).origin !== input.origin) throw new ActionError("此委托标识已绑定其他范围");
      const ranges = observationRangesSchema.parse(readObservationInput(existing.ranges).ranges).map(({ sourceId, start, end }) => ({ sourceId, start, end }));
      if (JSON.stringify(ranges) !== JSON.stringify(input.ranges)) throw new ActionError("此委托标识已绑定其他范围");
      return currentRunSummary(tx, existing, item.revision);
    }
    if (item.revision !== input.expectedRevision) throw new ActionError("要点已更新，请重新确认材料范围");
    const settings = await requireObservationDestination(tx, input);
    const frozen = await freezeObservationInput(tx, access, freezeRanges(item, input.ranges));
    const scope = { evidenceItemId: item.id, authorId: actor.id, methodVersion: observationMethodVersion,
      model: settings.textModel, baseUrl: settings.baseUrl };
    const matching = await reusableObservationRun(tx, { ...scope, ranges: { equals: frozen } }, item.revision);
    if (matching) return matching;
    const run = await enqueueObservation(tx, {
      ...scope, id: input.runId, baseRevision: item.revision, ranges: frozen, state: "QUEUED",
    }, input.matterId);
    return runSummary(run, item.revision);
  });
}

export async function requireObservationDestination(tx: Prisma.TransactionClient, input: { model: string; origin: string }) {
  const settings = await getAiSettings(tx);
  if (!settings.configured || !URL.canParse(settings.baseUrl) || settings.textModel !== input.model ||
    new URL(settings.baseUrl).origin !== input.origin) throw new ActionError("应用 AI 未配置或模型已变更，请刷新后确认");
  return settings;
}

function auditTarget(run: EvidenceObservationRun, matterId: string) {
  return run.evidenceItemId ? { targetType: "EvidenceItem", targetId: run.evidenceItemId } : { targetType: "Matter", targetId: matterId };
}

async function enqueueObservation(tx: Prisma.TransactionClient, data: Prisma.EvidenceObservationRunUncheckedCreateInput, matterId: string) {
  const run = await tx.evidenceObservationRun.create({ data });
  await tx.jobQueue.create({ data: {
    type: observationRunJob, payload: { runId: run.id }, dedupeKey: observationJobKey(run.id), maxAttempts: 1,
  } });
  const { ranges, categoryByDocument } = runInput(run);
  await auditTx(tx, { userId: run.authorId, action: "EVIDENCE_AI_QUEUE", ...auditTarget(run, matterId),
    detail: { matterId, runId: run.id, model: run.model, categoryByDocument,
      ranges: ranges.map(({ documentId, parseRunId, anchorId, start, end }) => ({ documentId, parseRunId, anchorId, start, end })) } });
  return run;
}

export async function queueMatterObservationRun(actor: ContextActor, raw: z.input<typeof startMatterObservationRunSchema>) {
  const input = startMatterObservationRunSchema.parse(raw);
  return researchTransaction(prisma, async tx => {
    // contextAccess locks the matter so identical confirmations serialize.
    const access = await contextAccess(tx, actor, input.matterId, true);
    const frozen = await freezeObservationInput(tx, access, input.ranges);
    const existing = await tx.evidenceObservationRun.findUnique({ where: { id: input.runId } });
    if (existing) {
      if (existing.caseMatterId !== input.matterId || existing.authorId !== actor.id || existing.model !== input.model ||
        new URL(existing.baseUrl).origin !== input.origin ||
        JSON.stringify(runInput(existing).ranges) !== JSON.stringify(input.ranges)) throw new ActionError("此委托标识已绑定其他范围");
      return currentRunSummary(tx, existing, null);
    }
    const settings = await requireObservationDestination(tx, input);
    const scope = { caseMatterId: input.matterId, authorId: actor.id, methodVersion: matterObservationMethodVersion,
      model: settings.textModel, baseUrl: settings.baseUrl };
    const matching = await reusableObservationRun(tx, { ...scope, ranges: { equals: frozen } }, null);
    if (matching) return matching;
    const run = await enqueueObservation(tx, {
      ...scope, id: input.runId, ranges: frozen, state: "QUEUED",
    }, input.matterId);
    return runSummary(run, null);
  });
}

export async function processObservationRun(payload: Record<string, unknown>, lease: JobLease) {
  const { runId } = jobInput.parse(payload);
  const dispatch = await researchTransaction(prisma, async tx => {
    await assertCurrentJobLease(tx, lease);
    const run = await tx.evidenceObservationRun.findUniqueOrThrow({ where: { id: runId }, include: { evidenceItem: { select: { matterId: true } } } });
    if (run.state === "DISPATCHED") {
      const prior = observationRunReceiptSchema.parse(run.receipt);
      await tx.evidenceObservationRun.update({ where: { id: run.id }, data: { state: "UNCERTAIN", receipt: {
        ...prior, error: "INTERRUPTED", finishedAt: new Date().toISOString(),
      } } });
      return null;
    }
    if (run.state !== "QUEUED") return null;
    const matterId = run.caseMatterId ?? run.evidenceItem!.matterId;
    try {
      const actor = await resolvePersonalActor(tx, run.authorId);
      if (!actor) throw new ActionError("本机工作区不可用");
      const access = await contextAccess(tx, actor, matterId, true);
      const item = run.evidenceItemId ? await analysisItem(tx, matterId, run.evidenceItemId) : null;
      const method = item ? observationMethodVersion : matterObservationMethodVersion;
      const { ranges, categoryByDocument } = runInput(run);
      if ((item?.revision ?? null) !== run.baseRevision || run.methodVersion !== method ||
        !categoryByDocument || ranges.some(range => !categoryByDocument[range.documentId])) {
        await tx.evidenceObservationRun.update({ where: { id: run.id }, data: {
          state: "FAILED", receipt: { error: "STALE", finishedAt: new Date().toISOString() },
        } });
        return null;
      }
      const fragments = (await loadFixedFragments(tx, access, ranges, true))
        .map(fragment => ({ ...fragment, category: categoryByDocument[fragment.documentId] }));
      const receipt: Receipt = { dispatchedAt: new Date().toISOString() };
      await tx.evidenceObservationRun.update({ where: { id: run.id }, data: { state: "DISPATCHED", receipt } });
      return { run, ranges, fragments, title: item?.title ?? "案卷事实", matterId, receipt };
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      await tx.evidenceObservationRun.update({ where: { id: run.id }, data: {
        state: "FAILED", receipt: { error: "PERMISSION", finishedAt: new Date().toISOString() },
      } });
      return null;
    }
  });
  if (!dispatch) return;

  const { run, ranges, fragments, title, matterId, receipt } = dispatch;
  const local = readBankReceiptCandidates(fragments);
  const remaining = fragments.filter(fragment => !local.covered.has(fragment.index));
  const localCandidates = combineObservationCandidates(local.candidates, readExplicitPleadingCandidates(fragments));
  let candidates: ReturnType<typeof inspectAiObservationResult>["candidates"] | undefined =
    localCandidates.length <= 80 && localCandidates.length ? localCandidates : undefined;
  if (candidates) receipt.localRecords = candidates.length;
  if (!remaining.length) receipt.sentCharacters = 0;
  else try {
    const reply = await aiChat({
      messages: [
        { role: "system", content: observationSystemPrompt(Boolean(run.evidenceItemId)) },
        { role: "user", content: JSON.stringify({ title, fragments: remaining.map(({ index, text, name, category }) => ({
          index, material: name, category, lines: fragmentLines(text).map(({ line, text }) => ({ line, text })),
        })) }) },
      ],
      expectedDestination: { baseUrl: run.baseUrl, model: run.model }, jsonObject: true,
      jsonSchema: { name: "lexorder_observations", schema: observationExtractionSchema },
      maxTokens: 4200, temperature: 0, timeoutMs: 60_000, logAction: "evidence-observations", userId: run.authorId,
    });
    receipt.sentCharacters = remaining.reduce((length, fragment) => length + fragment.text.length, 0);
    const usage = observationProviderUsageSchema.safeParse(reply.raw);
    if (usage.success) receipt.usage = { inputTokens: usage.data.usage.prompt_tokens, outputTokens: usage.data.usage.completion_tokens };
    try {
      const normalized = unpackObservationDraft(extractJson(reply.content));
      const result = inspectAiObservationResult(normalized, fragments.map(fragment => ({ ...fragment, permitted: !local.covered.has(fragment.index) })));
      if (result.rejected.length) receipt.rejected = result.rejected;
      if (result.skippedFields) receipt.skippedFields = result.skippedFields;
      if (result.candidates.length || !result.rejected.length) {
        const combined = combineObservationCandidates(localCandidates, result.candidates);
        if (combined.length > 80) throw new ActionError("候选记载超出批次上限");
        candidates = combined;
      } else receipt.error = "INVALID_RESULT";
    } catch { receipt.error = "INVALID_RESULT"; }
  } catch (error) {
    receipt.error = error instanceof AiNotConfiguredError ? "UNAVAILABLE" : error instanceof Error && error.name === "AbortError" ? "INTERRUPTED" : "PROVIDER";
  }

  await researchTransaction(prisma, async tx => {
    await assertCurrentJobLease(tx, lease);
    if (candidates) {
      try {
        const actor = await resolvePersonalActor(tx, run.authorId);
        if (!actor) throw new ActionError("本机工作区不可用");
        await loadFixedFragments(tx, await contextAccess(tx, actor, matterId, true), ranges, true);
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
        candidates = undefined;
        receipt.error = "PERMISSION";
      }
    }
    receipt.finishedAt = new Date().toISOString();
    await tx.evidenceObservationRun.update({ where: { id: run.id }, data: {
      state: candidates ? "READY" : receipt.error === "INTERRUPTED" ? "UNCERTAIN" : "FAILED", receipt,
      ...(candidates ? { candidates } : {}),
    } });
    await auditTx(tx, { userId: run.authorId, action: candidates ? "EVIDENCE_AI_CANDIDATES" : "EVIDENCE_AI_FAIL",
      ...auditTarget(run, matterId), detail: { matterId, runId: run.id, ...(receipt.error ? { error: receipt.error } : {}) } });
  });
}
