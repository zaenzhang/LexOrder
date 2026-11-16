// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, requireAdmin } = vi.hoisted(() => ({
  db: { customFieldDef: { update: vi.fn() } },
  requireAdmin: vi.fn()
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), requireWorkspaceConfiguration: requireAdmin }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ assertCanLeadMatter: vi.fn() }));
vi.mock("@/lib/archive/guard", () => ({ assertMatterWritable: vi.fn() }));
import { updateCustomFieldDef } from "@/server/custom-fields/actions";

beforeEach(() => {
  vi.resetAllMocks();
  requireAdmin.mockResolvedValue({ user: { id: "admin" } });
});

describe("自定义字段局部更新", () => {
  it("只修改名称时保留已有类型、选项及必填设置", async () => {
    let stored = {
      id: "ckx1a2b3c4d5e6f7g8h9j0k1", label: "原名称",
      fieldType: "SELECT", options: ["待审", "完成"], required: true
    };
    db.customFieldDef.update.mockImplementation(async ({ data }) => {
      stored = { ...stored, ...data };
      return stored;
    });
    await updateCustomFieldDef({ id: stored.id, label: "新名称" });
    expect(stored).toEqual({
      id: "ckx1a2b3c4d5e6f7g8h9j0k1", label: "新名称",
      fieldType: "SELECT", options: ["待审", "完成"], required: true
    });
  });
});
