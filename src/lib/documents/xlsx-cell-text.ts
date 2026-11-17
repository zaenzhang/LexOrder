import type { CellValue } from "exceljs";

/** The parser and preview must use the same untrimmed, non-recalculated cell text. */
export function xlsxCellText(value: CellValue): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      // Cached values are not recalculated here. Missing/error cache is unprocessed.
      if (["string", "number", "boolean"].includes(typeof value.result)) return String(value.result);
    } else if ("richText" in value) return value.richText.map(run => run.text).join("");
    else if ("text" in value) return value.text;
  }
  return undefined;
}
