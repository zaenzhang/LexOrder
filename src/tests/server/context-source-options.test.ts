// @vitest-environment node
import type { Prisma, PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildContextSourceChoices, contextTextSummary } from "@/lib/matters/context-source-labels";
import type { RoleGrant } from "@/lib/roles/catalog";

const { db, resolveRole, canRead } = vi.hoisted(() => ({
  db: { $transaction: vi.fn(), user: { findUnique: vi.fn() }, matter: { count: vi.fn(), findFirst: vi.fn() },
    document: { findMany: vi.fn() }, note: { findMany: vi.fn() }, clientActivity: { findMany: vi.fn() } },
  resolveRole: vi.fn(), canRead: vi.fn(),
}));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: canRead }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: resolveRole }));
vi.mock("@/lib/permissions", () => ({
  matterAssociationFilter: () => ({}), matterFinanceVisibilityFilter: () => ({}),
  matterReadVisibilityFilter: () => ({}), customMatterFilter: () => ({}),
}));
vi.mock("@/server/clients/relationship-access", () => ({ clientRelationshipFilter: () => ({ createdById: "actor" }) }));
vi.mock("@/server/audit", () => ({ auditTx: vi.fn() }));

import { readContextSourceOptions } from "@/server/matters/context-service";

const actor = { id: "actor", role: "CUSTOM" } as const;
const occurredAt = new Date("2026-11-16T16:05:09Z");
let grants: RoleGrant[];
beforeEach(() => {
  vi.resetAllMocks();
  grants = ["matters.read", "matters.write", "documents.read", "clients.read", "schedule.read"].map(permissionKey => ({ permissionKey, scope: "OWN" })) as RoleGrant[];
  resolveRole.mockImplementation(async () => ({ role: "CUSTOM", enabled: true, rolePermissions: grants }));
  db.$transaction.mockImplementation(async (callback: (tx: Prisma.TransactionClient) => unknown) => callback(db as unknown as Prisma.TransactionClient));
  db.user.findUnique.mockResolvedValue({ active: true, role: "CUSTOM" });
  db.matter.count.mockResolvedValue(1);
  db.matter.findFirst.mockResolvedValue({ id: "matter", status: "ACTIVE", primaryClientId: "client-visible", intake: null, clientLinks: [] });
  db.document.findMany.mockResolvedValue([]);
  db.note.findMany.mockResolvedValue([]);
  db.clientActivity.findMany.mockResolvedValue([]);
  canRead.mockImplementation(async (_userId: string, doc: { id: string }) => doc.id !== "hidden");
});

describe("事项上下文来源选项", () => {
  it("同日21条客户沟通以北京时间和可读摘要区分，并保留原授权过滤", async () => {
    db.clientActivity.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, index) => ({
      id: `activity-${index}`, occurredAt, content: `  第 ${index + 1} 次回访\n补充材料  `, client: { name: "合成客户" },
    })));
    db.note.findMany.mockResolvedValue([{ id: "note", occurredAt, withWhom: "  合成\t沟通对象\n " }]);
    const result = await readContextSourceOptions(db as unknown as PrismaClient, actor, "matter");
    const activities = result.choices.filter(choice => choice.type === "CLIENT_ACTIVITY");
    expect(new Set(activities.map(choice => choice.label)).size).toBe(21);
    expect(activities[0].label).toBe("客户沟通 · 合成客户 · 2026-11-17 00:05:09 · 第 1 次回访 补充材料");
    expect(result.choices[0].label).toBe("事项沟通 · 2026-11-17 00:05:09 · 合成 沟通对象");
    expect(db.clientActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { client: { id: { in: ["client-visible"] }, deletedAt: null, AND: [{ createdById: "actor" }] } },
      select: { id: true, occurredAt: true, content: true, client: { select: { name: true } } },
    }));
    expect(db.note.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { matterId: "matter", deletedAt: null } }));
  });

  it("文档版本在逐件阅读过滤后显示，隐藏同名文件不影响标签序号", async () => {
    db.document.findMany.mockResolvedValue([
      { id: "v1", name: "合同.pdf", version: 1 }, { id: "v2", name: "合同.pdf", version: 2 },
      { id: "hidden", name: "合同.pdf", version: 1 },
    ]);
    const result = await readContextSourceOptions(db as unknown as PrismaClient, actor, "matter");
    expect(result.choices.map(choice => choice.label)).toEqual(["材料 · 合同.pdf · 第 1 版", "材料 · 合同.pdf · 第 2 版"]);
    expect(result.choices.some(choice => choice.id === "hidden")).toBe(false);
  });

  it("缺少对应来源资格时不读取新增摘要字段", async () => {
    grants = grants.filter(grant => ["matters.read", "matters.write"].includes(grant.permissionKey));
    const result = await readContextSourceOptions(db as unknown as PrismaClient, actor, "matter");
    expect(result.choices).toEqual([]);
    expect(db.clientActivity.findMany).not.toHaveBeenCalled();
    expect(db.note.findMany).not.toHaveBeenCalled();
    expect(db.document.findMany).not.toHaveBeenCalled();
  });

  it("摘要有界且空白可解释；完全相同的可读来源仍能分别选择", () => {
    expect(contextTextSummary(" \t\n ")).toBe("");
    const summary = contextTextSummary("😀".repeat(80));
    expect(Array.from(summary)).toHaveLength(64);
    expect(summary.endsWith("…")).toBe(true);
    const choices = buildContextSourceChoices({ documents: [], activities: [], notes: [
      { id: "first", occurredAt, withWhom: " \t" }, { id: "second", occurredAt, withWhom: null },
    ] });
    expect(choices.map(choice => choice.label)).toEqual([
      "事项沟通 · 2026-11-17 00:05:09 · 未填写沟通对象 · 同名来源 1/2",
      "事项沟通 · 2026-11-17 00:05:09 · 未填写沟通对象 · 同名来源 2/2",
    ]);
  });
});
