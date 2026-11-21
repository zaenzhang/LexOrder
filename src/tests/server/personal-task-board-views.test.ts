import { beforeEach, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { task: { findMany } } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "local-lawyer" } })) }));
vi.mock("@/lib/permissions", () => ({ matterAssociationFilter: () => ({ ownerId: "local-lawyer" }) }));
vi.mock("@/lib/roles/catalog", () => ({ hasCustomPermission: () => true }));

import { readPersonalTaskBoard } from "@/server/tasks/personal-schedule";

beforeEach(() => { findMany.mockReset().mockResolvedValue([]); });

it("按当前责任人区分等待反馈和待办，已办理排除取消", async () => {
  await readPersonalTaskBoard(true, "open");
  const base = { matter: { deletedAt: null, ownerId: "local-lawyer" },
    responsibility: { is: { assigneeId: "local-lawyer", state: "OPEN" } } };
  expect(findMany.mock.calls[0][0].where).toEqual({ ...base, waitings: { none: { endedAt: null } } });
  await readPersonalTaskBoard(false, "waiting");
  expect(findMany.mock.calls[1][0].where).toEqual({ ...base, waitings: { some: { endedAt: null } } });
  expect(findMany.mock.calls[1][0].select.waitings.select).toEqual({ waitingFor: true, nextCheckAt: true });
  await readPersonalTaskBoard(false, "done");
  expect(findMany.mock.calls[2][0].where).toEqual({ ...base,
    responsibility: { is: { assigneeId: "local-lawyer", state: "DONE" } },
  });
});
