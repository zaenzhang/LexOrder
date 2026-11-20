import { describe, expect, it } from "vitest";
import { prepareObservation } from "@/server/evidence/observation-contract";

describe("structured observations from fixed excerpts", () => {
  function byDate(text: string) {
    return prepareObservation({ statement: "PARTY_STATEMENT", date: { role: "SIGNATURE", span: { start: 0, end: text.length } } }, text).date!;
  }
  function byAmount(text: string) {
    return prepareObservation({ statement: "RECORD", amount: { nature: "ACTUAL_TRANSFER", span: { start: 0, end: text.length } } }, text).amount!;
  }

  it("keeps source wording, valid calendar dates and month precision", () => {
    expect(byDate("2024 年 2 月 29 日")).toMatchObject({ role: "SIGNATURE", text: "2024 年 2 月 29 日", value: { precision: "EXACT", day: "2024-02-29" } });
    expect(byDate("2025年2月").value).toEqual({ precision: "MONTH", month: "2025-02" });
    expect(byDate("2024-12-31 至 2025-01-02").value).toEqual({ precision: "RANGE", start: "2024-12-31", end: "2025-01-02" });
    for (const text of ["2023年2月29日", "2025-01-05至2025-01-01", "下周一", "约2024年2月", "2月6日"]) {
      expect(byDate(text)).toMatchObject({ text, value: { precision: "UNKNOWN" } });
    }
  });

  it("keeps zero and full decimal precision and leaves missing units unresolved", () => {
    expect(byAmount("0元").value).toEqual({ currency: "CNY", value: "0" });
    expect(byAmount("50 万元").value).toEqual({ currency: "CNY", value: "500000" });
    expect(byAmount("123456789012345678.123456元").value).toEqual({ currency: "CNY", value: "123456789012345678.123456" });
    expect(byAmount("1万").value).toBeNull();
    expect(byAmount("12,41元").value).toBeNull();
    expect(byAmount("USD 50 欧元").value).toBeNull();
  });

  it("requires the selected amount and unit to come from the same fixed anchor", () => {
    const text = "金额（元）\n480,000.00";
    const input = { statement: "RECORD", amount: { nature: "ACTUAL_TRANSFER",
      unitSpan: { start: 0, end: 5 }, span: { start: 6, end: text.length } } };
    expect(prepareObservation(input, text).amount?.value).toEqual({ currency: "CNY", value: "480000" });
    expect(() => prepareObservation({ ...input, amount: { ...input.amount, suggested: { currency: "USD", value: "480000" } } }, text)).toThrow("候选金额或币种");
    expect(() => prepareObservation({ ...input, amount: { ...input.amount, span: { start: 6, end: text.length + 1 } } }, text)).toThrow("超出固定片段");
    expect(() => prepareObservation({ statement: "RECORD", date: { role: "OCCURRENCE", span: { start: 1, end: 2 } } }, "🧾")).toThrow("截断了字符");
  });
});
