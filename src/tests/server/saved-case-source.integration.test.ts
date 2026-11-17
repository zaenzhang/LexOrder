// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import type { WorkspaceActor } from "@/lib/runtime/actor";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && (!new URL(url).pathname.endsWith("_test") || !process.env.APP_STORAGE_DIR || process.env.STORAGE_PROVIDER === "s3")) {
    throw new Error("已保存类案验证只允许隔离 _test 数据库与显式本地存储目录");
  }
  return { url, actionActor: null as WorkspaceActor | null, requestIdentity: null as { id: string; sessionVersion: number } | null };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/saved_case_test") };
});
// Real PG/storage and original business actions, with an explicit synthetic session boundary; no HTTP login/provider call.
vi.mock("@/lib/auth/session", () => {
  const getSession = vi.fn(async () => {
    if (!config.requestIdentity) return null;
    const { prisma } = await import("@/lib/prisma");
    const { resolveRoleUser } = await import("@/lib/roles/service");
    const user = await prisma.user.findUnique({ where: { id: config.requestIdentity.id } });
    if (!user?.active || user.sessionVersion !== config.requestIdentity.sessionVersion) return null;
    const role = await resolveRoleUser(user.id, user.role);
    if (!role.enabled) return null;
    return { user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
      ...role, runtimeMode: "SERVER" as const } };
  });
  return { getSession,
    requireSession: vi.fn(async () => {
      if (config.actionActor) return { user: config.actionActor };
      const session = await getSession();
      if (!session) throw new Error("Synthetic request session expired");
      return session;
    }),
    requireSystemAdmin: vi.fn(async () => {
      if (config.actionActor?.systemRole !== "SUPER_ADMIN") throw new Error("Synthetic administrator required");
      return { user: config.actionActor };
    }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { storage } from "@/lib/storage";
import { resolveRoleUser } from "@/lib/roles/service";
import { saveCaseToMatter, saveVectorCaseToMatter } from "@/server/yuandian/save-case";
import { getResearchOptions, getSavedCaseResearchInput } from "@/server/research/actions";
import { emptyResearchContent } from "@/server/research/contracts";
import { readResearch, saveResearch } from "@/server/research/service";
import { createResearchDraft } from "@/server/research/draft";
import { assertDocumentDerivationAccess } from "@/server/documents/derivation-access";
import { withdrawMaterial } from "@/server/documents/material-ingest";
import { updateMatterTeam } from "@/server/matters/actions";
import { resetUserPassword } from "@/server/users/actions";

const users: string[] = [], matters: string[] = [];
const realRead = storage.readFile.bind(storage);
const realSession = vi.mocked(getSession).getMockImplementation()!;
async function actorFor(user: User): Promise<WorkspaceActor> {
  return { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
    ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" };
}
async function fixture(vector = false) {
  async function user(name: string, admin = false) {
    const value = await db.user.create({ data: { name, email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-service-fixture",
      role: "LAWYER", ...(admin ? { systemRole: "SUPER_ADMIN" } : {}) } }); users.push(value.id); return value;
  }
  const owner = await user("合成类案经办"), member = await user("合成类案协办"), admin = await user("合成类案管理员", true);
  const matter = await db.matter.create({ data: { title: "合成已保存类案研究", internalCode: `SAVED-CASE-${randomUUID()}`, ownerId: owner.id,
    members: { create: [{ userId: owner.id, role: "LEAD" }, { userId: member.id, role: "CO_LEAD" }] } } }); matters.push(matter.id);
  const actor = await actorFor(owner);
  config.requestIdentity = { id: owner.id, sessionVersion: owner.sessionVersion };
  const common = { ah: "（2019）合成类案001号", title: "合成旧案标题", ay: ["合成案由"], jbdw: "合成法院", ajlb: "民事", xzqh_p: "合成地区",
    wszl: "判决书", content: "合成裁判返回片段，不能证明裁判全文。", detailUrl: "https://example.invalid/saved-case" };
  const saved = vector ? await saveVectorCaseToMatter({ matterId: matter.id, caseHit: { ...common, scid: randomUUID(), anyou: ["合成案由"], jaDate: 20190102, score: 0.8123 } })
    : await saveCaseToMatter({ matterId: matter.id, caseHit: { ...common, id: randomUUID(), cprq: "2019-01-02" } });
  const document = await db.document.findUniqueOrThrow({ where: { id: saved.documentId } });
  return { owner, member, admin, actor, matter, document };
}

describe.skipIf(!config.url)("已有类案采用 / 真实 PostgreSQL、保存入口及本地原件", () => {
  beforeAll(async () => { await db.$connect(); });
  afterEach(() => { vi.restoreAllMocks(); vi.mocked(getSession).mockImplementation(realSession); config.actionActor = null; config.requestIdentity = null; });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.$disconnect();
  });

  it.each([false, true])("真实保存入口 vector=%s →采用→固定研究→分析稿，来源撤回后派生正文不可读", async vector => {
    const f = await fixture(vector);
    // Renaming and removing tags must not lose the exact save-entry evidence.
    await db.document.update({ where: { id: f.document.id }, data: { name: "合成改名材料.md", tags: [] } });
    expect((await getResearchOptions(f.matter.id)).savedCaseDocumentIds).toEqual([f.document.id]);
    const adopted = await getSavedCaseResearchInput(f.matter.id, f.document.id);
    expect(adopted.source).toMatchObject({ documentId: f.document.id, page: null, relation: "CONTEXT",
      lawMetadata: { kind: "CASE", verification: "PENDING", title: "合成旧案标题", jurisdiction: "", acquiredOn: "", effectiveFrom: "" } });
    expect(adopted.query).toMatchObject({ sourceDocumentId: f.document.id, access: "SUMMARY", outcome: "UNREAD" });
    expect(adopted).not.toHaveProperty("path");
    const data = { ...emptyResearchContent(), matterId: f.matter.id, requestKey: randomUUID(), supersedesId: null, expectedVersion: null,
      question: "合成材料对本案争点有何意义", sources: [adopted.source], queryLog: [{ ...adopted.query, notes: `${adopted.query.notes}\n人工补记：待核实适用性。` }] };
    const saved = await saveResearch(db, f.actor, data);
    const reopened = await readResearch(db, f.actor, f.matter.id, saved.id);
    expect(reopened.content?.queryLog).toEqual(data.queryLog);
    expect(await db.researchSource.findFirstOrThrow({ where: { researchRevisionId: saved.id } })).toMatchObject({ documentId: f.document.id, documentSha256: f.document.sha256 });
    const auditCount = await db.auditLog.count({ where: { userId: f.owner.id, action: { in: ["RESEARCH_CREATE", "RESEARCH_REVISE"] } } });
    await expect(saveResearch(db, f.actor, { ...data, requestKey: randomUUID(), supersedesId: saved.id, expectedVersion: 1, sources: [] })).rejects.toThrow("保留对应来源");
    expect(await db.researchRevision.count({ where: { matterId: f.matter.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: f.owner.id, action: { in: ["RESEARCH_CREATE", "RESEARCH_REVISE"] } } })).toBe(auditCount);
    const draft = await createResearchDraft(db, f.actor, { matterId: f.matter.id, researchRevisionId: saved.id, requestKey: randomUUID() });
    expect((await db.document.findUniqueOrThrow({ where: { id: draft.documentId } })).path).toBeTruthy();
    await withdrawMaterial(f.owner.id, f.document.id, false);
    expect((await readResearch(db, f.actor, f.matter.id, saved.id))).toMatchObject({ readable: false, content: null });
    await expect(assertDocumentDerivationAccess(f.owner.id, draft.documentId, { purpose: "READ", db })).rejects.toThrow("来源");
    await expect(createResearchDraft(db, f.actor, { matterId: f.matter.id, researchRevisionId: saved.id, requestKey: randomUUID() })).rejects.toThrow("来源");
  });

  it("同名标签、错误事项审计、同族新版与无标识均非自动候选；越案和撤回在存储读取前拒绝", async () => {
    const f = await fixture();
    const other = await db.matter.create({ data: { title: "合成另一事项", internalCode: `SAVED-OTHER-${randomUUID()}`, ownerId: f.owner.id } }); matters.push(other.id);
    async function copy(patch: { familyId?: string; version?: number; sha256?: string | null } = {}) {
      return db.document.create({ data: { matterId: f.matter.id, uploadedById: f.owner.id, name: f.document.name, tags: ["类案", "元典"],
        path: f.document.path, mimeType: "text/markdown", sha256: f.document.sha256, encrypted: false, ...patch } });
    }
    const noAudit = await copy(), wrongMatter = await copy(), noIdentity = await copy({ sha256: null });
    const newer = await copy({ familyId: f.document.familyId ?? f.document.id, version: 2 });
    await db.document.update({ where: { id: f.document.id }, data: { isLatest: false } });
    await db.auditLog.createMany({ data: [
      { action: "YUANDIAN_CASE_SAVE", targetType: "Matter", targetId: other.id, detail: { documentId: wrongMatter.id } },
      { action: "YUANDIAN_CASE_SAVE", targetType: "Matter", targetId: f.matter.id, detail: { documentId: noIdentity.id } },
    ] });
    expect((await getResearchOptions(f.matter.id)).savedCaseDocumentIds).toEqual([f.document.id]);
    const read = vi.spyOn(storage, "readFile");
    for (const id of [noAudit.id, wrongMatter.id, noIdentity.id, newer.id]) await expect(getSavedCaseResearchInput(f.matter.id, id)).rejects.toThrow();
    await expect(getSavedCaseResearchInput(other.id, f.document.id)).rejects.toThrow("不属于");
    await withdrawMaterial(f.owner.id, f.document.id, false);
    await expect(getSavedCaseResearchInput(f.matter.id, f.document.id)).rejects.toThrow("来源材料");
    expect(read).not.toHaveBeenCalled();
  });

  it("存储失败不返回部分元信息，也不记录成功读取", async () => {
    const f = await fixture();
    vi.spyOn(storage, "readFile").mockRejectedValueOnce(new Error("synthetic private storage path"));
    await expect(getSavedCaseResearchInput(f.matter.id, f.document.id)).rejects.toThrow("无法读取已保存类案材料");
    expect(await db.auditLog.count({ where: { action: "RESEARCH_SAVED_CASE_READ", targetId: f.document.id } })).toBe(0);
  });

  it.each(["withdraw", "team", "session"] as const)("原件读入期间 %s 生效后，拒绝返回元信息", async kind => {
    const f = await fixture(), reader = kind === "team" ? f.member : f.owner;
    config.requestIdentity = { id: reader.id, sessionVersion: reader.sessionVersion };
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    vi.spyOn(storage, "readFile").mockImplementationOnce(async path => {
      const bytes = await realRead(path); entered.resolve(); await release.promise; return bytes;
    });
    const result = getSavedCaseResearchInput(f.matter.id, f.document.id).then(value => ({ value, error: null }), error => ({ value: null, error }));
    try {
      await Promise.race([entered.promise, result.then(() => { throw new Error("Read ended before the storage barrier"); })]);
      if (kind === "withdraw") await withdrawMaterial(f.owner.id, f.document.id, false);
      else if (kind === "team") {
        config.actionActor = f.actor;
        await updateMatterTeam({ matterId: f.matter.id, expectedOwnerId: f.owner.id,
          expectedMembers: [{ userId: f.owner.id, role: "LEAD" }, { userId: f.member.id, role: "CO_LEAD" }], coLeadIds: [], assistantIds: [] });
      } else {
        config.actionActor = await actorFor(f.admin);
        await resetUserPassword({ id: f.owner.id, newPassword: randomUUID() });
        expect((await db.user.findUniqueOrThrow({ where: { id: f.owner.id } })).active).toBe(true);
      }
      release.resolve();
      const settled = await result;
      expect(settled.value).toBeNull(); expect(settled.error).toBeInstanceOf(Error);
      expect(String(settled.error)).not.toContain("合成旧案标题");
      expect(await db.auditLog.count({ where: { action: "RESEARCH_SAVED_CASE_READ", targetId: f.document.id } })).toBe(0);
    } finally { release.resolve(); await result; }
  });

  it("实际会话复验后、最终授权锁前提升sessionVersion仍拒绝，不能用旧会话配新版本", async () => {
    const f = await fixture();
    vi.mocked(getSession).mockImplementationOnce(realSession).mockImplementationOnce(async () => {
      const session = await realSession();
      config.actionActor = await actorFor(f.admin);
      await resetUserPassword({ id: f.owner.id, newPassword: randomUUID() });
      return session;
    });
    await expect(getSavedCaseResearchInput(f.matter.id, f.document.id)).rejects.toThrow("登录状态已变化");
    expect(await db.auditLog.count({ where: { action: "RESEARCH_SAVED_CASE_READ", targetId: f.document.id } })).toBe(0);
  });
});
