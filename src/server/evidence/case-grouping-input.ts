import type { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { caseCandidateKey, type CaseCandidateRef } from "@/lib/evidence/case-adoption";
import { caseGroupingLimits, caseGroupingResultSchema } from "@/lib/evidence/case-grouping";
import type { FragmentSelection } from "@/lib/workbench/fixed-fragments";
import { loadFixedFragments, type FixedFragment } from "@/server/ai/fixed-fragments";
import type { ContextAccess } from "@/server/matters/context-service";
import { observationIdentity } from "./observation-contract";
import { matterObservationRangesSchema, observationCandidatesSchema } from "./analysis-run-contract";

function rangeKey(range: FragmentSelection) {
  return JSON.stringify([range.documentId, range.parseRunId, range.anchorId, range.start, range.end]);
}

function contextWindow(fragment: FixedFragment, span: { start: number; end: number }) {
  const start = span.start - fragment.start;
  const end = span.end - fragment.start;
  if (start < 0 || end > fragment.text.length || end <= start) throw new ActionError("候选引文超出固定选区");
  let from = Math.max(0, start - 72);
  let to = Math.min(fragment.text.length, end + 72);
  if (/[\uDC00-\uDFFF]/.test(fragment.text.charAt(from))) from--;
  if (/[\uDC00-\uDFFF]/.test(fragment.text.charAt(to))) to++;
  return { from, to };
}

function contextSnippets(fragment: FixedFragment, spans: { start: number; end: number }[]) {
  const windows = spans.map(span => contextWindow(fragment, span)).sort((a, b) => a.from - b.from);
  const merged: typeof windows = [];
  for (const window of windows) {
    const last = merged.at(-1);
    if (last && window.from <= last.to) last.to = Math.max(last.to, window.to);
    else merged.push(window);
  }
  return merged.map(({ from, to }) => fragment.text.slice(from, to));
}

export async function groupingMembers(tx: Prisma.TransactionClient, access: ContextAccess, refs: CaseCandidateRef[], forModel: boolean) {
  const runIds = [...new Set(refs.map(ref => ref.runId))];
  const rows = await tx.evidenceObservationRun.findMany({
    where: { id: { in: runIds }, caseMatterId: access.matter.id, authorId: access.user.id,
      state: "READY" },
    select: { id: true, ranges: true, candidates: true },
  });
  if (rows.length !== runIds.length) throw new ActionError("部分候选批次不可用或不属于本案");
  const batches = new Map(rows.map(row => [row.id, {
    ranges: matterObservationRangesSchema.parse(row.ranges), candidates: observationCandidatesSchema.parse(row.candidates),
  }]));
  const ranges = new Map<string, FragmentSelection>();
  const picks = refs.map(ref => {
    const { ranges: batchRanges, candidates } = batches.get(ref.runId)!;
    const candidate = candidates[ref.index];
    const range = candidate && batchRanges[candidate.fragment - 1];
    if (!range) throw new ActionError("候选不属于固定批次");
    const rangeId = rangeKey(range);
    ranges.set(rangeId, range);
    return { ref, candidate, rangeId };
  });
  const fragments = await loadFixedFragments(tx, access, [...ranges.values()], forModel);
  const sourceByRange = new Map(fragments.map(fragment => [rangeKey(fragment), fragment]));
  const used = await tx.caseObservationCandidateAdoption.findMany({
    where: { OR: refs.map(({ runId, index }) => ({ runId, candidateIndex: index })) },
    select: { runId: true, candidateIndex: true, adoption: { select: { evidenceItemId: true } } },
  });
  const adopted = new Map(used.map(row => [caseCandidateKey({ runId: row.runId, index: row.candidateIndex }), row.adoption.evidenceItemId]));
  return picks.map(({ ref, candidate, rangeId }, index) => {
    const fragment = sourceByRange.get(rangeId)!;
    const { statement, excerpt, date, amount, participants, relations } = candidate.data;
    const spans = [excerpt?.span, date?.span, amount?.span, ...participants?.map(person => person.span) ?? [], ...relations?.map(link => link.span) ?? []];
    const contexts = contextSnippets(fragment, spans.filter((span): span is NonNullable<typeof span> => Boolean(span)));
    return {
      ref, source: { documentId: fragment.documentId, name: fragment.name, version: fragment.version, location: fragment.location },
      adoptedItemId: adopted.get(caseCandidateKey(ref)) ?? null,
      exactIdentity: JSON.stringify([fragment.documentId, fragment.parseRunId, fragment.anchorId, observationIdentity(candidate.input)]),
      summary: {
        observation: index + 1, statement, contexts, ...(excerpt && { excerpt: excerpt.text }), ...(candidate.hint && { hint: candidate.hint }),
        ...(date && { date: { role: date.role, quote: date.text, value: date.value } }),
        ...(amount && { amount: { nature: amount.nature, quote: amount.text, value: amount.value } }),
        ...(participants && { participants: participants.map(({ text }) => text) }),
        ...(relations && { relations: relations.map(({ kind, from, to, text }) => ({ kind, from, to, quote: text })) }),
      },
    };
  });
}

export type GroupingMember = Awaited<ReturnType<typeof groupingMembers>>[number];

export function groupingPayload(members: GroupingMember[]) {
  if (members.some(member => member.adoptedItemId)) throw new ActionError("部分候选已被采用，请重新选择归并范围");
  if (new Set(members.map(member => member.exactIdentity)).size !== members.length) {
    throw new ActionError("所选候选含重复固定出处与字段，请去掉重复记载");
  }
  const text = JSON.stringify({ observations: members.map(member => member.summary) });
  if (text.length > caseGroupingLimits.characters) throw new ActionError("候选摘要超过本批字符上限，请缩小范围");
  return text;
}

export function validateGrouping(raw: unknown, members: GroupingMember[]) {
  const result = caseGroupingResultSchema.parse(raw);
  const seen = new Set<number>();
  for (const group of result.groups) for (const member of group.members) {
    const observation = members[member.observation - 1]?.summary;
    if (!observation || seen.has(member.observation)) throw new ActionError("归并建议重复或引用了未授权候选");
    if (!member.quote.trim() || !observation.contexts.some(context => context.includes(member.quote))) {
      throw new ActionError("归并建议的引文不在该候选摘要中");
    }
    seen.add(member.observation);
  }
  return result;
}

export function publicGroupingMember({ ref, source, summary, adoptedItemId }: GroupingMember) {
  return { ...ref, source, ...summary, adoptedItemId };
}
