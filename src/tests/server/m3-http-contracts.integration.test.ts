// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { Document as Docx, Packer, Paragraph } from "docx";
import PizZip from "pizzip";
import type { User } from "@prisma/client";
import type { WorkspaceActor } from "@/lib/runtime/actor";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  const origin = process.env.LEXORDER_HTTP_BASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("HTTP 验证仅允许隔离 _test 数据库");
  if (origin && (!url || process.env.DATABASE_URL !== url || !process.env.APP_STORAGE_DIR
    || process.env.STORAGE_PROVIDER === "s3" || process.env.LEXORDER_RUNTIME_MODE !== "SERVER")) {
    throw new Error("HTTP 验证需显式的同库 Server/local storage 环境");
  }
  if (origin && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)) throw new Error("HTTP 验证只能连接隔离 loopback 实例");
  return { url, origin, actor: null as WorkspaceActor | null };
});
// These two replacements apply ONLY to the fixture-building Vitest process.
// Next must be an independently running process with real auth, Prisma and storage.
// No JWT, cookie or authenticated HTTP request is fabricated.
vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async () => { if (!config.actor) throw new Error("Missing synthetic fixture actor"); return { user: config.actor }; }),
  getSession: vi.fn(async () => config.actor ? { user: config.actor } : null),
  requireSystemAdmin: vi.fn(async () => {
    if (config.actor?.systemRole !== "SUPER_ADMIN") throw new Error("Synthetic admin fixture required");
    return { user: config.actor };
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { resolveRoleUser } from "@/lib/roles/service";
import { ingestMaterial, withdrawMaterial } from "@/server/documents/material-ingest";
import { createEvidenceItem, confirmEvidenceItem } from "@/server/evidence/actions";
import { saveResearch, readResearchOptions } from "@/server/research/service";
import { emptyResearchContent, emptyLawMetadata } from "@/server/research/contracts";
import { createResearchDraft } from "@/server/research/draft";
import { submitDocumentForReview } from "@/server/documents/actions";
import { prepareDeliveryForActor } from "@/server/deliveries/service";
import { updateMatterTeam } from "@/server/matters/actions";
import { setUserActive } from "@/server/users/actions";

function httpClient(origin: string) {
  const cookies = new Map<string, string>();
  async function request(path: string, init: RequestInit = {}) {
    const url = new URL(path, origin);
    if (url.origin !== new URL(origin).origin) throw new Error("HTTP verifier cannot leave the isolated origin");
    const headers = new Headers(init.headers);
    if (headers.has("cookie") || headers.has("authorization")) throw new Error("Use real credentials authentication");
    if (cookies.size) headers.set("cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0], split = pair.indexOf("=");
      if (split < 1) continue;
      const key = pair.slice(0, split), value = pair.slice(split + 1);
      if (!value || /;\s*max-age=0(?:;|$)/i.test(header)) cookies.delete(key); else cookies.set(key, value);
    }
    return response;
  }
  async function csrf() {
    const response = await request("/api/auth/csrf");
    expect(response.status).toBe(200);
    const result = await response.json();
    if (typeof result.csrfToken !== "string") throw new Error("NextAuth did not issue CSRF token");
    return result.csrfToken as string;
  }
  async function login(email: string, password: string) {
    const response = await request("/api/auth/callback/credentials", { method: "POST",
      headers: { Origin: new URL(origin).origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken: await csrf(), email, password, callbackUrl: `${origin}/`, json: "true" }) });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    const session = await request("/api/auth/session");
    expect(session.status).toBe(200);
    expect((await session.json()).user?.email).toBe(email);
  }
  return { request, login, csrf };
}

const users: string[] = [], matters: string[] = [], roles: string[] = [], groups: string[] = [];
async function actorFor(user: User): Promise<WorkspaceActor> {
  return { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
    ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" };
}
async function makeUser(name: string, role: "LAWYER" | "CUSTOM" = "LAWYER", roleDefinitionId?: string, admin = false) {
  const password = randomBytes(24).toString("base64url");
  const user = await db.user.create({ data: { name, email: `m3-http-${randomUUID()}@example.invalid`, passwordHash: await bcrypt.hash(password, 10),
    role, roleDefinitionId, systemRole: admin ? "SUPER_ADMIN" : "NONE" } }); users.push(user.id);
  return { user, password, actor: await actorFor(user) };
}

describe.skipIf(!config.url || !config.origin)("M3 HTTP 边界：真实 NextAuth、路由、PostgreSQL 与加密本地原件", () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    if (!config.url || !config.origin) return;
    // Keep immutable audit/history and isolated originals; deactivate only this test's fixtures.
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groups } }, data: { active: false } });
    await db.$disconnect();
  });

  it("真实密码登录后读取原件/预览、固定附件交付、独立审批正文与撤权拒绝；不伪造批准/发送/归档", async () => {
    const origin = new URL(config.origin!).origin;
    const observations: { route: string; status: number; cacheControl: string | null }[] = [];
    const observe = (route: string, response: Response) => {
      const result = { route, status: response.status, cacheControl: response.headers.get("cache-control") };
      observations.push(result);
      console.info("M3 HTTP response", JSON.stringify(result));
    };
    const owner = await makeUser("合成 HTTP 经办人"), member = await makeUser("合成 HTTP 协办人"), admin = await makeUser("合成 HTTP 管理员", "LAWYER", undefined, true);
    const roleName = `http-reviewer-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name: roleName, normalizedName: roleName } }); roles.push(role.id);
    const reviewer = await makeUser("合成 HTTP 独立审批人", "CUSTOM", role.id);
    const group = await db.approvalPermissionGroup.create({ data: { name: `合成 HTTP 审批资格-${randomUUID()}`,
      members: { create: { userId: reviewer.user.id } }, rules: { create: { action: "DOCUMENT_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } }); groups.push(group.id);
    const matter = await db.matter.create({ data: { title: "合成 HTTP 验收事项", internalCode: `M3-HTTP-${randomUUID()}`,
      ownerId: owner.user.id, members: { create: [{ userId: owner.user.id, role: "LEAD" }, { userId: member.user.id, role: "CO_LEAD" }] } } }); matters.push(matter.id);
    const marker = "合成 HTTP 原件：仅验证真实读取，不含客户数据或专业结论。";
    const bytes = await Packer.toBuffer(new Docx({ sections: [{ children: [new Paragraph(marker)] }] }));
    const encrypted = encryptBuffer(bytes);
    const uploaded = await ingestMaterial({ userId: owner.user.id, requestKey: randomUUID(), bytes: encrypted.ciphertext,
      document: { matterId: matter.id, name: "合成 HTTP 原件.docx", category: "OTHER", sourceOrigin: "CLIENT_PROVIDED",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: bytes.length, sha256: sha256(bytes),
        encrypted: true, algorithm: encrypted.algorithm, iv: encrypted.iv.toString("base64"), authTag: encrypted.authTag.toString("base64"), uploadedById: owner.user.id } });
    const document = await db.document.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect((await storage.readFile(document.path)).equals(bytes)).toBe(false);

    // These are genuine service operations with explicit synthetic actors. They do
    // not constitute HTTP coverage of the corresponding Server Actions.
    config.actor = owner.actor;
    const issue = await createEvidenceItem({ matterId: matter.id, requestKey: randomUUID(), kind: "ISSUE", title: "合成 HTTP 争点",
      content: "尚有待核事项", sourceDocumentId: document.id, sourceRelation: "CONTEXT" });
    await confirmEvidenceItem({ evidenceItemId: issue.id, expectedRevision: 1, confirm: true });
    const issueSelection = (await readResearchOptions(db, owner.actor, matter.id)).issues.find(row => row.id === issue.id)!.selection;
    const research = await saveResearch(db, owner.actor, { ...emptyResearchContent(), matterId: matter.id, requestKey: randomUUID(), supersedesId: null,
      expectedVersion: null, issueSelection, question: "合成 HTTP 争点", purpose: "权限边界工程验收", scope: "仅所选合成原件",
      sources: [{ documentId: document.id, relation: "CONTEXT", lawMetadata: emptyLawMetadata() }] });
    const draft = await createResearchDraft(db, owner.actor, { matterId: matter.id, researchRevisionId: research.id, requestKey: randomUUID() });
    await submitDocumentForReview(draft.documentId);
    expect((await db.document.findUniqueOrThrow({ where: { id: draft.documentId } })).status).toBe("PENDING_REVIEW");
    const delivery = await prepareDeliveryForActor(owner.user.id, { matterId: matter.id, requestKey: randomUUID(), documentIds: [document.id],
      recipientName: "合成接收对象", recipientContact: "隔离验收，无外发", purpose: "合成固定附件", disclosureScope: "仅当前附件", unresolvedItems: "工程验证，不代表专业复核" });
    expect(await db.deliveryEvent.count({ where: { deliveryId: delivery.id } })).toBe(0);

    const anonymous = httpClient(origin), ownerHttp = httpClient(origin), memberHttp = httpClient(origin), reviewerHttp = httpClient(origin);
    for (const path of [`/api/documents/${document.id}/download`, `/api/documents/${document.id}/preview`, `/api/archive/${matter.id}/export`, `/api/matters/${matter.id}/export-bundle`]) {
      const response = await anonymous.request(path);
      expect(response.status).toBe(307);
      const target = new URL(response.headers.get("location")!, origin);
      expect(target.origin).toBe(origin); expect(target.pathname).toBe("/login");
      await response.arrayBuffer();
    }
    await ownerHttp.login(owner.user.email, owner.password);
    await memberHttp.login(member.user.email, member.password);
    await reviewerHttp.login(reviewer.user.email, reviewer.password);
    const download = await ownerHttp.request(`/api/documents/${document.id}/download`);
    expect(download.status).toBe(200); expect(Buffer.from(await download.arrayBuffer()).equals(bytes)).toBe(true);
    expect(download.headers.get("cache-control")).toContain("private");
    expect(download.headers.get("cache-control")).toContain("no-store");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff"); observe("authorized-original", download);
    const preview = await ownerHttp.request(`/api/documents/${document.id}/preview`);
    expect(preview.status).toBe(200); expect(await preview.text()).toContain(marker);
    expect(preview.headers.get("content-security-policy")).toContain("sandbox;");
    expect(preview.headers.get("cache-control")).toContain("no-store"); observe("office-preview", preview);
    for (const suffix of ["download", "preview"]) {
      const denied = await reviewerHttp.request(`/api/documents/${document.id}/${suffix}`);
      expect(denied.status).toBe(403); await denied.arrayBuffer();
      const allowed = await reviewerHttp.request(`/api/documents/${draft.documentId}/${suffix}`);
      expect(allowed.status).toBe(200);
      const approvedBody = Buffer.from(await allowed.arrayBuffer());
      if (suffix === "download") expect(new PizZip(approvedBody).file("word/document.xml")?.asText()).toContain("合成 HTTP 争点");
      else expect(approvedBody.toString("utf8")).toContain("合成 HTTP 争点");
    }
    for (const path of [`/api/archive/${matter.id}/export`, `/api/matters/${matter.id}/export-bundle`]) {
      const denied = await reviewerHttp.request(path); expect(denied.status).toBe(403); await denied.arrayBuffer();
    }

    const exportPath = `/api/deliveries/${delivery.id}/export`, exportKey = randomUUID();
    const post = (client: ReturnType<typeof httpClient>, requestOrigin: string, requestKey: string) => client.request(exportPath,
      { method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ requestKey }) });
    const crossOrigin = await post(ownerHttp, "https://untrusted.invalid", exportKey);
    expect(crossOrigin.status).toBe(403); await crossOrigin.arrayBuffer();
    const otherLoopback = new URL(origin); otherLoopback.hostname = otherLoopback.hostname === "localhost" ? "127.0.0.1" : "localhost";
    const loopbackAlias = await post(ownerHttp, otherLoopback.origin, exportKey);
    expect(loopbackAlias.status).toBe(403); await loopbackAlias.arrayBuffer();
    const malformed = await post(ownerHttp, origin, "invalid"); expect(malformed.status).toBe(400); await malformed.arrayBuffer();
    const noDisclosure = await post(reviewerHttp, origin, randomUUID()); expect(noDisclosure.status).toBe(400); await noDisclosure.arrayBuffer();
    const exported = await post(ownerHttp, origin, exportKey); expect(exported.status).toBe(200);
    expect(exported.headers.get("cache-control")).toContain("no-store"); observe("delivery-export", exported);
    const zip = new PizZip(Buffer.from(await exported.arrayBuffer()));
    expect(zip.file("材料/01_合成 HTTP 原件.docx")?.asNodeBuffer().equals(bytes)).toBe(true);
    const eventId = exported.headers.get("x-delivery-event"); expect(eventId).toBeTruthy();
    const repeated = await post(ownerHttp, origin, exportKey); expect(repeated.status).toBe(200);
    expect(repeated.headers.get("x-delivery-event")).toBe(eventId); await repeated.arrayBuffer();
    expect(await db.deliveryEvent.count({ where: { deliveryId: delivery.id, kind: "EXPORTED" } })).toBe(1);
    expect(await db.deliveryEvent.count({ where: { deliveryId: delivery.id, kind: "SENT" } })).toBe(0);
    expect(await db.auditLog.count({ where: { targetId: delivery.id, action: "DELIVERY_EXPORT" } })).toBe(1);

    // Actual team mutation revokes the member, while preserving that same real cookie.
    const memberBefore = await memberHttp.request(`/api/documents/${document.id}/download`);
    expect(memberBefore.status).toBe(200); await memberBefore.arrayBuffer();
    await updateMatterTeam({ matterId: matter.id, expectedOwnerId: owner.user.id,
      expectedMembers: [{ userId: owner.user.id, role: "LEAD" }, { userId: member.user.id, role: "CO_LEAD" }], coLeadIds: [], assistantIds: [] });
    const memberAfter = await memberHttp.request(`/api/documents/${document.id}/download`);
    expect(memberAfter.status).toBe(403); await memberAfter.arrayBuffer();
    const memberDelivery = await post(memberHttp, origin, randomUUID()); expect(memberDelivery.status).toBe(400); await memberDelivery.arrayBuffer();

    // Real source withdrawal blocks both owner and approval-only derived reads.
    await withdrawMaterial(owner.user.id, document.id, false);
    for (const client of [ownerHttp, reviewerHttp]) {
      const revoked = await client.request(`/api/documents/${draft.documentId}/download`);
      expect(revoked.status).toBe(403); await revoked.arrayBuffer();
    }
    const withdrawn = await post(ownerHttp, origin, randomUUID()); expect(withdrawn.status).toBe(400); await withdrawn.arrayBuffer();
    expect(await db.deliveryEvent.count({ where: { deliveryId: delivery.id, kind: "EXPORTED" } })).toBe(1);

    config.actor = admin.actor;
    await setUserActive({ id: owner.user.id, active: false });
    const revokedSession = await ownerHttp.request(`/api/documents/${draft.documentId}/download`);
    expect(revokedSession.status).toBe(401); await revokedSession.arrayBuffer();
    const currentSession = await ownerHttp.request("/api/auth/session"); expect((await currentSession.json()).user).toBeUndefined();
    // Only route status/cache observations leave the process; all bytes and cookies remain local.
    console.info("M3 HTTP response observations", JSON.stringify(observations));
  }, 240_000);
});
