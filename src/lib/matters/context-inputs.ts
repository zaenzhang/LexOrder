import { z } from "zod";

export const contextInputSelectionSchema = z.object({
  recordId: z.string().cuid("目标或指示标识无效"),
  expectedCurrentRecordId: z.string().cuid("所见末版标识无效，请重新核对"),
  expectedConfirmedAt: z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString()).nullable(),
}).strict();
export type ContextInputSelection = z.infer<typeof contextInputSelectionSchema>;
export const contextInputSelectionsSchema = z.array(contextInputSelectionSchema).max(20, "一次最多采用 20 条目标或指示")
  .superRefine((rows, ctx) => {
    const seen = new Map<string, ContextInputSelection>();
    for (const row of rows) {
      const previous = seen.get(row.recordId);
      if (previous && (previous.expectedCurrentRecordId !== row.expectedCurrentRecordId || previous.expectedConfirmedAt !== row.expectedConfirmedAt)) {
        ctx.addIssue({ code: "custom", message: "同一记录的核对位置不一致，请重新选择" });
      }
      seen.set(row.recordId, row);
    }
  }).transform(rows => [...new Map(rows.map(row => [row.recordId, row])).values()].sort((a, b) => a.recordId.localeCompare(b.recordId)));

export type ContextInputChoice = {
  selection: ContextInputSelection;
  kind: "GOAL" | "INSTRUCTION";
  version: number;
  content: string;
  sourceDescription: string;
  historical: boolean;
};
export type ContextInputView = ContextInputChoice & {
  currentRecordIdAtAdoption: string;
  adoptedConfirmedAt: string | null;
  changed: boolean;
};
export type ContextInputSummary = { inputs: ContextInputView[]; unavailable: boolean };

/** Carrying old fixed inputs does not acknowledge subsequent changes. */
export function carriedContextInputs(summary: ContextInputSummary | undefined): ContextInputSelection[] {
  return (summary?.inputs ?? []).map(row => ({ recordId: row.selection.recordId,
    expectedCurrentRecordId: row.currentRecordIdAtAdoption, expectedConfirmedAt: row.adoptedConfirmedAt }));
}
