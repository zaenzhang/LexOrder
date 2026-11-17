// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
import { parseSavedCaseResearchInput } from "@/server/research/saved-case-source";

const documentId = "cm00000000000000000000001", savedAt = new Date("2026-11-17T10:00:00Z");
function markdown(vector = false, body = "合成裁判片段", link = "https://example.invalid/case") {
  return [`# 类案存档${vector ? "（语义检索）" : ""}：合成旧案`, "", "- **案号**：（2019）合成001号", "- **法院**：合成法院",
    "- **裁判日期**：2019-01-02", "- **案由**：合成案由", "- **案件类别**：民事", "- **地区**：合成地区", "- **文书种类**：判决书",
    ...(vector ? ["- **相似度评分**：0.8123"] : []), `- **元典链接**：${link}`, "- **保存时间**：2026-11-16 08:30", "", "---", "", body].join("\n");
}
function parse(text: string, vector = false) {
  return parseSavedCaseResearchInput(text, documentId, vector ? "YUANDIAN_CASE_SAVE_VECTOR" : "YUANDIAN_CASE_SAVE", savedAt);
}

describe("已保存类案头部与真实资料范围", () => {
  it.each([false, true])("识别固定保存格式 vector=%s，区分裁判、保存、审计和未知检索时间", vector => {
    const value = parse(markdown(vector), vector);
    expect(value.source).toEqual({ documentId, page: null, relation: "CONTEXT", lawMetadata: {
      kind: "CASE", title: "合成旧案", authority: "合成法院", number: "（2019）合成001号", jurisdiction: "",
      effectiveFrom: "", effectiveTo: "", verification: "PENDING", acquiredOn: "", usageScope: "",
      acquiredVia: expect.stringContaining("材料所载元信息，待核实"),
    } });
    expect(value.query).toMatchObject({ sourceDocumentId: documentId, access: "SUMMARY", outcome: "UNREAD", location: "https://example.invalid/case" });
    expect(value.query.query).toContain("原查询未记录");
    expect(value.query.notes).toContain("材料所载裁判日期：2019-01-02");
    expect(value.query.notes).toContain("材料所载保存时间：2026-11-16 08:30");
    expect(value.query.notes).toContain("保存审计时间：2026-11-17T10:00:00.000Z");
    expect(value.query.notes).toContain("本保存记录不能证明已取得裁判全文");
  });
  it("正文里的同名字段不是身份；任意所载链接只作为原文字段返回", () => {
    const value = parse(markdown(false, "- **法院**：正文伪机关\n# 类案存档：正文标题\n---\n返回片段", "javascript:合成链接"));
    expect(value.source.lawMetadata.authority).toBe("合成法院");
    expect(value.source.lawMetadata.title).toBe("合成旧案");
    expect(value.query.location).toBe("javascript:合成链接");
    expect(value.query.notes).not.toContain("正文伪机关");
  });
  it.each(["", "（无内容片段）", "   "])("缺片段 %j 只记链接或未取得", body => {
    expect(parse(markdown(false, body)).query).toMatchObject({ access: "LINK", outcome: "NOT_OBTAINED" });
    expect(parse(markdown(false, body, "")).query).toMatchObject({ access: "NONE", outcome: "NOT_OBTAINED" });
  });
  it("占位元信息不当已知身份，真实片段中的括号不误判缺失", () => {
    const value = parse(markdown(false, "（无争议）", "未知").replace("合成旧案", "未知").replace("（2019）合成001号", "—")
      .replace("合成法院", "（无法院信息）").replace("2019-01-02", "未知"));
    expect(value.source.lawMetadata).toMatchObject({ title: "", authority: "", number: "", acquiredOn: "" });
    expect(value.query).toMatchObject({ location: "", access: "SUMMARY", outcome: "UNREAD" });
    expect(value.query.notes).not.toContain("材料所载裁判日期");
  });
  it.each([
    (text: string) => text.replace("合成旧案", "合成旧案\n插入换行"),
    (text: string) => text.replace("- **法院**：", "- **案号**："),
    (text: string) => text.replace("- **地区**：合成地区", "- **地区**：合成地区\n- **法院**：重复字段"),
    (text: string) => text.replace("\n---\n", "\n--\n"),
    (text: string) => text.replace("合成法院", "合成法院\u2028隐藏换行"),
  ])("头部歧义或换行不猜读、拒绝自动填入 %#", alter => {
    expect(() => parse(alter(markdown()))).toThrow("头部不完整或有歧义");
  });
  it.each([
    (text: string) => text.replace("合成旧案", "题".repeat(301)),
    (text: string) => text.replace("（2019）合成001号", "号".repeat(151)),
    (text: string) => text.replace("https://example.invalid/case", "x".repeat(2001)),
    (text: string) => text.replace("2019-01-02", "日".repeat(3001)),
  ])("超长输入拒绝，不能静默截断 %#", alter => {
    expect(() => parse(alter(markdown()))).toThrow("未自动截断");
  });
  it("入口类型与保存格式必须一致", () => {
    expect(() => parse(markdown(true))).toThrow("头部不完整或有歧义");
    expect(() => parseSavedCaseResearchInput(markdown(), documentId, "UNRELATED", savedAt)).toThrow("头部不完整或有歧义");
  });
});
