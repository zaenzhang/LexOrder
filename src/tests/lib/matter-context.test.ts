import { describe, expect, it } from "vitest";
import { contextRecordSchema, contextConfirmSchema } from "@/lib/matters/context";

const input = { matterId: "cmatter00000000000000000001", requestKey: "0a5967a6-179a-4e89-a39d-791f29b44b65",
  kind: "GOAL", visibility: "MATTER", content: "合成目标", occurredAt: "2026-01-01T08:00:00+08:00", sourceDescription: "合成客户电话指示" };

describe("事项上下文输入边界", () => {
  it("请求不能指定作者、版本链身份或直接写入已确认状态", () => {
    expect(contextRecordSchema.safeParse(input).success).toBe(true);
    for (const field of ["authorId", "seriesId", "version", "confirmedById", "confirmationStatus"]) {
      expect(contextRecordSchema.safeParse({ ...input, [field]: "forged" }).success).toBe(false);
    }
    expect(contextConfirmSchema.safeParse({ matterId: input.matterId, id: "crecord00000000000000000001", expectedVersion: 1, acknowledged: false }).success).toBe(false);
  });
  it("拒绝多来源字段绕过、空白来源及过长正文", () => {
    expect(contextRecordSchema.safeParse({ ...input, sourceNoteId: "cnote000000000000000000001", sourceDocumentId: "cdoc0000000000000000000001" }).success).toBe(false);
    expect(contextRecordSchema.safeParse({ ...input, sourceDescription: "   " }).success).toBe(false);
    expect(contextRecordSchema.safeParse({ ...input, content: "甲".repeat(8001) }).success).toBe(false);
  });
  it("发生时间必须带明确时区，不能依赖浏览器所在时区", () => {
    expect(contextRecordSchema.safeParse({ ...input, occurredAt: "2026-01-01T08:00:00" }).success).toBe(false);
    expect(contextRecordSchema.parse(input).occurredAt).toBe(input.occurredAt);
  });
});
