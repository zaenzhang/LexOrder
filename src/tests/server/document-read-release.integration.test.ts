// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Document as Docx, Packer, Paragraph } from "docx";
import type { User } from "@prisma/client";
import type { WorkspaceActor } from "@/lib/runtime/actor";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && (!new URL(url).pathname.endsWith("_test") || !process.env.APP_STORAGE_DIR || process.env.STORAGE_PROVIDER === "s3")) {
    throw new Error("进行中读取验证仅允许隔离 _test 数据库和显式本地存储目录");
  }
  return { url, actionActor: null as WorkspaceActor | null, requestIdentity: null as { id: string; sessionVersion: number } | null };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/document_release_test") };
});
// This is a route/service race test, not HTTP or credentials acceptance. The
// request's session boundary is explicit; users/permissions/revocations and
// encrypted local storage are real. m3-http-contracts covers actual NextAuth.
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => {
    if (!config.requestIdentity) return null;
    const { prisma } = await import("@/lib/prisma");
    const { resolveRoleUser } = await import("@/lib/roles/service");
    const user = await prisma.user.findUnique({ where: { id: config.requestIdentity.id } });
    if (!user?.active || user.sessionVersion !== config.requestIdentity.sessionVersion) return null;
    const role = await resolveRoleUser(user.id, user.role);
    if (!role.enabled) return null;
    return { user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
      ...role, runtimeMode: "SERVER" } };
  }),
  requireSession: vi.fn(async () => { if (!config.actionActor) throw new Error("Missing synthetic action actor"); return { user: config.actionActor }; }),
  requireSystemAdmin: vi.fn(async () => {
    if (config.actionActor?.systemRole !== "SUPER_ADMIN") throw new Error("Synthetic administrator required");
    return { user: config.actionActor };
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { storage } from "@/lib/storage";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { resolveRoleUser } from "@/lib/roles/service";
import { ingestMaterial, withdrawMaterial } from "@/server/documents/material-ingest";
import { submitDocumentForReview } from "@/server/documents/actions";
import { saveResearch } from "@/server/research/service";
import { emptyResearchContent, emptyLawMetadata } from "@/server/research/contracts";
import { createResearchDraft } from "@/server/research/draft";
import { updateMatterTeam } from "@/server/matters/actions";
import { resetUserPassword } from "@/server/users/actions";
import { GET as download } from "@/app/api/documents/[id]/download/route";
import { GET as preview } from "@/app/api/documents/[id]/preview/route";

const users: string[] = [], matters: string[] = [], roles: string[] = [], groups: string[] = [];
const realRead = storage.readFile.bind(storage);
async function actorFor(user: User): Promise<WorkspaceActor> {
  return { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
    ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" };
}
async function fixture() {
  const owner = await db.user.create({ data: { name: "合成读取经办人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-service-fixture", role: "LAWYER" } }); users.push(owner.id);
  const member = await db.user.create({ data: { name: "合成读取协办人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-service-fixture", role: "LAWYER" } }); users.push(member.id);
  const admin = await db.user.create({ data: { name: "合成读取管理员", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-service-fixture", role: "LAWYER", systemRole: "SUPER_ADMIN" } }); users.push(admin.id);
  const matter = await db.matter.create({ data: { title: "合成处理中撤权", internalCode: `READ-RELEASE-${randomUUID()}`, ownerId: owner.id,
    members: { create: [{ userId: owner.id, role: "LEAD" }, { userId: member.id, role: "CO_LEAD" }] } } }); matters.push(matter.id);
  const marker = `合成受控原件-${randomUUID()}`;
  const bytes = await Packer.toBuffer(new Docx({ sections: [{ children: [new Paragraph(marker)] }] }));
  const encrypted = encryptBuffer(bytes);
  const ingested = await ingestMaterial({ userId: owner.id, requestKey: randomUUID(), bytes: encrypted.ciphertext,
    document: { matterId: matter.id, name: "合成受控原件.docx", category: "OTHER", sourceOrigin: "CLIENT_PROVIDED",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: bytes.length, sha256: sha256(bytes),
      encrypted: true, algorithm: encrypted.algorithm, iv: encrypted.iv.toString("base64"), authTag: encrypted.authTag.toString("base64"), uploadedById: owner.id } });
  const source = await db.document.findUniqueOrThrow({ where: { id: ingested.id } });
  const ownerActor = await actorFor(owner);
  config.actionActor = ownerActor;
  return { owner, member, admin, ownerActor, matter, source, bytes, marker };
}
async function submittedResearch(f: Awaited<ReturnType<typeof fixture>>) {
  const roleName = `release-reviewer-${randomUUID()}`;
  const role = await db.roleDefinition.create({ data: { name: roleName, normalizedName: roleName } }); roles.push(role.id);
  const reviewer = await db.user.create({ data: { name: "合成只读审批人", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-service-fixture", role: "CUSTOM", roleDefinitionId: role.id } }); users.push(reviewer.id);
  const group = await db.approvalPermissionGroup.create({ data: { name: `合成审批-${randomUUID()}`, members: { create: { userId: reviewer.id } },
    rules: { create: { action: "DOCUMENT_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } }); groups.push(group.id);
  const research = await saveResearch(db, f.ownerActor, { ...emptyResearchContent(), matterId: f.matter.id, requestKey: randomUUID(), supersedesId: null,
    expectedVersion: null, question: "合成独立审批正文", purpose: "处理期间授权验证", scope: "仅合成来源",
    sources: [{ documentId: f.source.id, relation: "CONTEXT", lawMetadata: emptyLawMetadata() }] });
  const generated = await createResearchDraft(db, f.ownerActor, { matterId: f.matter.id, researchRevisionId: research.id, requestKey: randomUUID() });
  await submitDocumentForReview(generated.documentId);
  const document = await db.document.findUniqueOrThrow({ where: { id: generated.documentId } });
  expect(document.status).toBe("PENDING_REVIEW");
  return { reviewer, document };
}

const routes = [{ name: "download", handler: download, audit: "DOCUMENT_DOWNLOAD" }, { name: "preview", handler: preview, audit: "DOCUMENT_PREVIEW" }] as const;
function runRoute(route: typeof routes[number], documentId: string) {
  return route.handler(new Request(`http://localhost/api/documents/${documentId}/${route.name}`), { params: Promise.resolve({ id: documentId }) });
}

describe.skipIf(!config.url)("材料处理结束时的当前授权 / 真实 PostgreSQL 与加密原件，非 HTTP 会话证据", () => {
  beforeAll(async () => { await db.$connect(); });
  afterEach(() => { vi.restoreAllMocks(); config.requestIdentity = null; config.actionActor = null; });
  afterAll(async () => {
    if (!config.url) return;
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groups } }, data: { active: false } });
    await db.$disconnect();
  });

  it.each(routes)("$name 仍允许具体文书审批附件，并严格记录实际读取", async route => {
    const f = await fixture(), review = await submittedResearch(f);
    config.requestIdentity = { id: review.reviewer.id, sessionVersion: review.reviewer.sessionVersion };
    const sourceResponse = await runRoute(route, f.source.id);
    expect(sourceResponse.status).toBe(403);
    const response = await runRoute(route, review.document.id);
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(await db.auditLog.count({ where: { targetId: review.document.id, action: route.audit, userId: review.reviewer.id } })).toBe(1);
  });

  describe.each(routes)("$name 的读取屏障", route => {
    it.each(["withdraw", "team", "session", "source"] as const)("原件已经读入后 %s 生效时不返回正文、不写成功读取审计", async kind => {
      const f = await fixture();
      let target = f.source, reader = kind === "team" ? f.member : f.owner;
      if (kind === "source") {
        const review = await submittedResearch(f); target = review.document; reader = review.reviewer;
      }
      config.requestIdentity = { id: reader.id, sessionVersion: reader.sessionVersion };
      const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      let readBlocked = false;
      vi.spyOn(storage, "readFile").mockImplementation(async path => {
        const bytes = await realRead(path);
        if (path === target.path && !readBlocked) { readBlocked = true; entered.resolve(); await release.promise; }
        return bytes;
      });
      vi.mocked(getSession).mockClear();
      const pending = runRoute(route, target.id);
      try {
        await Promise.race([entered.promise, pending.then(() => { throw new Error("Route finished without reaching the real storage barrier"); })]);
        if (kind === "withdraw" || kind === "source") await withdrawMaterial(f.owner.id, f.source.id, false);
        else if (kind === "team") await updateMatterTeam({ matterId: f.matter.id, expectedOwnerId: f.owner.id,
          expectedMembers: [{ userId: f.owner.id, role: "LEAD" }, { userId: f.member.id, role: "CO_LEAD" }], coLeadIds: [], assistantIds: [] });
        else {
          config.actionActor = await actorFor(f.admin);
          await resetUserPassword({ id: f.owner.id, newPassword: randomUUID() });
          expect((await db.user.findUniqueOrThrow({ where: { id: f.owner.id } })).active).toBe(true);
        }
        release.resolve();
        const response = await pending;
        expect(response.status).toBe(kind === "session" ? 401 : 403);
        expect(response.headers.get("content-type")).toContain("application/json");
        const body = await response.text();
        expect(body).not.toContain(f.marker); expect(body).not.toContain("合成独立审批正文");
        expect(vi.mocked(getSession).mock.calls.length).toBe(2);
        expect(await db.auditLog.count({ where: { targetId: target.id, action: route.audit, userId: reader.id } })).toBe(0);
      } finally { release.resolve(); await pending.catch(() => undefined); }
    });
  });
});
