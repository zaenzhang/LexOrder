import { describe, expect, it } from "vitest";
import { deadlineDueSchema, deadlineDueDraft, deadlineDueFromDraft, deadlineOverdue, deadlineRelative, formatDeadlineDue } from "@/lib/deadline-due";
import { buildIcs } from "@/lib/ics";

describe("期限实际精度", () => {
  it("日期按上海日界保存，明确时区的准确时刻保留原瞬间", () => {
    expect(deadlineDueSchema.parse({ duePrecision: "DATE", dueAt: "2027-02-03" }).dueAt.toISOString()).toBe("2027-02-02T16:00:00.000Z");
    expect(deadlineDueSchema.parse({ duePrecision: "DATETIME", dueAt: "2027-02-03T17:00:03.456+08:00" }).dueAt.toISOString()).toBe("2027-02-03T09:00:03.456Z");
    expect(deadlineDueSchema.parse({ duePrecision: "DATETIME", dueAt: "2027-02-03T00:00:00+08:00" }).dueAt.toISOString()).toBe("2027-02-02T16:00:00.000Z");
  });
  it("无精度、无时区、无效日及非上海日界的日期载体均拒绝", () => {
    for (const input of [
      { dueAt: "2027-02-03" }, { duePrecision: null, dueAt: "2027-02-03" },
      { duePrecision: "DATE", dueAt: "2027-02-30" },
      { duePrecision: "DATE", dueAt: new Date("2027-02-03T00:00:00Z") },
      { duePrecision: "DATETIME", dueAt: "2027-02-03T17:00:00" },
      { duePrecision: "DATETIME", dueAt: "2027-02-30T17:00:00+08:00" },
    ]) expect(deadlineDueSchema.safeParse(input).success).toBe(false);
  });
  it("相同上海日期：DATE与历史未知不提前逾期，准确午夜及已过时刻确实逾期", () => {
    const now = new Date("2027-02-03T10:00:00+08:00"), midnight = "2027-02-03T00:00:00+08:00", old = "2027-02-03T00:00:00Z";
    expect(deadlineOverdue(midnight, "DATE", now)).toBe(false);
    expect(deadlineOverdue(old, null, now)).toBe(false);
    expect(deadlineOverdue(midnight, "DATETIME", now)).toBe(true);
    expect(deadlineRelative(old, "DATETIME", now)).toBe("已逾期");
    expect(formatDeadlineDue(midnight, "DATETIME")).toBe("2027-02-03 00:00");
    expect(formatDeadlineDue(midnight, "DATE")).toBe("2027-02-03");
    expect(formatDeadlineDue(old, null)).toBe("2027-02-03 · 时间精度未记录");
  });
  it("未知编辑不默认升格；准确时刻未改分钟时仍保留秒毫秒", () => {
    const legacy = { dueAt: "2027-02-03T00:00:23.789Z", duePrecision: null };
    const draft = deadlineDueDraft(legacy);
    expect(draft).toEqual({ precision: null, date: "2027-02-03", time: "" });
    expect(() => deadlineDueFromDraft(draft, legacy)).toThrow("明确选择");
    expect(() => deadlineDueFromDraft({ ...draft, precision: "DATETIME" }, legacy)).toThrow("准确时刻");
    const original = { ...legacy, duePrecision: "DATETIME" as const };
    expect(deadlineDueFromDraft(deadlineDueDraft(original), original).dueAt.toISOString()).toBe(legacy.dueAt);
    expect(deadlineDueFromDraft({ ...deadlineDueDraft(original), time: "17:00" }, original).dueAt.toISOString()).toBe("2027-02-03T09:00:00.000Z");
  });
  it("ICS准确截止时点无DTEND，日期与原庭期默认时长保持", () => {
    const start = new Date("2027-02-03T00:00:00+08:00");
    const point = buildIcs({ events: [{ uid: "d-point", title: "准确截止", start, end: null }] });
    expect(point).toContain("DTSTART:20270202T160000Z"); expect(point).not.toContain("DTEND");
    expect(point).toContain("UID:d-point@lawlink.local");
    const date = buildIcs({ events: [{ uid: "d-date", title: "日期", start, allDay: true }] });
    expect(date).toContain("DTSTART;VALUE=DATE:20270203"); expect(date).toContain("DTEND;VALUE=DATE:20270204");
    const hearing = buildIcs({ events: [{ uid: "h", title: "庭期", start }] });
    expect(hearing).toContain("DTEND:20270202T170000Z");
  });
});
