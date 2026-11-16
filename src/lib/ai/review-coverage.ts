import { z } from "zod";

export const REVIEW_SEGMENT_CHARS = 6000;
export const REVIEW_MAX_SEGMENTS = 6;

export const reviewCoverageSchema = z.strictObject({
  totalChars: z.number().int().nonnegative(),
  totalSegments: z.number().int().positive(),
  segments: z.array(z.strictObject({
    index: z.number().int().positive(),
    chars: z.number().int().positive(),
    status: z.enum(["SUCCEEDED", "FAILED"]),
    errorCode: z.enum(["REQUEST_FAILED", "INVALID_RESPONSE"]).nullable(),
  })).max(REVIEW_MAX_SEGMENTS),
  stopReason: z.literal("MODEL_UNAVAILABLE").nullable(),
}).superRefine((value, context) => {
  const sentChars = value.segments.reduce((sum, segment) => sum + segment.chars, 0);
  if ((value.segments.length === value.totalSegments && sentChars !== value.totalChars) || value.segments.length > value.totalSegments || sentChars > value.totalChars ||
      value.segments.some((segment, index) => segment.index !== index + 1 || (segment.status === "SUCCEEDED") !== (segment.errorCode === null))) {
    context.addIssue({ code: "custom", message: "审查覆盖记录不完整" });
  }
});
export type ReviewCoverage = z.infer<typeof reviewCoverageSchema>;

/** Measure the actual text slices. A UTF-16 pair is never split across requests. */
export function prepareReviewSegments(text: string) {
  const segments: string[] = [];
  let start = 0;
  let totalSegments = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + REVIEW_SEGMENT_CHARS);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    if (segments.length < REVIEW_MAX_SEGMENTS) segments.push(text.slice(start, end));
    totalSegments++;
    start = end;
  }
  return { totalChars: text.length, totalSegments, segments };
}

/** A request can fail without a usable reply; requesting a slice is not completing it. */
export function summarizeReviewCoverage(coverage: ReviewCoverage) {
  const sentChars = coverage.segments.reduce((sum, segment) => sum + segment.chars, 0);
  const completed = coverage.segments.filter(segment => segment.status === "SUCCEEDED");
  const completedChars = completed.reduce((sum, segment) => sum + segment.chars, 0);
  const failedSegments = coverage.segments.length - completed.length;
  return {
    totalChars: coverage.totalChars, totalSegments: coverage.totalSegments,
    sentChars, sentSegments: coverage.segments.length,
    completedChars, completedSegments: completed.length,
    failedChars: sentChars - completedChars, failedSegments,
    notSentChars: coverage.totalChars - sentChars,
    notSentSegments: coverage.totalSegments - coverage.segments.length,
    status: completed.length === coverage.totalSegments ? "COMPLETE" as const : completed.length ? "PARTIAL" as const : "FAILED" as const,
  };
}
