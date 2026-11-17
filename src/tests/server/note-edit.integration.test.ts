// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { Note, Prisma, User } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceActor } from "@/lib/runtime/actor";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("Note tests require an isolated _test database");
  return { url, actor: null as WorkspaceActor | null, failAudit: false };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/notes_test") };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: config.actor })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/audit", async () => {
  const actual = await vi.importActual<typeof import("@/server/audit")>("@/server/audit");
  return { ...actual, auditTx: async (...args: Parameters<typeof actual.auditTx>) => {
    if (config.failAudit) throw new Error("合成审计写入失败");
    return actual.auditTx(...args);
  } };
});

import { prisma as db } from "@/lib/prisma";
import { resolveRoleUser } from "@/lib/roles/service";
import { createNote, updateNote, type NoteCreateInput } from "@/server/notes/actions";

const users: string[] = [], matters: string[] = [], roles: string[] = [];
const occurredAt = new Date("2026-11-17T01:02:03.456Z");
async function setActor(user: User) {
  config.actor = { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
    ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" };
}
async function makeUser(custom = false) {
  let roleId: string | undefined;
  if (custom) {
    const name = `note-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name,
      permissions: { create: ["schedule.read", "schedule.write", "matters.read", "matters.write"].map(permissionKey => ({ permissionKey, scope: "OWN" })) } } });
    roles.push(role.id); roleId = role.id;
  }
  const user = await db.user.create({ data: { name: "合成记录经办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only",
    role: custom ? "CUSTOM" : "LAWYER", roleDefinitionId: roleId } });
  users.push(user.id); return user;
}
async function makeMatter(ownerId: string) {
  const matter = await db.matter.create({ data: { ownerId, title: "合成记录事项", internalCode: `NOTE-${randomUUID()}`, status: "IN_PROGRESS" } });
  matters.push(matter.id); return matter;
}
function input(matterId: string): NoteCreateInput {
  return { matterId, channel: "PHONE", withWhom: "合成联系人", occurredAt, content: "已核对合成材料", tags: ["自定义标签", "环节:准备"] };
}
const edit = (note: Note, content = "补充合成记录") => ({ ...input(note.matterId), id: note.id, expectedUpdatedAt: note.updatedAt, content });
async function fixture(custom = false, member = false) {
  const user = await makeUser(custom);
  const owner = member ? await makeUser() : user;
  const matter = await makeMatter(owner.id);
  if (member) await db.matterMember.create({ data: { matterId: matter.id, userId: user.id, role: "ASSISTANT" } });
  await setActor(user);
  const created = await createNote(input(matter.id));
  const note = await db.note.findUniqueOrThrow({ where: { id: created.id } });
  return { user, matter, note };
}
const auditCount = (id: string, action = "NOTE_UPDATE") => db.auditLog.count({ where: { targetType: "Note", targetId: id, action } });

async function priorCommit(mutate: (tx: Prisma.TransactionClient) => Promise<unknown>, attempt: () => Promise<unknown>) {
  let unlock!: () => void, acquired!: () => void;
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const locked = new Promise<void>(resolve => { acquired = resolve; });
  const prior = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
    await mutate(tx); acquired(); await gate;
  }, { timeout: 20_000 });
  await locked;
  let settled = false, observedWaiting = false;
  const outcome = attempt().then(value => ({ value, error: null }), error => ({ value: null, error })).finally(() => { settled = true; });
  try {
    for (let index = 0; index < 100 && !settled; index += 1) {
      const [waiting] = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM pg_locks WHERE locktype = 'advisory' AND objid = 72606101 AND NOT granted`;
      if (Number(waiting.count)) { observedWaiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally { unlock(); }
  await prior;
  expect(observedWaiting, "record write must wait behind the authorization/archive transaction").toBe(true);
  return outcome;
}

describe.skipIf(!config.url)("办案记录：真实 PG 所见版本、权限和事务审计", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  beforeEach(() => { config.failAudit = false; });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect(); vi.unstubAllEnvs();
  });

  it("创建及编辑留痕，保留作者、案件、附件、标签和发生时间精度", async () => {
    const f = await fixture();
    expect(await auditCount(f.note.id, "NOTE_CREATE")).toBe(1);
    const original = await db.note.update({ where: { id: f.note.id }, data: { attachments: ["synthetic-existing-attachment"] } });
    await updateNote(edit(original));
    const saved = await db.note.findUniqueOrThrow({ where: { id: original.id } });
    expect(saved).toMatchObject({ content: "补充合成记录", authorId: f.user.id, matterId: f.matter.id,
      attachments: original.attachments, tags: original.tags, occurredAt });
    expect(saved.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
    expect(await auditCount(original.id)).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { targetId: original.id, action: "NOTE_UPDATE" } });
    expect(audit).toMatchObject({ userId: f.user.id, detail: { matterId: f.matter.id,
      previousUpdatedAt: original.updatedAt.toISOString(), updatedAt: saved.updatedAt.toISOString() } });
  });

  it("同一所见版本的两个实际并发保存仅一个成功", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([updateNote(edit(f.note, "并发记录甲")), updateNote(edit(f.note, "并发记录乙"))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toHaveProperty("message", "记录已变化，请重新打开核对后保存");
    expect(["并发记录甲", "并发记录乙"]).toContain((await db.note.findUniqueOrThrow({ where: { id: f.note.id } })).content);
    expect(await auditCount(f.note.id)).toBe(1);
  });

  it("缺少所见版本拒绝保存", async () => {
    const f = await fixture();
    const withoutVersion: Partial<Parameters<typeof updateNote>[0]> = edit(f.note);
    delete withoutVersion.expectedUpdatedAt;
    await expect(updateNote(withoutVersion as Parameters<typeof updateNote>[0])).rejects.toThrow();
    expect(await db.note.findUniqueOrThrow({ where: { id: f.note.id } })).toEqual(f.note);
    expect(await auditCount(f.note.id)).toBe(0);
  });

  it.each(["other-author", "other-matter", "deleted", "archive"] as const)("拒绝 %s，不更改记录或新增修改审计", async state => {
    const f = await fixture();
    let attempted = edit(f.note);
    if (state === "other-author") {
      const other = await makeUser();
      await db.matterMember.create({ data: { matterId: f.matter.id, userId: other.id, role: "ASSISTANT" } });
      await setActor(other);
    }
    if (state === "other-matter") attempted = { ...attempted, matterId: (await makeMatter(f.user.id)).id };
    if (state === "deleted") await db.note.update({ where: { id: f.note.id }, data: { deletedAt: new Date() } });
    if (state === "archive") await db.matter.update({ where: { id: f.matter.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    const before = await db.note.findUniqueOrThrow({ where: { id: f.note.id } });
    await expect(updateNote(attempted)).rejects.toThrow();
    expect(await db.note.findUniqueOrThrow({ where: { id: f.note.id } })).toEqual(before);
    expect(await auditCount(f.note.id)).toBe(0);
  });

  it.each(["member", "disabled", "permission", "archive"] as const)("锁前快照不能越过先提交的 %s 变化", async state => {
    const f = await fixture(state === "permission", state === "member");
    const result = await priorCommit(async tx => {
      if (state === "member") return tx.matterMember.deleteMany({ where: { matterId: f.matter.id, userId: f.user.id } });
      if (state === "disabled") return tx.user.update({ where: { id: f.user.id }, data: { active: false } });
      if (state === "permission") return tx.rolePermission.deleteMany({ where: { roleId: f.user.roleDefinitionId!, permissionKey: "schedule.write" } });
      return tx.matter.update({ where: { id: f.matter.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    }, () => updateNote(edit(f.note)));
    expect(result.error).toBeInstanceOf(Error);
    expect(await db.note.findUniqueOrThrow({ where: { id: f.note.id } })).toEqual(f.note);
    expect(await auditCount(f.note.id)).toBe(0);
  });

  it("审计失败使编辑和新建均回滚", async () => {
    const f = await fixture();
    config.failAudit = true;
    await expect(updateNote(edit(f.note))).rejects.toThrow("合成审计写入失败");
    await expect(createNote({ ...input(f.matter.id), content: "不应留下的新建记录" })).rejects.toThrow("合成审计写入失败");
    expect(await db.note.findMany({ where: { matterId: f.matter.id } })).toEqual([f.note]);
    expect(await auditCount(f.note.id)).toBe(0);
    expect(await auditCount(f.note.id, "NOTE_CREATE")).toBe(1);
  });
});
