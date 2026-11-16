// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    document: { findUnique: vi.fn(), findMany: vi.fn() },
    matter: { findFirst: vi.fn() }, user: { findUnique: vi.fn(), findMany: vi.fn() },
    evidenceItem: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    evidenceSourceLink: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    evidenceItemRevision: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(), $queryRaw: vi.fn(),
  },
  session: { user: { id: "clawyer0000000000000000001", role: "LAWYER", rolePermissions: undefined } },
  handle: vi.fn(), read: vi.fn(), writable: vi.fn(), currentRole: vi.fn(), canReadDocument: vi.fn(),
  audit: vi.fn(), auditStrict: vi.fn(), revalidate: vi.fn(), material: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/permissions", () => ({
  assertCanHandleMatter: mocks.handle, assertCanReadMatter: mocks.read,
  matterAssociationFilter: (id: string) => ({ OR: [{ ownerId: id }, { members: { some: { userId: id } } }] }),
}));
vi.mock("@/lib/archive/guard", () => ({ assertMatterWritable: mocks.writable }));
vi.mock("@/lib/roles/service", () => ({ checkRoleMutation: mocks.currentRole }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: mocks.canReadDocument }));
vi.mock("@/server/audit", () => ({ auditTx: mocks.audit, auditStrict: mocks.auditStrict }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: mocks.revalidate }));
vi.mock("@/server/documents/material-processing", () => ({ readMaterialSource: mocks.material }));

import {
  addEvidenceSource, confirmEvidenceItem, createEvidenceItem, getEvidenceItem, listEvidenceItems,
  listEvidenceRevisions, removeEvidenceSource, resolveEvidenceSource, updateEvidenceItem,
} from "@/server/evidence/actions";

const MATTER = "cmatter00000000000000000001";
const OTHER = "cmatter00000000000000000002";
const DOC = "cdocume000000000000000000001";
const DOC_B = "cdocume000000000000000000002";
const ITEM = "ceviden000000000000000000001";
const SOURCE = "csource00000000000000000001";
const SOURCE_B = "csource00000000000000000002";
const RUN = "cparser00000000000000000001";
const HASH = "a".repeat(64);
const now = new Date("2026-11-16T08:00:00Z");
function fixture() {
  return {
    item: { id: ITEM, matterId: MATTER, title: "合成合同款", content: "合成记录：已支付价款。", kind: "FACT",
      sourceDocumentId: null as string | null, sourcePage: null as number | null, revision: 1, updatedAt: now,
      confirmedById: null as string | null, confirmedAt: null as Date | null, createdById: mocks.session.user.id, createdAt: now },
    documents: [
      { id: DOC, matterId: MATTER, intakeId: null, uploadedById: mocks.session.user.id, deletedAt: null as Date | null,
        sha256: HASH as string | null, name: "合成合同.pdf", version: 1, mimeType: "application/pdf", pageCount: 3 },
      { id: DOC_B, matterId: MATTER, intakeId: null, uploadedById: mocks.session.user.id, deletedAt: null as Date | null,
        sha256: "b".repeat(64) as string | null, name: "合成反向材料.pdf", version: 1, mimeType: "application/pdf", pageCount: 2 },
    ],
    sources: [{ id: SOURCE, evidenceItemId: ITEM, documentId: DOC, documentSha256: HASH, relation: "SUPPORTS",
      location: { kind: "PAGE", page: 2 }, locationKey: "PAGE:2", parseRunId: null as string | null, anchorId: null as string | null,
      createdById: mocks.session.user.id, createdAt: now, removedAt: null as Date | null, removedById: null as string | null }],
    revisions: [] as Array<Record<string, any>>,
  };
}
let state: ReturnType<typeof fixture>;
function currentItem() {
  return structuredClone({ ...state.item, sources: state.sources.filter(source => !source.removedAt),
    createdBy: { name: "合成记录人" }, confirmedBy: state.item.confirmedById ? { name: "合成确认人" } : null });
}
beforeEach(() => {
  vi.resetAllMocks();
  state = fixture();
  for (const fn of [mocks.handle, mocks.read, mocks.writable, mocks.currentRole, mocks.audit, mocks.auditStrict, mocks.revalidate]) fn.mockResolvedValue(undefined);
  mocks.canReadDocument.mockResolvedValue(true);
  mocks.db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(mocks.db));
  mocks.db.$queryRaw.mockResolvedValue([]);
  mocks.db.matter.findFirst.mockResolvedValue({ id: MATTER, status: "ACTIVE" });
  mocks.db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER" });
  mocks.db.user.findMany.mockResolvedValue([{ id: mocks.session.user.id, name: "合成确认人" }]);
  mocks.db.document.findUnique.mockImplementation(async ({ where }) => structuredClone(state.documents.find(document => document.id === where.id) ?? null));
  mocks.db.document.findMany.mockImplementation(async ({ where }) => structuredClone(state.documents.filter(document =>
    (!where.id?.in || where.id.in.includes(document.id)) && (!where.matterId || document.matterId === where.matterId))));
  mocks.db.evidenceItem.findUnique.mockImplementation(async ({ where, select }) => where.id !== ITEM ? null : select?.matterId ? { matterId: state.item.matterId } : currentItem());
  mocks.db.evidenceItem.findMany.mockImplementation(async () => [currentItem()]);
  mocks.db.evidenceItem.create.mockResolvedValue({ id: ITEM });
  mocks.db.evidenceItem.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.id !== state.item.id || where.revision !== state.item.revision || (where.confirmedAt === null && state.item.confirmedAt !== null)) return { count: 0 };
    const { revision, ...rest } = data;
    Object.assign(state.item, rest);
    if (revision?.increment) state.item.revision += revision.increment;
    return { count: 1 };
  });
  mocks.db.evidenceItemRevision.create.mockImplementation(async ({ data }) => {
    const saved = structuredClone({ id: "crevis00000000000000000001", createdAt: now, ...data });
    state.revisions.push(saved); return saved;
  });
  mocks.db.evidenceItemRevision.findMany.mockImplementation(async ({ where }) =>
    state.revisions.filter(row => row.revision < where.revision.lt).sort((a, b) => b.revision - a.revision).map(row => ({ ...row, editedBy: { name: "合成编辑人" } })));
  mocks.db.evidenceItemRevision.findUnique.mockImplementation(async ({ where }) =>
    structuredClone(state.revisions.find(row => row.revision === where.evidenceItemId_revision.revision) ?? null));
  mocks.db.evidenceSourceLink.findUnique.mockImplementation(async ({ where }) => {
    const key = where.evidenceItemId_documentId_relation_locationKey;
    return structuredClone(state.sources.find(source => where.id ? source.id === where.id :
      source.evidenceItemId === key.evidenceItemId && source.documentId === key.documentId && source.relation === key.relation && source.locationKey === key.locationKey) ?? null);
  });
  mocks.db.evidenceSourceLink.create.mockImplementation(async ({ data }) => {
    const source = { id: SOURCE_B, createdAt: now, removedAt: null, removedById: null, ...data };
    state.sources.push(source); return { id: source.id };
  });
  mocks.db.evidenceSourceLink.update.mockImplementation(async ({ where, data }) => {
    const source = state.sources.find(row => row.id === where.id)!; Object.assign(source, data); return { id: source.id };
  });
});

describe("Server 人工证据成果及来源", () => {
  it("creates a pending manual item and checks the server archive/membership guard", async () => {
    const result = await createEvidenceItem({ matterId: MATTER, title: " 手工主张 ", content: " 合成陈述 ", kind: "CLAIM" });
    expect(result).toEqual({ ok: true, id: ITEM });
    expect(mocks.writable).toHaveBeenCalledWith(MATTER, { allowPrincipal: true });
    expect(mocks.db.evidenceItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: "手工主张", kind: "CLAIM" }) }));
    expect(mocks.db.evidenceItem.create.mock.calls[0][0].data).not.toHaveProperty("confirmedAt");
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ action: "EVIDENCE_ITEM_CREATE" }));
  });

  it("keeps concrete source identity and refuses cross-matter, deleted, unidentifiable and out-of-range sources", async () => {
    const input = { evidenceItemId: ITEM, expectedRevision: 1, documentId: DOC_B, relation: "REBUTS" as const, page: 1 };
    state.documents[1].matterId = OTHER;
    await expect(addEvidenceSource(input)).rejects.toThrow("不属于");
    state.documents[1].matterId = MATTER; state.documents[1].deletedAt = now;
    await expect(addEvidenceSource(input)).rejects.toThrow("已删除");
    state.documents[1].deletedAt = null; state.documents[1].sha256 = null;
    await expect(addEvidenceSource(input)).rejects.toThrow("原件标识");
    state.documents[1].sha256 = "b".repeat(64);
    await expect(addEvidenceSource({ ...input, page: 3 })).rejects.toThrow("页数内");
    expect(mocks.db.evidenceSourceLink.create).not.toHaveBeenCalled();
    expect(mocks.db.evidenceItemRevision.create).not.toHaveBeenCalled();
  });

  it("requires document read access in addition to matter handling permission", async () => {
    mocks.canReadDocument.mockImplementation(async (_user, document) => document.id !== DOC_B);
    await expect(addEvidenceSource({ evidenceItemId: ITEM, expectedRevision: 1, documentId: DOC_B, relation: "REBUTS" })).rejects.toThrow("无权读取");
    expect(mocks.db.evidenceItemRevision.create).not.toHaveBeenCalled();
  });

  it("snapshots the confirmed old text and source list before edit, then clears confirmation", async () => {
    state.item.confirmedById = mocks.session.user.id; state.item.confirmedAt = now;
    const result = await updateEvidenceItem({ evidenceItemId: ITEM, expectedRevision: 1, title: "合成更正", content: "尚待核实支付。", kind: "TODO_VERIFY" });
    expect(result.revision).toBe(2);
    expect(state.revisions[0]).toMatchObject({ revision: 1, title: "合成合同款", confirmedById: mocks.session.user.id, confirmedAt: now });
    expect(state.revisions[0].sourceSnapshot).toEqual([expect.objectContaining({ id: SOURCE, documentId: DOC, documentSha256: HASH })]);
    expect(state.item).toMatchObject({ revision: 2, confirmedById: null, confirmedAt: null, kind: "TODO_VERIFY" });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ action: "EVIDENCE_ITEM_EDIT", detail: expect.objectContaining({ revision: 2, confirmationCleared: true }) }));
  });

  it("rejects stale input before creating a snapshot or writing", async () => {
    state.item.revision = 2;
    await expect(updateEvidenceItem({ evidenceItemId: ITEM, expectedRevision: 1, title: "过期输入", content: "不应覆盖", kind: "FACT" })).rejects.toThrow("已有新修订");
    expect(mocks.db.evidenceItemRevision.create).not.toHaveBeenCalled();
    expect(mocks.db.evidenceItem.updateMany).not.toHaveBeenCalled();
  });

  it("confirms only an explicit current revision and makes a repeated confirmation idempotent", async () => {
    await confirmEvidenceItem({ evidenceItemId: ITEM, expectedRevision: 1, confirm: true });
    const repeated = await confirmEvidenceItem({ evidenceItemId: ITEM, expectedRevision: 1, confirm: true });
    expect(repeated.alreadyConfirmed).toBe(true);
    expect(state.item.revision).toBe(1);
    expect(state.revisions).toHaveLength(0);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    await expect(confirmEvidenceItem({ evidenceItemId: ITEM, expectedRevision: 1, confirm: false } as never)).rejects.toThrow();
  });

  it("adds opposing sources once, snapshots membership, and resolves removed sources from their historical revision", async () => {
    state.item.confirmedById = mocks.session.user.id; state.item.confirmedAt = now;
    await addEvidenceSource({ evidenceItemId: ITEM, expectedRevision: 1, documentId: DOC_B, relation: "REBUTS", page: 1 });
    expect(state.item).toMatchObject({ revision: 2, confirmedAt: null });
    expect(state.revisions[0].sourceSnapshot).toHaveLength(1);
    await addEvidenceSource({ evidenceItemId: ITEM, expectedRevision: 2, documentId: DOC_B, relation: "REBUTS", page: 1 });
    expect(state.item.revision).toBe(2);
    expect(mocks.db.evidenceSourceLink.create).toHaveBeenCalledTimes(1);
    await removeEvidenceSource({ evidenceItemId: ITEM, expectedRevision: 2, sourceId: SOURCE_B });
    expect(state.revisions[1].sourceSnapshot).toHaveLength(2);
    expect(await resolveEvidenceSource({ evidenceItemId: ITEM, sourceId: SOURCE_B })).toEqual({ status: "UNAVAILABLE" });
    expect(await resolveEvidenceSource({ evidenceItemId: ITEM, sourceId: SOURCE_B, revision: 2 })).toMatchObject({ status: "AVAILABLE", documentName: "合成反向材料.pdf", originalUrl: expect.stringContaining(DOC_B) });
  });

  it("rechecks revoked access for current content, historical content and source open; unlink cannot bypass it", async () => {
    await updateEvidenceItem({ evidenceItemId: ITEM, expectedRevision: 1, title: "合成更正", content: "新内容", kind: "FACT" });
    mocks.canReadDocument.mockResolvedValue(false);
    const current = await getEvidenceItem(ITEM);
    const history = await listEvidenceRevisions({ evidenceItemId: ITEM });
    expect(current.item).toMatchObject({ restricted: true, content: "", canEdit: false });
    expect(current.item.sources[0]).toMatchObject({ documentName: null, documentId: null, status: "UNAVAILABLE" });
    expect(history.items[0]).toMatchObject({ restricted: true, content: "" });
    expect(await resolveEvidenceSource({ evidenceItemId: ITEM, sourceId: SOURCE, revision: 1 })).toEqual({ status: "UNAVAILABLE" });
    await expect(removeEvidenceSource({ evidenceItemId: ITEM, expectedRevision: 2, sourceId: SOURCE })).rejects.toThrow("不可读");
  });

  it("keeps a new family version separate and refuses a changed hash on the referenced version", async () => {
    state.documents[1].version = 2;
    expect(await resolveEvidenceSource({ evidenceItemId: ITEM, sourceId: SOURCE })).toMatchObject({ documentVersion: 1, originalUrl: `/api/documents/${DOC}/download?inline=1#page=2` });
    state.documents[0].sha256 = "c".repeat(64);
    expect(await resolveEvidenceSource({ evidenceItemId: ITEM, sourceId: SOURCE })).toEqual({ status: "UNAVAILABLE" });
    expect((await listEvidenceItems(MATTER))[0]).toMatchObject({ restricted: true, content: "" });
  });

  it("preserves legacy references without inventing a hash, relation or confirmation", async () => {
    state.sources = []; state.item.sourceDocumentId = DOC; state.item.sourcePage = 2; state.documents[0].sha256 = null;
    const [row] = await listEvidenceItems(MATTER);
    expect(row).toMatchObject({ sourceDocumentId: DOC, sourceDocumentName: "合成合同.pdf", sourcePage: 2, confirmedAt: null });
    expect(row.sources[0]).toMatchObject({ legacy: true, relation: null, status: "AVAILABLE" });
    expect(await resolveEvidenceSource({ evidenceItemId: ITEM, sourceId: "legacy:" + DOC })).toMatchObject({ legacy: true, status: "AVAILABLE" });
    expect(mocks.db.evidenceSourceLink.create).not.toHaveBeenCalled();
  });

  it("uses the immutable W05 anchor and rejects mismatched source identity", async () => {
    mocks.material.mockResolvedValue({ status: "AVAILABLE", document: { id: DOC_B, sha256: "b".repeat(64) },
      run: { id: RUN, isCurrent: true }, anchor: { anchorId: "a-one", source: { kind: "CASE_MATERIAL", matterId: MATTER, documentId: DOC_B, sha256: HASH }, parseGenerationId: RUN, unit: 1, location: { kind: "TEXT", start: 0, end: 4 }, text: "合成引文" } });
    const input = { evidenceItemId: ITEM, expectedRevision: 1, documentId: DOC_B, relation: "CONTEXT" as const, parseRunId: RUN, anchorId: "a-one" };
    await expect(addEvidenceSource(input)).rejects.toThrow("来源身份不匹配");
    const value = await mocks.material.getMockImplementation()!();
    value.anchor.source.sha256 = "b".repeat(64);
    mocks.material.mockResolvedValue(value);
    await addEvidenceSource(input);
    expect(mocks.db.evidenceSourceLink.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      parseRunId: RUN, anchorId: "a-one", location: { kind: "TEXT", start: 0, end: 4 }, locationKey: `ANCHOR:${RUN}:a-one`,
    }) }));
    expect(mocks.material).toHaveBeenCalledWith(mocks.session.user.id, { documentId: DOC_B, runId: RUN, anchorId: "a-one" }, mocks.db);
  });

  it("rejects archived/changed-actor writes and propagates audit failure", async () => {
    const input = { evidenceItemId: ITEM, expectedRevision: 1, title: "新标题", content: "新内容", kind: "FACT" as const };
    mocks.db.matter.findFirst.mockResolvedValue({ id: MATTER, status: "ARCHIVED" });
    await expect(updateEvidenceItem(input)).rejects.toThrow("归档");
    mocks.db.matter.findFirst.mockResolvedValue({ id: MATTER, status: "ACTIVE" });
    mocks.db.user.findUnique.mockResolvedValue({ active: false, role: "LAWYER" });
    await expect(updateEvidenceItem(input)).rejects.toThrow("资格已变化");
    mocks.db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER" });
    mocks.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(updateEvidenceItem(input)).rejects.toThrow("audit unavailable");
    expect(mocks.revalidate).not.toHaveBeenCalled();
    // This is an action contract test; PostgreSQL rollback/immutable triggers are integration checks.
  });

  it("retains the original matter-read and matter-handle boundaries", async () => {
    mocks.handle.mockRejectedValue(new Error("无办理资格"));
    await expect(createEvidenceItem({ matterId: MATTER, title: "x", content: "y", kind: "FACT" })).rejects.toThrow("无办理资格");
    mocks.read.mockRejectedValue(new Error("无事项读取资格"));
    await expect(listEvidenceItems(MATTER)).rejects.toThrow("无事项读取资格");
    expect(mocks.db.evidenceItem.create).not.toHaveBeenCalled();
  });
});
