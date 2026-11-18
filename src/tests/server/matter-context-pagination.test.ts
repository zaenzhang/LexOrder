// @vitest-environment node
import type { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleGrant } from "@/lib/roles/catalog";

const { db, resolveRole, canRead, readGrant } = vi.hoisted(() => ({
  db: { $transaction: vi.fn(), user: { findUnique: vi.fn() }, matter: { count: vi.fn(), findFirst: vi.fn() },
    matterContextRecord: { findMany: vi.fn() }, document: { findMany: vi.fn(), findFirst: vi.fn() },
    note: { findMany: vi.fn(), findFirst: vi.fn() }, clientActivity: { findMany: vi.fn(), findFirst: vi.fn() } },
  resolveRole: vi.fn(), canRead: vi.fn(), readGrant: vi.fn(),
}));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: canRead, documentReadGrant: readGrant }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: resolveRole }));
vi.mock("@/lib/permissions", () => ({ matterAssociationFilter: () => ({}), matterFinanceVisibilityFilter: () => ({}), matterReadVisibilityFilter: () => ({}), customMatterFilter: () => ({}) }));
vi.mock("@/server/clients/relationship-access", () => ({ clientRelationshipFilter: () => ({ ownerUserId: "authorized-owner" }) }));
vi.mock("@/server/audit", () => ({ auditTx: vi.fn() }));

import { readMatterContext, readContextSourceOptions } from "@/server/matters/context-service";
import { decodeContextCursor, encodeContextCursor } from "@/server/matters/context-cursor";
import { encodeClientCursor } from "@/server/clients/history-cursor";

const actor = { id: "cmcontextuser000000000001", role: "CUSTOM" } as const;
const matterId = "cmcontextmatter0000000001";
const at = new Date("2026-11-16T08:00:00Z");
const recordId = (index: number) => `cmcontextrecord${String(index).padStart(10, "0")}`;
let grants: RoleGrant[];
const row = (index: number) => ({ id: recordId(index), matterId, seriesId: `series-${index}`, version: 1, kind: "GOAL", visibility: "MATTER",
  content: `合成记录 ${index}`, reason: null, sourceDescription: "合成来源说明", sourceNoteId: null, sourceClientActivityId: null, sourceDocumentId: null,
  occurredAt: at, createdAt: at, author: { name: "合成用户" }, confirmedBy: null, supersededBy: null, confirmationStatus: "PENDING", confirmedAt: null });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", "synthetic-context-pagination-only");
  grants = ["matters.read", "matters.write", "documents.read", "clients.read", "schedule.read"].map(permissionKey => ({ permissionKey, scope: "OWN" })) as RoleGrant[];
  resolveRole.mockImplementation(async () => ({ role: "CUSTOM", enabled: true, rolePermissions: grants }));
  db.$transaction.mockImplementation(async (callback: (tx: Prisma.TransactionClient) => unknown) => callback(db as unknown as Prisma.TransactionClient));
  db.user.findUnique.mockResolvedValue({ active: true, role: "CUSTOM" });
  db.matter.count.mockResolvedValue(1);
  db.matter.findFirst.mockResolvedValue({ id: matterId, status: "IN_PROGRESS", primaryClientId: "cmcontextclient000000001", intake: null, clientLinks: [] });
  db.matterContextRecord.findMany.mockResolvedValue([]);
  db.document.findMany.mockResolvedValue([]);
  db.note.findMany.mockResolvedValue([]);
  db.clientActivity.findMany.mockResolvedValue([]);
  canRead.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("上下文分页的当前资格及位置", () => {
  it("100条首批保留 Brief 合同，后页用时间与ID严格边界及当前财务范围", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => row(101 - index));
    db.matterContextRecord.findMany.mockResolvedValueOnce(rows);
    const first = await readMatterContext(db as unknown as PrismaClient, actor, matterId);
    expect(first.records).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    expect(decodeContextCursor(first.nextCursor!, matterId, actor.id, "records")).toEqual({ at: at.toISOString(), id: recordId(2) });
    await readMatterContext(db as unknown as PrismaClient, actor, matterId, first.nextCursor!);
    expect(db.matterContextRecord.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      take: 101, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      where: { matterId, visibility: "MATTER", supersededBy: { is: null }, OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: recordId(2) } }] },
    }));
    expect(db.user.findUnique).toHaveBeenCalledTimes(2);
    expect(resolveRole).toHaveBeenCalledTimes(2);
  });

  it("每页重新呈现原来源，撤权后不返回旧正文；停用账号不能用旧游标", async () => {
    const token = encodeContextCursor(matterId, actor.id, "records", { at: at.toISOString(), id: recordId(10) });
    db.matterContextRecord.findMany.mockResolvedValue([{ ...row(1), sourceDocumentId: recordId(99) }]);
    db.document.findFirst.mockResolvedValue({ id: recordId(99), matterId, name: "受限合成原件" });
    readGrant.mockResolvedValue(null);
    const next = await readMatterContext(db as unknown as PrismaClient, actor, matterId, token);
    expect(readGrant).toHaveBeenCalledWith(actor.id, expect.objectContaining({ id: recordId(99), matterId }), db, "READ");
    expect(next.records[0]).toMatchObject({ readable: false, content: null, sourceDescription: null, source: { id: null, label: null }, canRevise: false, canConfirm: false });
    db.user.findUnique.mockResolvedValue({ active: false, role: "CUSTOM" });
    await expect(readMatterContext(db as unknown as PrismaClient, actor, matterId, token)).rejects.toThrow("账号或岗位");
    expect(db.matterContextRecord.findMany).toHaveBeenCalledTimes(1);
  });

  it("来源整批不可读仍能继续，不暴露扫描到的隐藏材料身份", async () => {
    const docs = Array.from({ length: 101 }, (_, index) => ({ id: recordId(200 - index), createdAt: at, name: "隐藏合成材料", version: 1 }));
    db.document.findMany.mockResolvedValueOnce(docs);
    canRead.mockResolvedValue(false);
    const first = await readContextSourceOptions(db as unknown as PrismaClient, actor, matterId);
    expect(first.choices).toEqual([]);
    const token = first.nextCursors.DOCUMENT!;
    expect(token).toBeTruthy();
    expect(Buffer.from(token, "base64url").toString("utf8")).not.toContain(docs[99].id);
    db.document.findMany.mockResolvedValueOnce([{ id: recordId(1), createdAt: at, name: "可读更早材料", version: 3 }]);
    canRead.mockResolvedValue(true);
    const next = await readContextSourceOptions(db as unknown as PrismaClient, actor, matterId, { type: "DOCUMENT", cursor: token });
    expect(next.choices).toEqual([{ type: "DOCUMENT", id: recordId(1), label: "材料 · 可读更早材料 · 第 3 版" }]);
    expect(next.nextCursors.DOCUMENT).toBeNull();
    expect(db.document.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { matterId, deletedAt: null, OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: docs[99].id } }] } }));
    expect(db.note.findMany).toHaveBeenCalledTimes(1);
    expect(db.clientActivity.findMany).toHaveBeenCalledTimes(1);
  });

  it("沟通来源按对应类别继续，客户端不能用旧游标越过现行来源资格", async () => {
    db.note.findMany.mockResolvedValueOnce(Array.from({ length: 51 }, (_, index) => ({ id: recordId(100 - index), occurredAt: at, withWhom: "合成对象" })));
    db.clientActivity.findMany.mockResolvedValueOnce(Array.from({ length: 51 }, (_, index) => ({ id: recordId(200 - index), occurredAt: at, content: "合成沟通", client: { name: "合成客户" } })));
    const first = await readContextSourceOptions(db as unknown as PrismaClient, actor, matterId);
    await readContextSourceOptions(db as unknown as PrismaClient, actor, matterId, { type: "CLIENT_ACTIVITY", cursor: first.nextCursors.CLIENT_ACTIVITY! });
    expect(db.note.findMany).toHaveBeenCalledTimes(1);
    expect(db.clientActivity.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ client: { id: { in: ["cmcontextclient000000001"] }, deletedAt: null, AND: [{ ownerUserId: "authorized-owner" }] } }) }));
    grants = grants.filter(grant => grant.permissionKey !== "schedule.read");
    await expect(readContextSourceOptions(db as unknown as PrismaClient, actor, matterId, { type: "NOTE", cursor: first.nextCursors.NOTE! })).rejects.toThrow("已无权读取");
    expect(db.note.findMany).toHaveBeenCalledTimes(1);
  });

  it("篡改、跨案件/用户/类别和客户游标均明确失效，不回第一批", async () => {
    const point = { at: at.toISOString(), id: recordId(1) };
    const token = encodeContextCursor(matterId, actor.id, "records", point);
    expect(() => decodeContextCursor(token, recordId(999), actor.id, "records")).toThrow("分页位置已失效");
    expect(() => decodeContextCursor(token, matterId, recordId(999), "records")).toThrow("分页位置已失效");
    expect(() => decodeContextCursor(token, matterId, actor.id, "NOTE")).toThrow("分页位置已失效");
    const bytes = Buffer.from(token, "base64url"); bytes[30] ^= 1;
    await expect(readMatterContext(db as unknown as PrismaClient, actor, matterId, bytes.toString("base64url"))).rejects.toThrow("分页位置已失效");
    const otherDomain = encodeClientCursor(matterId, actor.id, "history", { ...point, source: "CONTEXT" });
    await expect(readMatterContext(db as unknown as PrismaClient, actor, matterId, otherDomain)).rejects.toThrow("分页位置已失效");
    expect(db.matterContextRecord.findMany).not.toHaveBeenCalled();
  });
});
