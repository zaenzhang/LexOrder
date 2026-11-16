import { describe, expect, it } from "vitest";
import { prepareReviewSegments, reviewCoverageSchema, summarizeReviewCoverage, type ReviewCoverage } from "@/lib/ai/review-coverage";

function complete(text: string): ReviewCoverage {
  const prepared = prepareReviewSegments(text);
  return { totalChars: prepared.totalChars, totalSegments: prepared.totalSegments,
    segments: prepared.segments.map((part, index) => ({ index: index + 1, chars: part.length, status: "SUCCEEDED", errorCode: null })), stopReason: null };
}

describe("实际审查覆盖", () => {
  it.each([30, 6000, 6001, 36000])("%i 字符按实际请求片段计算", chars => {
    const coverage = complete("甲".repeat(chars));
    expect(reviewCoverageSchema.safeParse(coverage).success).toBe(true);
    expect(summarizeReviewCoverage(coverage)).toMatchObject({ status: "COMPLETE", sentChars: chars, completedChars: chars, failedChars: 0, notSentChars: 0 });
  });

  it("超过六段保留真实总长度及未请求范围", () => {
    expect(summarizeReviewCoverage(complete("甲".repeat(42001)))).toMatchObject({
      status: "PARTIAL", totalChars: 42001, totalSegments: 8, sentChars: 36000, completedSegments: 6, notSentChars: 6001, notSentSegments: 2,
    });
  });

  it("片段不切断 UTF-16 配对，按真正切片计数", () => {
    const text = `${"甲".repeat(5999)}🙂乙`;
    const prepared = prepareReviewSegments(text);
    expect(prepared.segments).toEqual(["甲".repeat(5999), "🙂乙"]);
    expect(prepared.segments.join("")).toBe(text);
    expect(summarizeReviewCoverage(complete(text)).sentChars).toBe(text.length);
  });

  it("失败片段不是有效回复，尚未请求也不是失败", () => {
    const coverage = complete("甲".repeat(15000));
    coverage.segments = [coverage.segments[0], { index: 2, chars: 6000, status: "FAILED", errorCode: "REQUEST_FAILED" }];
    expect(summarizeReviewCoverage(coverage)).toMatchObject({ status: "PARTIAL", sentChars: 12000, completedChars: 6000, failedChars: 6000, notSentChars: 3000, notSentSegments: 1 });
  });

  it("结构不完整不得伪装全部覆盖", () => {
    expect(reviewCoverageSchema.safeParse({ ...complete("甲".repeat(6000)), totalChars: 9000 }).success).toBe(false);
    expect(reviewCoverageSchema.safeParse({ ...complete("甲".repeat(6000)), segments: [{ index: 2, chars: 6000, status: "SUCCEEDED", errorCode: null }] }).success).toBe(false);
  });
});
