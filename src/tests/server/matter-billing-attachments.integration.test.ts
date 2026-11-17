// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceActor } from "@/lib/runtime/actor";
import type { PermissionKey } from "@/lib/roles/catalog";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("Billing attachment tests require an isolated _test database");
  return { url, actor: null as WorkspaceActor | null };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/attachments_test") };
});
vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async (permission: PermissionKey) => {
    const { hasCustomPermission } = await import("@/lib/roles/catalog");
    if (!config.actor || !hasCustomPermission(config.actor, permission)) throw new Error(`缺少 ${permission}`);
    return { user: config.actor };
  }),
  getSession: vi.fn(async () => ({ user: config.actor }))
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { resolveRoleUser } from "@/lib/roles/service";
import { registerBillingTx } from "@/server/finance/ledger-registration";
import { getMatterFinance } from "@/server/finance/actions";

const users: string[] = [], matters: string[] = [], roles: string[] = [];
async function setActor(user: User) {
  config.actor = { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
    ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" };
}
async function makeUser(financeOnly = false) {
  let roleId: string | undefined;
  if (financeOnly) {
    const name = `billing-files-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name,
      permissions: { create: [{ permissionKey: "finance.read", scope: "ALL" }] } } });
    roles.push(role.id); roleId = role.id;
  }
  const user = await db.user.create({ data: { name: "合成收费附件人员", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only",
    role: financeOnly ? "CUSTOM" : "LAWYER", roleDefinitionId: roleId } });
  users.push(user.id); return user;
}
async function makeMatter(ownerId: string) {
  const matter = await db.matter.create({ data: { ownerId, title: "合成收费附件事项", internalCode: `BFILES-${randomUUID()}`, status: "IN_PROGRESS" } });
  matters.push(matter.id); return matter;
}
async function fixture() {
  const user = await makeUser(); await setActor(user);
  const matter = await makeMatter(user.id), otherMatter = await makeMatter(user.id);
  const draft = (matterId: string) => db.$transaction(tx => registerBillingTx(tx, user.id, {
    matterId, title: "合成零收费草稿", moneyKind: "LAWYER_FEE", amount: "0", installments: []
  }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const billing = await draft(matter.id), secondBilling = await draft(matter.id), otherBilling = await draft(otherMatter.id);
  const document = (name: string, changes: Partial<Prisma.DocumentUncheckedCreateInput> = {}) => db.document.create({ data: {
    name, matterId: matter.id, uploadedById: user.id, path: `synthetic/${randomUUID()}`, tags: [], category: "OTHER", ...changes
  } });
  const attached = await document("合成已关联附件.pdf");
  const unlinkedContract = await document("合成采购合同.pdf", { category: "CONTRACT" });
  const wrongDocumentMatter = await document("合成其他案件原件.pdf", { matterId: otherMatter.id });
  const wrongBillingMatter = await document("合成其他收费关联.pdf");
  const deleted = await document("合成已撤回附件.pdf", { deletedAt: new Date() });
  await db.billingAttachment.createMany({ data: [
    { billingId: billing.id, documentId: attached.id }, { billingId: secondBilling.id, documentId: attached.id },
    { billingId: billing.id, documentId: wrongDocumentMatter.id }, { billingId: otherBilling.id, documentId: wrongBillingMatter.id },
    { billingId: billing.id, documentId: deleted.id }
  ] });
  return { user, matter, billing, attached, unlinkedContract, wrongDocumentMatter, wrongBillingMatter, deleted };
}

describe.skipIf(!config.url)("收费扫描件：真实 BillingAttachment 关系与独立材料资格", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect(); vi.unstubAllEnvs();
  });

  it("仅返回双向同案且未撤回的显式附件，分类不替代关联，重复关联只显示一次", async () => {
    const f = await fixture();
    const result = await getMatterFinance(f.matter.id);
    expect(result.contractDocuments).toEqual([{ id: f.attached.id, name: f.attached.name, createdAt: f.attached.createdAt, mimeType: null }]);
    expect(result.contractDocuments[0]).not.toHaveProperty("path");
    expect(result.contractDocuments[0]).not.toHaveProperty("uploadedById");
  });

  it("财务读取资格不开放全部附件；已获具体文书审批资格仍可读取该附件", async () => {
    const f = await fixture();
    const viewer = await makeUser(true); await setActor(viewer);
    expect((await getMatterFinance(f.matter.id)).contractDocuments).toEqual([]);
    // Synthetic existing approval identity; no new approval is fabricated by the read action.
    await db.document.update({ where: { id: f.attached.id }, data: { status: "APPROVED", approvedById: viewer.id, approvedAt: new Date() } });
    const beforeAudit = await db.auditLog.count({ where: { targetType: "Document", targetId: f.attached.id } });
    expect((await getMatterFinance(f.matter.id)).contractDocuments.map(row => row.id)).toEqual([f.attached.id]);
    expect(await db.auditLog.count({ where: { targetType: "Document", targetId: f.attached.id } })).toBe(beforeAudit);
  });

  it("失去 finance.read 时在读取附件前拒绝，即使另有文书审批资格", async () => {
    const f = await fixture(), viewer = await makeUser(true);
    await db.document.update({ where: { id: f.attached.id }, data: { status: "APPROVED", approvedById: viewer.id, approvedAt: new Date() } });
    await db.rolePermission.deleteMany({ where: { roleId: viewer.roleDefinitionId!, permissionKey: "finance.read" } });
    await setActor(viewer);
    const read = vi.spyOn(db.document, "findMany");
    try {
      await expect(getMatterFinance(f.matter.id)).rejects.toThrow("缺少 finance.read");
      expect(read).not.toHaveBeenCalled();
    } finally { read.mockRestore(); }
  });
});
