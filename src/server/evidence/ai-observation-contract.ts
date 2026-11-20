import { z } from "zod";
import { observationEventHintSchema } from "@/lib/evidence/chronology-assessment";
import { ActionError } from "@/lib/action-error";
import { relationKindSchema } from "@/lib/evidence/observation-participants";
import { uniqueTextRange } from "@/lib/workbench/fixed-text-range";
import { amountNatureSchema, dateRoleSchema, observationDataSchema, observationInputSchema, statementSchema, type ObservationInput } from "@/lib/evidence/observation-contract";
import { observationIdentity, prepareObservation } from "./observation-contract";

const quote = z.strictObject({ text: z.string().min(1).max(300), context: z.string().min(1).max(1200).optional() });
const linePointer = z.strictObject({
  first: z.number().int().positive().max(1000),
  last: z.number().int().positive().max(1000).optional(),
});
const aiRecord = z.strictObject({
  fragment: z.number().int().positive().max(80),
  statement: statementSchema,
  hint: observationEventHintSchema.optional(),
  excerpt: quote.optional(),
  lines: linePointer.optional(),
  date: z.strictObject({ role: dateRoleSchema, quote }).optional(),
  amount: z.strictObject({ nature: amountNatureSchema, quote, unit: quote.optional() }).optional(),
  participants: z.array(z.strictObject({ quote })).min(1).max(12).optional(),
  relations: z.array(z.strictObject({
    kind: relationKindSchema, from: z.number().int().min(1).max(12), to: z.number().int().min(1).max(12), quote,
  })).min(1).max(12).optional(),
}).refine(value => value.lines || value.excerpt || value.date || value.amount || value.participants?.length);
const observationEnvelope = z.strictObject({ observations: z.array(z.unknown()).max(80) });
export const nativeObservationResultSchema = z.strictObject({ observations: z.array(aiRecord).max(80) });

export const normalizedObservationCandidateSchema = z.strictObject({
  fragment: z.number().int().positive().max(80),
  hint: observationEventHintSchema.optional(),
  input: observationInputSchema,
  data: observationDataSchema,
});

// These labels are directly adjacent to the quoted value in the authorized original.
function explicitAmountNature(text: string, start: number) {
  const before = text.slice(0, start).normalize("NFKC");
  const label = /(余额|交易金额|转账金额|到账金额)[ \t]*(?:\((?:人民币元?|元|CNY|美元|USD|欧元|EUR|港元|HKD)\)[ \t]*)?(?:[:=|][ \t]*)?[ \t]*$/.exec(before)?.[1];
  if (label) return label === "余额" ? "BALANCE" : "ACTUAL_TRANSFER";
}

function explicitDateRole(text: string, start: number) {
  const before = text.slice(0, start).normalize("NFKC");
  const label = /((?:落款|签署|签订|提交|递交|送达|交易|转账|到账)日期)[ \t]*(?:[:=|][ \t]*)?$/.exec(before)?.[1];
  switch (label) {
    case "落款日期": case "签署日期": case "签订日期": return "SIGNATURE";
    case "提交日期": case "递交日期": return "FILING";
    case "送达日期": return "SERVICE";
    case "交易日期": case "转账日期": case "到账日期": return "OCCURRENCE";
  }
}

type TextSpan = { start: number; end: number };
type AuthorizedFragment = { start: number; text: string; category?: string; permitted?: boolean;
  lineSpans?: ReturnType<typeof fragmentLines>; unsettledScopes?: TextSpan[] };

const observationBoundary = /[。！？；!?;]|[，,]\s*(?:但是|但|然而)\s*(?=认可|承认|确认|确实)/gu;
const performanceVerb = /收到|收款|收讫|交付|到账|付款|支付|转账|履行|转款|汇款/u;
const denial = /(?<!不|未|未曾|从未|并未)否认|不认可|不属实|未能证明|不能证明|无法证明|没有证据|无证据/u;
const unfinishedPerformance = /(?:并未|从未|尚未|暂未|没有|未)\s*(?=收到|收款|交付|到账|付款|支付|转账|履行|转款|汇款)/u;
const conditionalPerformance = /如果|假如|假设|倘若|若(?=[于在]?\s*\d{4})|以[^，,\n]{1,36}为条件/u;
const plannedPerformance = /(?:约定|拟|应当?|计划)(?:于|在)\s*\d{4}/u;

function hasPerformanceQualification(text: string) {
  return denial.test(text) || unfinishedPerformance.test(text) || conditionalPerformance.test(text) || plannedPerformance.test(text);
}

function unsettledPerformanceScopes(text: string): TextSpan[] {
  if (!hasPerformanceQualification(text)) return [];
  const ranges: TextSpan[] = [];
  let start = 0;
  function read(end: number) {
    const clause = text.slice(start, end);
    if (hasPerformanceQualification(clause) && performanceVerb.test(clause)) ranges.push({ start, end });
  }
  for (const boundary of text.matchAll(observationBoundary)) {
    read(boundary.index);
    start = boundary.index + boundary[0].length;
  }
  read(text.length);
  return ranges;
}

export function fragmentLines(text: string) {
  const lines: { line: number; start: number; end: number; text: string }[] = [];
  let start = 0;
  for (const [index, line] of text.split("\n").entries()) {
    const end = start + line.length - (line.endsWith("\r") ? 1 : 0);
    lines.push({ line: index + 1, start, end, text: text.slice(start, end) });
    start += line.length + 1;
  }
  return lines;
}

function locateModelQuote(text: string, quote: string, context?: string) {
  try { return uniqueTextRange(text, quote, context); }
  catch (error) {
    if (!(error instanceof ActionError)) throw error;
  }
  // PDFs and copied pleadings can wrap a sentence mid-word. Keep the verified
  // original offsets and text; normalize only whitespace for a unique match.
  const offsets: number[] = [];
  const parts: string[] = [];
  for (let position = 0; position < text.length; position++) {
    if (/\s/u.test(text[position])) continue;
    offsets.push(position);
    parts.push(text[position]);
  }
  const strip = (value: string) => value.replace(/\s/gu, "");
  const span = uniqueTextRange(parts.join(""), strip(quote), context === undefined ? undefined : strip(context));
  return { start: offsets[span.start], end: offsets[span.end - 1] + 1 };
}


function normalizeCandidate(entry: z.infer<typeof aiRecord>, authorized: AuthorizedFragment[], skipField?: () => void) {
  const source = authorized[entry.fragment - 1];
  if (!source) throw new ActionError("候选记载引用了未授权的片段");
  const sourceLines = source.lineSpans ?? fragmentLines(source.text);
  let lineSpan: { start: number; end: number } | undefined;
  if (entry.lines) {
    const first = sourceLines[entry.lines.first - 1];
    const last = sourceLines[(entry.lines.last ?? entry.lines.first) - 1];
    if (!first || !last || last.line < first.line || last.line - first.line > 2 || last.end - first.start > 300) {
      throw new ActionError("行号超出固定片段，或超过引文允许范围");
    }
    lineSpan = { start: first.start, end: last.end };
  }
  function locate(ref: z.infer<typeof quote>, scope?: { start: number; end: number }) {
    if (!scope) return locateModelQuote(source.text, ref.text, ref.context);
    const local = source.text.slice(scope.start, scope.end);
    const range = locateModelQuote(local, ref.text, ref.context);
    return { start: scope.start + range.start, end: scope.start + range.end };
  }
  function absolute(span: { start: number; end: number }) {
    return { start: source.start + span.start, end: source.start + span.end };
  }
  function field<T,>(produce: () => T) {
    try { return produce(); }
    catch (error) {
      if (!skipField || !lineSpan || !(error instanceof ActionError || error instanceof z.ZodError)) throw error;
      skipField();
    }
  }
  const excerptSpan = entry.excerpt ? field(() => locate(entry.excerpt!, lineSpan)) ?? lineSpan : lineSpan;
  const unsettled = source.unsettledScopes ?? unsettledPerformanceScopes(source.text);
  let reviewSpan = excerptSpan;
  let includesUnsettled = false;
  function retainQualification(span: TextSpan) {
    const scoped = unsettled.filter(range => span.start < range.end && range.start < span.end);
    for (const range of scoped) {
      reviewSpan = { start: Math.min(reviewSpan?.start ?? span.start, range.start),
        end: Math.max(reviewSpan?.end ?? span.end, range.end) };
    }
    if (scoped.length) includesUnsettled = true;
    return scoped.length > 0;
  }
  if (excerptSpan) retainQualification(excerptSpan);

  function checkAffirmative(span: TextSpan) {
    if (retainQualification(span)) throw new ActionError("原文中的否认或条件不能作为履行已发生的依据");
  }
  function locateNumber(ref: z.infer<typeof quote>) {
    const span = locate(ref, excerptSpan);
    const { text } = source;
    // Compare with the whole authorized text so a quote starting inside a number cannot hide its prefix.
    const before = text.slice(Math.max(0, span.start - 2), span.start);
    const after = text.slice(span.end, span.end + 2);
    const value = text.slice(span.start, span.end);
    if ((/^\p{Nd}/u.test(value) && /\p{Nd}[,.，．]?$/u.test(before)) ||
      (/\p{Nd}$/u.test(value) && /^[,.，．]?\p{Nd}/u.test(after))) {
      throw new ActionError("候选日期或金额截断了原文数字");
    }
    return span;
  }
  const dateSelection = entry.date && field(() => {
    const value = entry.date!;
    const span = locateNumber(value.quote);
    const labeledRole = explicitDateRole(source.text, span.start);
    if (labeledRole && value.role !== labeledRole && !skipField) throw new ActionError("日期性质与原文标注不符");
    const role = labeledRole ?? value.role;
    if (role === "OCCURRENCE") checkAffirmative(span);
    return { role, span };
  });
  const amountSelection = entry.amount && field(() => {
    const value = entry.amount!;
    const span = locateNumber(value.quote);
    const labeledNature = explicitAmountNature(source.text, span.start);
    if (labeledNature && value.nature !== "OTHER" && value.nature !== labeledNature && !skipField) throw new ActionError("金额性质与原文标注不符");
    const nature = labeledNature ?? value.nature;
    if (nature === "ACTUAL_TRANSFER") checkAffirmative(span);
    const explicitUnit = value.unit && field(() => locate(value.unit!));
    const header = source.category === "EVIDENCE" && lineSpan && !explicitUnit && sourceLines.slice(0, entry.lines!.first - 1).reverse()
      .find(line => /交易日期|转账日期|付款人/u.test(line.text) && /金额（元）|金额\(元\)/u.test(line.text));
    const headerUnit = header && (header.text.includes("金额（元）") ? "金额（元）" : "金额(元)");
    const unitSpan = explicitUnit ?? (header && headerUnit ? locate({ text: headerUnit }, header) : undefined);
    return { nature, span, ...(unitSpan && { unitSpan }) };
  });
  const participantsInput: { span: TextSpan }[] = [];
  const participantIndexes = new Map<number, number>();
  for (const [index, person] of (entry.participants ?? []).entries()) {
    const span = field(() => locate(person.quote, excerptSpan));
    if (!span) continue;
    participantsInput.push({ span });
    participantIndexes.set(index + 1, participantsInput.length);
  }
  const relationsInput = entry.relations?.flatMap(({ quote: reference, from, to, kind }) => {
    const fixed = field(() => {
      const fromIndex = participantIndexes.get(from);
      const toIndex = participantIndexes.get(to);
      if (fromIndex === undefined || toIndex === undefined) throw new ActionError("关系出处须包含两个不同的参与人");
      const span = locate(reference, excerptSpan);
      checkAffirmative(span);
      return { kind, from: fromIndex, to: toIndex, span };
    });
    return fixed ? [fixed] : [];
  });
  const cited = reviewSpan ? source.text.slice(reviewSpan.start, reviewSpan.end) : "";
  if (includesUnsettled && (cited.length > 300 || cited.split("\n").length > 3)) {
    throw new ActionError("候选原文的限定语超出一条引文的范围");
  }
  const hint = includesUnsettled && entry.hint
    ? { ...entry.hint, title: "核对材料中的履行记载", kind: "TODO_VERIFY" as const }
    : entry.hint;
  const attributed = /^(?:.{0,14})(?:诉称|辩称|陈述称|主张称|质证称)[：:,，]/u.test(cited.trim());
  const statement = source.category === "PLEADING" || attributed ? "PARTY_STATEMENT" : entry.statement;
  const core = { statement, ...(reviewSpan && { excerpt: reviewSpan }), ...(dateSelection && { date: dateSelection }), ...(amountSelection && { amount: amountSelection }) };
  const withParticipants = { ...core, ...(participantsInput.length && { participants: participantsInput }) };
  let input: ObservationInput = { ...withParticipants, ...(relationsInput?.length && { relations: relationsInput }) };
  let local: ReturnType<typeof prepareObservation>;
  try { local = prepareObservation(input, source.text); }
  catch (error) {
    if (!skipField || !lineSpan || !participantsInput.length || !(error instanceof ActionError || error instanceof z.ZodError)) throw error;
    skipField();
    const withoutRelations = relationsInput?.length ? field(() => prepareObservation(withParticipants, source.text)) : undefined;
    input = withoutRelations ? withParticipants : core;
    local = withoutRelations ?? prepareObservation(input, source.text);
  }
  const excerpt = local.excerpt && { ...local.excerpt, span: absolute(local.excerpt.span) };
  const date = input.date && { ...input.date, span: absolute(input.date.span) };
  const amount = input.amount && { ...input.amount, span: absolute(input.amount.span),
    ...(input.amount.unitSpan ? { unitSpan: absolute(input.amount.unitSpan) } : {}) };
  const participants = local.participants?.map(person => ({ ...person, span: absolute(person.span) }));
  const relations = local.relations?.map(relation => ({ ...relation, span: absolute(relation.span) }));
  const candidate = {
    fragment: entry.fragment,
    ...(hint && { hint }),
    input: { statement: input.statement, ...(excerpt && { excerpt: excerpt.span }), ...(date && { date }), ...(amount && { amount }),
      ...(participants && { participants: participants.map(({ span }) => ({ span })) }),
      ...(relations && { relations: relations.map(({ text, ...relation }) => relation) }),
    },
    data: { statement: local.statement, ...(excerpt && { excerpt }),
      ...(date && local.date ? { date: { ...local.date, ...date } } : {}),
      ...(amount && local.amount ? { amount: { ...local.amount, ...amount } } : {}),
      ...(participants && { participants }), ...(relations && { relations }) },
  };
  return normalizedObservationCandidateSchema.parse(candidate);
}

function candidateKey(candidate: ReturnType<typeof normalizeCandidate>) {
  return JSON.stringify([candidate.fragment, observationIdentity(candidate.input)]);
}

export function prepareAiObservationResult(raw: unknown, authorized: AuthorizedFragment[]) {
  const { observations } = nativeObservationResultSchema.parse(raw);
  const seen = new Set<string>();
  return observations.map(entry => {
    const candidate = normalizeCandidate(entry, authorized);
    const identity = candidateKey(candidate);
    if (seen.has(identity)) throw new ActionError("同一出处和字段重复输出");
    seen.add(identity);
    return candidate;
  });
}

export function inspectAiObservationResult(raw: unknown, authorized: AuthorizedFragment[]) {
  const { observations } = observationEnvelope.parse(raw);
  const seen = new Set<string>();
  const fragments = authorized.map(source => ({ ...source, lineSpans: fragmentLines(source.text),
    unsettledScopes: unsettledPerformanceScopes(source.text) }));
  const candidates: ReturnType<typeof normalizeCandidate>[] = [];
  let skippedFields = 0;
  const rejected: { index: number; fragment?: number; reason: "SCHEMA" | "RANGE" | "SOURCE" | "DUPLICATE" }[] = [];
  for (const [index, value] of observations.entries()) {
    const parsed = aiRecord.safeParse(value);
    if (!parsed.success) {
      rejected.push({ index, reason: "SCHEMA" });
      continue;
    }
    const { fragment } = parsed.data;
    if (!authorized[fragment - 1] || authorized[fragment - 1].permitted === false) {
      rejected.push({ index, fragment, reason: "RANGE" });
      continue;
    }
    let candidate: ReturnType<typeof normalizeCandidate>;
    try { candidate = normalizeCandidate(parsed.data, fragments, () => { skippedFields++ }); }
    catch (error) {
      if (!(error instanceof ActionError || error instanceof z.ZodError)) throw error;
      rejected.push({ index, fragment, reason: "SOURCE" });
      continue;
    }
    const identity = candidateKey(candidate);
    if (seen.has(identity)) {
      rejected.push({ index, fragment, reason: "DUPLICATE" });
      continue;
    }
    seen.add(identity);
    candidates.push(candidate);
  }
  return { candidates, rejected, skippedFields };
}

/** Only recognize a complete, explicitly labelled bank receipt table. */
export function readBankReceiptCandidates(authorized: AuthorizedFragment[]) {
  const covered = new Set<number>();
  const candidates: ReturnType<typeof normalizeCandidate>[] = [];
  for (const [index, source] of authorized.entries()) {
    if (source.category !== "EVIDENCE") continue;
    const lines = fragmentLines(source.text).filter(line => line.text.trim());
    if (lines.length < 3 || !/银行.*转账回单/u.test(lines[0].text)) continue;
    const cells = (text: string) => text.split(/[｜|\t]/u).map(cell => cell.trim());
    const header = cells(lines[1].text).map(cell => cell.normalize("NFKC"));
    const dateIndex = header.indexOf("交易日期");
    const amountIndex = header.indexOf("金额(元)");
    const fromIndex = header.indexOf("付款人");
    const toIndex = header.indexOf("收款人");
    if ([dateIndex, amountIndex, fromIndex, toIndex].some(column => column < 0)) continue;
    const unit = cells(lines[1].text)[amountIndex];
    const batch: ReturnType<typeof normalizeCandidate>[] = [];
    for (const line of lines.slice(2)) {
      const values = cells(line.text);
      if (values.length !== header.length || !values[dateIndex] || !values[amountIndex] || !values[fromIndex] || !values[toIndex]) break;
      try {
        const candidate = normalizeCandidate({
          fragment: index + 1, statement: "RECORD", lines: { first: line.line },
          hint: { title: "银行转账记载", category: "payment", kind: "FACT" },
          date: { role: "OCCURRENCE", quote: { text: values[dateIndex] } },
          amount: { nature: "ACTUAL_TRANSFER", quote: { text: values[amountIndex] }, unit: { text: unit } },
          participants: [{ quote: { text: values[fromIndex] } }, { quote: { text: values[toIndex] } }],
          relations: [{ from: 1, to: 2, kind: "PAYS_TO", quote: { text: line.text } }],
        }, authorized);
        if (candidate.data.date?.value.precision !== "EXACT" || !candidate.data.amount?.value) break;
        batch.push(candidate);
      } catch (error) {
        if (!(error instanceof ActionError || error instanceof z.ZodError)) throw error;
        break;
      }
    }
    if (batch.length !== lines.length - 2 || candidates.length + batch.length > 80) continue;
    candidates.push(...batch);
    covered.add(index + 1);
  }
  return { candidates, covered };
}

/** Recognize only explicit phrases. These remain attributed statements. */
export function readExplicitPleadingCandidates(authorized: AuthorizedFragment[]) {
  const date = /(?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}-\d{2}-\d{2})/u.source;
  const amount = /\d[\d,]*(?:\.\d+)?\s*(?:万|亿)?\s*元/u.source;
  const delivered = [
    new RegExp("(?<day>" + date + ")\\s*(?:实际|已)?收到借款\\s*(?<amount>" + amount + ")", "gu"),
    new RegExp("(?<day>" + date + ")[^。\\n]{0,28}向[^。\\n]{1,18}借款\\s*(?<amount>" + amount + ")[^。\\n]{0,15}当日交付", "gu"),
  ];
  const withheld = /否认|不认可|不予采信|不属实|不成立|未能证明|不能证明|无法证明|没有证据|无证据|并未|从未|尚未|未收到|未交付|未到账|如果|假如|假设|倘若|若(?=[于在]?\s*\d{4})|约定(?:于|在)?\s*(?:当日交付|\d{4})|(?:拟|将|应当)\s*(?:于|在)?\s*(?:当日交付|\d{4})/u;
  const prepaidInterest = /利息\s*(?:已)?从(?:借款)?本金(?:中)?(?:预先)?扣除/gu;
  const candidates: ReturnType<typeof normalizeCandidate>[] = [];
  for (const [index, source] of authorized.entries()) {
    if (source.category !== "PLEADING") continue;
    // A new affirmative clause after a denial can stand alone. Unclear clauses stay for model or human review.
    const clauses = source.text.split(observationBoundary);
    for (const clause of clauses) {
      if (withheld.test(clause)) continue;
      for (const rule of delivered) {
        for (const match of clause.matchAll(rule)) {
          try {
            const { day, amount: value } = match.groups!;
            const candidate = normalizeCandidate({
              fragment: index + 1, statement: "PARTY_STATEMENT",
              hint: { title: "当事人陈述借款交付", category: "payment", kind: "TODO_VERIFY" },
              excerpt: { text: match[0] },
              date: { role: "OCCURRENCE", quote: { text: day } },
              amount: { nature: "ACTUAL_TRANSFER", quote: { text: value } },
            }, authorized);
            if (candidate.data.date?.value.precision === "EXACT" && candidate.data.amount?.value) candidates.push(candidate);
          } catch (error) {
            if (!(error instanceof ActionError || error instanceof z.ZodError)) throw error;
          }
        }
      }
      for (const match of clause.matchAll(prepaidInterest)) {
        try {
          candidates.push(normalizeCandidate({
            fragment: index + 1, statement: "PARTY_STATEMENT",
            hint: { title: "当事人陈述预扣利息", category: "agreement", kind: "TODO_VERIFY" },
            excerpt: { text: match[0] },
          }, authorized));
        } catch (error) {
          if (!(error instanceof ActionError || error instanceof z.ZodError)) throw error;
        }
      }
    }
  }
  return candidates;
}

export function combineObservationCandidates(candidates: ReturnType<typeof normalizeCandidate>[], additions: ReturnType<typeof normalizeCandidate>[]) {
  const merged = new Map(candidates.map(candidate => [candidateKey(candidate), candidate]));
  for (const candidate of additions) {
    const key = candidateKey(candidate);
    if (!merged.has(key)) merged.set(key, candidate);
  }
  return [...merged.values()];
}
