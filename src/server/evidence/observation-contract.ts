import { Prisma } from "@prisma/client";
import { isEvidenceCalendarDay } from "@/lib/evidence/event-date";
import { ActionError } from "@/lib/action-error";
import { exactTextRange } from "@/lib/workbench/fixed-text-range";
import { amountValueSchema, dateValueSchema, observationInputSchema, type AmountValue, type DateValue, type ObservationData, type ObservationInput } from "@/lib/evidence/observation-contract";

export function observationIdentity(input: ObservationInput) {
  const participantKeys = input.participants?.map(({ span }) => span.start + ":" + span.end);
  const relationKeys = input.relations?.map(({ kind, from, to, span }) =>
    [kind, participantKeys![from - 1], participantKeys![to - 1], span.start, span.end].join("/"));
  return [input.statement, input.date, input.amount, participantKeys?.sort(), relationKeys?.sort(), ...(input.excerpt ? [input.excerpt] : [])];
}

function normalizeDate(text: string, includesClock: boolean): DateValue | null {
  const written = text.normalize("NFKC").trim();
  // A message's day is the day written on its source. Preserve its full time
  // in date.text for review rather than converting it to a different time zone.
  const calendar = includesClock
    ? written.replace(/(?:T|[ \t]+)(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u, "")
    : written;
  const date = calendar.replace(/\s+/g, "");
  const parts = date.split(/至|到|[–—~]/);
  if (parts.length > 2) return null;
  const normalized = parts.map(part => part.match(/^(\d{4})(?:年|-)(\d{1,2})(?:(?:月|-)(\d{1,2})日?|月)?$/));
  if (normalized.some(value => !value)) return null;
  const [start, end] = normalized.map(value => {
    const [, year, month, day] = value!;
    const monthKey = year + "-" + month.padStart(2, "0");
    return day ? monthKey + "-" + day.padStart(2, "0") : monthKey;
  });
  if (end === undefined && /^\d{4}-\d{2}$/.test(start)) {
    const month = dateValueSchema.safeParse({ precision: "MONTH", month: start });
    return month.success ? month.data : null;
  }
  if (!isEvidenceCalendarDay(start)) return null;
  if (!end) return { precision: "EXACT", day: start };
  return isEvidenceCalendarDay(end) && start <= end ? { precision: "RANGE", start, end } : null;
}

const ObservationDecimal = Prisma.Decimal.clone({ precision: 32 });
const currencyTokens = new Map<string, AmountValue["currency"]>([
  ["人民币", "CNY"], ["CNY", "CNY"], ["人民币元", "CNY"], ["元", "CNY"], ["￥", "CNY"], ["¥", "CNY"],
  ["USD", "USD"], ["美元", "USD"], ["EUR", "EUR"], ["欧元", "EUR"], ["€", "EUR"],
  ["HKD", "HKD"], ["港元", "HKD"], ["港币", "HKD"],
]);

function normalizeAmount(text: string, unit: string): AmountValue | null {
  const amount = text.normalize("NFKC").replace(/\s+/g, "");
  const match = amount.match(/^(人民币|CNY|USD|EUR|HKD|¥|€)?(-?(?:\d{1,18}|\d{1,3}(?:,\d{3}){1,5})(?:\.\d{1,6})?)(万|亿)?(人民币元|元|美元|欧元|港元|港币)?$/);
  if (!match) return null;
  const unitText = unit.normalize("NFKC").replace(/\s+/g, "");
  const unitToken = unitText.match(/^(?:金额|交易金额|到账金额|余额)?\(([^()]+)\)$/)?.[1] ?? unitText;
  const [, prefix, number, scale, suffix] = match;
  const tokens = [prefix, suffix, unitToken].filter(Boolean);
  const values = new Set(tokens.map(token => currencyTokens.get(token)));
  const currency = values.values().next().value;
  if (!currency || values.size !== 1) return null;
  const value = new ObservationDecimal(number.replaceAll(",", "")).times(scale === "亿" ? 100_000_000 : scale === "万" ? 10_000 : 1).toFixed();
  const result = amountValueSchema.safeParse({ value, currency });
  return result.success ? result.data : null;
}

const paymentRoles = new Map([
  ["付款人", "payer"], ["付款方", "payer"], ["汇款人", "payer"], ["转出方", "payer"],
  ["收款人", "payee"], ["收款方", "payee"], ["收款户名", "payee"], ["转入方", "payee"],
]);

function explicitPaymentRole(text: string, span: { start: number; end: number }) {
  const lineStart = text.lastIndexOf("\n", span.start - 1) + 1;
  const before = text.slice(lineStart, span.start).normalize("NFKC");
  const label = /(付款人|付款方|汇款人|转出方|收款人|收款方|收款户名|转入方)[ \t]*[:=][ \t]*$/.exec(before)?.[1];
  if (label) return paymentRoles.get(label);

  const newline = text.indexOf("\n", span.start);
  const lineEnd = newline < 0 ? text.length : newline;
  if (span.end > lineEnd) return;
  const columns = text.slice(lineStart, lineEnd).split(/[|｜\t]/);
  if (columns.length < 2) return;
  const index = text.slice(lineStart, span.start).split(/[|｜\t]/).length - 1;
  if (index !== text.slice(lineStart, span.end).split(/[|｜\t]/).length - 1) return;
  let headerEnd = lineStart - 1;
  for (let distance = 0; headerEnd > 0 && distance < 4; distance++) {
    const headerStart = text.lastIndexOf("\n", headerEnd - 1) + 1;
    const header = text.slice(headerStart, headerEnd).split(/[|｜\t]/).map(cell => cell.trim());
    if (header.length !== columns.length) break;
    const roles = header.map(cell => paymentRoles.get(cell));
    if (roles.includes("payer") && roles.includes("payee")) return roles[index];
    headerEnd = headerStart - 1;
  }
}

export function prepareObservation(raw: unknown, anchorText: string): ObservationData {
  const input = observationInputSchema.parse(raw);
  const excerpt = input.excerpt && (() => {
    const text = exactTextRange(anchorText, input.excerpt.start, input.excerpt.end);
    if (!text.trim() || text.length > 300) throw new ActionError("原文记载须在 1 至 300 个字符内");
    return { span: input.excerpt, text };
  })();
  const date = input.date && (() => {
    const { role, span, suggested } = input.date;
    const text = exactTextRange(anchorText, span.start, span.end);
    const normalized = normalizeDate(text, role === "SENT" || role === "RECEIVED");
    if (normalized && suggested && JSON.stringify(suggested) !== JSON.stringify(normalized)) {
      throw new ActionError("候选日期与选定原文不符");
    }
    return { role, span, text, value: normalized ?? { precision: "UNKNOWN" as const } };
  })();
  const amount = input.amount && (() => {
    const { nature, span, unitSpan, suggested } = input.amount;
    const text = exactTextRange(anchorText, span.start, span.end);
    const unit = unitSpan ? exactTextRange(anchorText, unitSpan.start, unitSpan.end) : "";
    const normalized = normalizeAmount(text, unit);
    if (normalized && suggested && (normalized.currency !== suggested.currency || !new Prisma.Decimal(normalized.value).eq(suggested.value))) {
      throw new ActionError("候选金额或币种与选定原文不符");
    }
    return { nature, span, ...(unitSpan ? { unitSpan, unit } : {}), text, value: normalized };
  })();
  const read = ({ start, end }: { start: number; end: number }) => {
    const text = exactTextRange(anchorText, start, end);
    if (!text.trim()) throw new ActionError("人物或关系出处不能为空");
    return text;
  };
  const participants = input.participants?.map(({ span }) => ({ span, text: read(span) }));
  const relations = input.relations?.map(relation => {
    if (relation.kind === "PAYS_TO") {
      const from = explicitPaymentRole(anchorText, participants![relation.from - 1].span);
      const to = explicitPaymentRole(anchorText, participants![relation.to - 1].span);
      if (from === "payee" || to === "payer") throw new ActionError("付款方向与原文标注不符");
    }
    return { ...relation, text: read(relation.span) };
  });
  return { statement: input.statement, ...(excerpt && { excerpt }), ...(date && { date }), ...(amount && { amount }),
    ...(participants && { participants }), ...(relations && { relations }) };
}
