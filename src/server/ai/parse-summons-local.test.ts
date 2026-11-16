// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeSummonsFields, parseSummonsText } from "./parse-summons-local";

describe("parseSummonsText", () => {
  it("extracts core hearing fields from Chinese summons OCR text", () => {
    const parsed = parseSummonsText(`
      河南省郑州市中原区人民法院传票
      案号：（2026）豫0102民初1234号
      申请人：张三
      被申请人：示例建设有限公司
      定于二〇二六年六月二十三日上午九时三十分在本院第三法庭开庭。
      审判员：王法官
    `);

    expect(parsed.hearingDate).toBe("2026-06-23");
    expect(parsed.hearingTime).toBe("09:30");
    expect(parsed.courtRoom).toContain("第三法庭");
    expect(parsed.caseNumber).toBe("（2026）豫0102民初1234号");
    expect(parsed.judge).toBe("王法官");
    expect(parsed.parties).toContain("张三");
  });
  it("handles Arabic afternoon times and prioritizes hearing context over issue date", () => {
    const result = parseSummonsText("制作日期：2026年11月1日。开庭时间：2026年12月3日下午3时30分");
    expect(result.hearingDate).toBe("2026-12-03");
    expect(result.hearingTime).toBe("15:30");
  });
  it("rejects impossible calendar dates and clock values", () => {
    const result = parseSummonsText("开庭时间：2026年2月31日25:99");
    expect(result.hearingDate).toBeNull();
    expect(result.hearingTime).toBeNull();
    expect(parseSummonsText("开庭日期：2028年2月29日").hearingDate).toBe("2028-02-29");
  });
  it("does not infer a hearing date from a lone issue date", () => {
    expect(parseSummonsText("制作日期：2026年11月1日").hearingDate).toBeNull();
    expect(parseSummonsText("开庭时间：待定\n制发日期：2026年11月1日").hearingDate).toBeNull();
    expect(parseSummonsText("开庭日期：另行通知\n送达日期：2026年11月1日").hearingDate).toBeNull();
  });
  it("validates untrusted model date/time fields", () => {
    expect(normalizeSummonsFields({ hearingDate: "2026-02-31", hearingTime: "25:99", judge: 42, parties: [null, "张三"] })).toMatchObject({ hearingDate: null, hearingTime: null, judge: null, parties: ["张三"] });
  });

});
