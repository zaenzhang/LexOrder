// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";

const { actor, state, db } = vi.hoisted(() => ({
  actor: { id: "clocal00000000000000000000", role: "INDEPENDENT_LAWYER", runtimeMode: "PERSONAL" as const, systemRole: "NONE", managerAuthorized: false },
  state: { personal: true, clientOwned: true, matterOwned: true, tailOwner: "clocal00000000000000000000" },
  db: { $queryRaw: vi.fn(), $transaction: vi.fn(),
    user: { findUnique: vi.fn() }, matter: { count: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    client: { count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    contact: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    intake: { updateMany: vi.fn() }, matterClient: { findMany: vi.fn() },
    clientActivity: { updateMany: vi.fn() }, clientFollowUp: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/runtime/mode", () => ({ isPersonalMode: () => state.personal }));
vi.mock("@/server/runtime/personal", () => ({ resolvePersonalActor: vi.fn(async (_db, id?: string) => {
  if (!state.personal) return null;
  if (id !== undefined && id !== actor.id) throw new ActionError("非本机操作者");
  return actor;
}) }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { ...actor, runtimeMode: state.personal ? "PERSONAL" : "SERVER" } })) }));
vi.mock("@/lib/roles/service", () => ({ checkRoleMutation: vi.fn(), resolveRoleUser: vi.fn(async () => ({ ...actor, enabled: true })), roleMutation: vi.fn(async (_user, _key, write) => write(db)) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addContact, deleteContact, softDeleteClient, updateClient } from "@/server/clients/actions";
import { mergeClients } from "@/server/clients/dedup";
import { assertTailAuthority, saveClosureTx } from "@/server/archive/closure";
import { assertDocumentWritable } from "@/lib/archive/guard";

const clientId = "cclient0000000000000000000";
const matterId = "cmatter0000000000000000000";
const transaction = db as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.clearAllMocks(); state.personal = true; state.clientOwned = true; state.matterOwned = true; state.tailOwner = actor.id;
  db.user.findUnique.mockResolvedValue({ ...actor, active: true });
  db.$transaction.mockImplementation(async write => write(db));
  db.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => {
    const sql = parts.join("?");
    if (sql.includes("to_regclass")) return [{ ready: true }];
    if (sql.includes('"financeOwnerId" FROM "ArchiveClosurePlan"')) return [{ financeOwnerId: state.tailOwner }];
    return [];
  });
  db.client.count.mockImplementation(async () => state.clientOwned ? 1 : 0);
  db.client.findFirst.mockImplementation(async ({ where }) => state.clientOwned ? { id: where.id, ownerUserId: actor.id } : null);
  db.client.findUnique.mockImplementation(async ({ where }) => ({ id: where.id, name: "合成客户", deletedAt: null, internalCode: "KH-SYNTHETIC" }));
  db.client.update.mockResolvedValue({ id: clientId });
  db.contact.findUnique.mockResolvedValue({ id: "contact", clientId });
  db.contact.create.mockResolvedValue({ id: "contact" });
  db.matter.count.mockImplementation(async () => state.matterOwned ? 1 : 0);
  db.matter.findFirst.mockImplementation(async () => state.matterOwned ? { status: "ARCHIVED", archivedAt: new Date() } : null);
  db.matterClient.findMany.mockResolvedValue([]);
});

describe("Personal client ownership and archive tail", () => {
  it("allows ordinary client and contact maintenance for the real local owner", async () => {
    await expect(updateClient({ id: clientId, name: "合成客户", type: "INDIVIDUAL", contacts: [], tags: [], cooperationStatus: "SIGNED" })).resolves.toEqual({ ok: true, id: clientId });
    await expect(addContact(clientId, { name: "合成联系人", isPrimary: false })).resolves.toEqual({ ok: true, id: "contact" });
    await expect(deleteContact("contact")).resolves.toEqual({ ok: true });
    await expect(softDeleteClient(clientId)).resolves.toEqual({ ok: true });
    expect(db.client.count).toHaveBeenCalledWith({ where: { id: clientId, deletedAt: null, ownerUserId: actor.id } });
  });

  it("rejects foreign client objects before any edit, delete or contact mutation", async () => {
    state.clientOwned = false;
    await expect(updateClient({ id: clientId, name: "合成客户", type: "INDIVIDUAL", contacts: [], tags: [], cooperationStatus: "SIGNED" })).rejects.toThrow("不属于本机操作者");
    await expect(addContact(clientId, { name: "合成联系人", isPrimary: false })).rejects.toThrow("不属于本机操作者");
    await expect(deleteContact("contact")).rejects.toThrow("不属于本机操作者");
    await expect(softDeleteClient(clientId)).rejects.toThrow("不属于本机操作者");
    expect(db.client.update).not.toHaveBeenCalled(); expect(db.contact.create).not.toHaveBeenCalled(); expect(db.contact.delete).not.toHaveBeenCalled();
  });

  it("keeps the Server independent-lawyer client-edit policy unchanged", async () => {
    state.personal = false;
    await expect(updateClient({ id: clientId, name: "合成客户", type: "INDIVIDUAL", contacts: [], tags: [], cooperationStatus: "SIGNED" })).rejects.toThrow("仅管理员或主办律师");
  });

  it("merges own client records through the existing lock and relationship checks", async () => {
    await expect(mergeClients({ keepId: clientId, mergeId: "cmerge00000000000000000000", basis: "合成重复建档" })).resolves.toMatchObject({ ok: true, keptId: clientId });
    expect(db.client.findFirst).toHaveBeenCalledWith({ where: { id: clientId, deletedAt: null, AND: [{ ownerUserId: actor.id }, { ownerUserId: actor.id }] }, select: { id: true, ownerUserId: true } });
    state.clientOwned = false;
    await expect(mergeClients({ keepId: clientId, mergeId: "cmerge00000000000000000000", basis: "合成重复建档" })).rejects.toThrow("无权维护");
  });

  it("allows archived finance only for the designated local owner on an owned matter", async () => {
    await expect(assertTailAuthority(transaction, actor.id, matterId)).resolves.toBeUndefined();
    state.tailOwner = "other";
    await expect(assertTailAuthority(transaction, actor.id, matterId)).rejects.toThrow("指定的财务收尾负责人");
    state.tailOwner = actor.id; state.matterOwned = false;
    await expect(assertTailAuthority(transaction, actor.id, matterId)).rejects.toThrow("仅本案本机操作者");
  });

  it("rejects assigning another person in a Personal closure plan", async () => {
    await expect(saveClosureTx(transaction, actor.id, { matterId, revision: null, financeOwnerId: "cother00000000000000000000", serviceCompletedAt: new Date("2026-01-01"), reason: "合成收尾安排" })).rejects.toThrow("只能指定本人");
  });

  it("permits append-only archive supplementation without allowing ordinary document changes", async () => {
    await expect(assertDocumentWritable(matterId, { kind: "upload", folderName: "归档" })).resolves.toBeUndefined();
    await expect(assertDocumentWritable(matterId, { kind: "upload", folderName: "证据" })).rejects.toThrow("仅允许补传");
    await expect(assertDocumentWritable(matterId, { kind: "modify" })).rejects.toThrow("不可修改或删除");
    state.matterOwned = false;
    await expect(assertDocumentWritable(matterId, { kind: "upload", folderName: "归档" })).rejects.toThrow("无权处理");
  });
});
