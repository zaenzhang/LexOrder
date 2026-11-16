// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  emptyEvidenceEventDate, evidenceEventDateSchema, evidenceEventDateFromRecord, evidenceEventDateToRecord,
  formatEvidenceEventDate, groupEvidenceTimeline, isEvidenceCalendarDay, type EvidenceEventDate,
} from "@/lib/evidence/event-date";

describe("人工事实发生日期合同", () => {
  it("只接受真实公历日并保留四位低年份和边界日", () => {
    for (const value of ["0001-01-01", "0099-12-31", "2000-02-29", "2024-02-29", "9999-12-31"]) expect(isEvidenceCalendarDay(value), value).toBe(true);
    for (const value of ["0000-01-01", "10000-01-01", "2023-02-29", "1900-02-29", "2026-04-31", "2026-2-01", "2026-11-16T00:00:00Z"]) expect(isEvidenceCalendarDay(value), value).toBe(false);
  });

  it("拒绝不完整和相互矛盾的日期组合，未知表述不会被猜成日期", () => {
    const unknown = { ...emptyEvidenceEventDate(), text: "某年夏天，在收到通知后的第二天" };
    expect(evidenceEventDateSchema.parse(unknown)).toEqual(unknown);
    const invalid = [
      { precision: "EXACT", start: "2024-01-01" },
      { precision: "EXACT", start: null, end: null, text: null },
      { precision: "EXACT", start: "2024-01-01", end: "2024-01-01", text: null },
      { precision: "RANGE", start: "2024-01-01", end: null, text: null },
      { precision: "RANGE", start: "2024-02-01", end: "2024-01-01", text: null },
      { precision: "UNKNOWN", start: "2024-01-01", end: null, text: null },
      { ...unknown, text: "时".repeat(501) },
    ];
    for (const value of invalid) expect(evidenceEventDateSchema.safeParse(value).success).toBe(false);
    expect(evidenceEventDateSchema.parse({ precision: "RANGE", start: "2024-01-01", end: "2024-01-01", text: null })).toMatchObject({ precision: "RANGE" });
  });

  it("日期往返及显示与宿主时区无关，区间保留两个端点", () => {
    const previous = process.env.TZ;
    const date: EvidenceEventDate = { precision: "RANGE", start: "0099-01-01", end: "2024-02-29", text: "原文所列范围" };
    try {
      for (const zone of ["Asia/Shanghai", "America/Los_Angeles", "Europe/Budapest"]) {
        process.env.TZ = zone;
        expect(evidenceEventDateFromRecord(evidenceEventDateToRecord(date))).toEqual(date);
        expect(formatEvidenceEventDate(date)).toBe("0099-01-01 至 2024-02-29");
      }
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });

  it("先剔除受限内容再排序，未知另列，不使用记录时间或隐藏日期作排序线索", () => {
    const exact = (day: string): EvidenceEventDate => ({ precision: "EXACT", start: day, end: null, text: null });
    const records = [
      { id: "unknown", eventDate: emptyEvidenceEventDate(), createdAt: "1900-01-01" },
      { id: "same-b", eventDate: exact("2024-03-01") },
      { id: "restricted", eventDate: exact("0001-01-01"), restricted: true },
      { id: "later", eventDate: exact("2024-04-01") },
      { id: "absent", eventDate: null },
      { id: "same-a", eventDate: exact("2024-03-01") },
      { id: "earlier", eventDate: { precision: "RANGE", start: "2024-02-01", end: "2024-05-01", text: null } as EvidenceEventDate },
    ];
    const grouped = groupEvidenceTimeline(records);
    expect(grouped.dated.map(item => item.id)).toEqual(["earlier", "same-a", "same-b", "later"]);
    expect(grouped.unknown.map(item => item.id)).toEqual(["unknown"]);
    expect(records[0].id).toBe("unknown");
  });
});
