// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { ScheduleItem } from "@/server/schedule/query";
const mock = vi.hoisted(() => ({ user: vi.fn(), items: vi.fn(), role: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mock.user } } }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: mock.role }));
vi.mock("@/server/schedule/query", () => ({ queryScheduleItems: mock.items }));
import { GET } from "@/app/api/calendar/[token]/route";
beforeEach(() => {
  vi.clearAllMocks(); mock.user.mockResolvedValue({ id: "synthetic-user", name: "合成日历", role: "LAWYER", active: true });
  mock.role.mockResolvedValue({ enabled: true });
});
it("实际日历出口按来源区分期限精度，不改变保全/紧急事项及庭期提醒", async () => {
  const base: ScheduleItem = { id: "date", type: "deadline", title: "合成日期", occurredAt: new Date("2027-02-03T00:00:00+08:00"),
    matter: { id: "matter", internalCode: "SYNTHETIC", title: "合成事项" }, clientName: null };
  mock.items.mockResolvedValue([
    { ...base, deadlineId: "date", duePrecision: "DATE" },
    { ...base, id: "point", deadlineId: "point", duePrecision: "DATETIME" },
    { ...base, id: "unknown", deadlineId: "unknown", duePrecision: null, occurredAt: new Date("2027-02-03T00:00:00Z") },
    { ...base, id: "preservation" }, { ...base, id: "urgent" },
    { ...base, id: "hearing", type: "hearing" },
  ]);
  const response = await GET(new Request("https://example.invalid/api/calendar/synthetic-token-long"), { params: Promise.resolve({ token: "synthetic-token-long" }) });
  expect(response.status).toBe(200);
  const text = await response.text();
  const events = text.split("BEGIN:VEVENT").slice(1);
  const event = (id: string) => events.find(value => value.includes(`UID:${id}@`))!;
  expect(event("point")).toContain("DTSTART:20270202T160000Z"); expect(event("point")).not.toContain("DTEND");
  expect(event("point")).toContain("TRIGGER:-PT1440M"); expect(event("point")).not.toContain("TRIGGER:-PT120M");
  for (const id of ["date", "unknown", "preservation", "urgent"]) expect(event(id)).toContain("DTSTART;VALUE=DATE:20270203");
  expect(event("unknown")).toContain("时间精度未记录");
  expect(event("preservation")).not.toContain("时间精度未记录");
  expect(event("urgent")).not.toContain("时间精度未记录");
  expect(event("hearing")).toContain("DTEND:20270202T170000Z"); expect(event("hearing")).toContain("TRIGGER:-PT120M");
});
