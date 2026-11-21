import { ActionError } from "@/lib/action-error";

export function exactTextRange(text: string, start: number, end: number) {
  function splitsCharacter(offset: number) {
    return /[\uD800-\uDBFF]/.test(text[offset - 1] ?? "") && /[\uDC00-\uDFFF]/.test(text[offset] ?? "");
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
    start < 0 || end <= start || end > text.length || splitsCharacter(start) || splitsCharacter(end)) {
    throw new ActionError("引文或授权范围超出固定片段，或截断了字符");
  }
  return text.slice(start, end);
}

export function uniqueTextRange(text: string, quote: string, context?: string) {
  function locate(haystack: string, needle: string) {
    const start = haystack.indexOf(needle);
    if (!needle || start < 0 || haystack.indexOf(needle, start + 1) >= 0) {
      throw new ActionError("引文未命中或不能在固定片段中唯一定位");
    }
    return start;
  }
  const start = context === undefined ? locate(text, quote) : locate(text, context) + locate(context, quote);
  const end = start + quote.length;
  exactTextRange(text, start, end);
  return { start, end };
}
