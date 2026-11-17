// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { Document as Docx, Packer, Paragraph } from "docx";
import PizZip from "pizzip";
import { Prisma, type User } from "@prisma/client";
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
  requireWorkspaceConfiguration: vi.fn(async () => {
    if (config.actor?.systemRole !== "SUPER_ADMIN") throw new Error("Synthetic configuration admin required");
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
import { submitDocumentForReview, uploadDocument } from "@/server/documents/actions";
import { prepareDeliveryForActor } from "@/server/deliveries/service";
import { updateMatterTeam } from "@/server/matters/actions";
import { setUserActive } from "@/server/users/actions";
import { createTask, toggleTaskCompleted } from "@/server/tasks/actions";
import { addProcedure, updateProcedure } from "@/server/procedures/actions";
import { closeMatter } from "@/server/matters/lifecycle";
import { saveClosure } from "@/server/archive/closure-actions";
import { assertClosureReady } from "@/server/archive/closure";
import { saveArchivePolicy } from "@/server/archive/policy";
import { archiveMatter, approveArchiveRecord, getArchivePrepData } from "@/server/archive/actions";
import { buildArchiveZip, type buildArchiveManifest } from "@/server/archive/export";
import { parseArchiveSnapshot, requiredArchiveVerificationIds } from "@/lib/archive/snapshot";
import { BUILTIN_TEMPLATES } from "@/lib/template-builder";
import type { ArchiveSubmitInput } from "@/server/archive/schemas";

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
const clients: string[] = [], templates: string[] = [], previouslyEnabledTemplates: string[] = [];
let previousPolicy: { value: Prisma.JsonValue } | null = null;
let policyCaptured = false;
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
    const parseRuns = await db.documentParseRun.findMany({ where: { requestedById: { in: users } }, select: { id: true } });
    await db.jobQueue.updateMany({ where: { dedupeKey: { in: parseRuns.map(run => `document.parse:${run.id}`) }, status: { not: "SUCCESS" } },
      data: { status: "DEAD", leaseToken: null, leaseUntil: null, lastError: "合成 HTTP 验收已结束，未启动解析 worker" } });
    await db.documentTemplate.updateMany({ where: { id: { in: templates } }, data: { enabled: false } });
    await db.documentTemplate.updateMany({ where: { id: { in: previouslyEnabledTemplates } }, data: { enabled: true } });
    if (policyCaptured) {
      if (!previousPolicy) await db.systemSetting.deleteMany({ where: { key: "archivePolicy" } });
      else await db.systemSetting.upsert({ where: { key: "archivePolicy" },
        create: { key: "archivePolicy", value: previousPolicy.value === null ? Prisma.JsonNull : previousPolicy.value },
        update: { value: previousPolicy.value === null ? Prisma.JsonNull : previousPolicy.value } });
    }
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
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

  it("七必交齐全，经真实结案、收尾及独立普通批准后，以真实登录HTTP导出指定归档及固定原件", async () => {
    const owner = await makeUser("合成普通归档经办人"), admin = await makeUser("合成普通归档配置人", "LAWYER", undefined, true);
    const roleName = `http-archive-reviewer-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name: roleName, normalizedName: roleName } }); roles.push(role.id);
    const reviewer = await makeUser("合成普通归档独立审批人", "CUSTOM", role.id);
    const group = await db.approvalPermissionGroup.create({ data: { name: `合成普通归档资格-${randomUUID()}`,
      members: { create: { userId: reviewer.user.id } }, rules: { create: { action: "ARCHIVE_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } }); groups.push(group.id);
    const client = await db.client.create({ data: { name: "合成普通卷宗客户", type: "ORGANIZATION", ownerUserId: owner.user.id, tags: ["工程验收"] } }); clients.push(client.id);
    const matter = await db.matter.create({ data: { title: "合成普通完整卷宗验收事项", internalCode: `M3-HTTP-ARCHIVE-${randomUUID()}`,
      category: "CIVIL_COMMERCIAL", ownerId: owner.user.id, primaryClientId: client.id, serviceScope: "隔离工程验收，不代表真实委托或专业结论" } }); matters.push(matter.id);

    // Configuration belongs only to this case. Remember exact prior settings even
    // if a later fixture operation fails; never replace originals used by history.
    config.actor = admin.actor;
    previousPolicy = await db.systemSetting.findUnique({ where: { key: "archivePolicy" }, select: { value: true } });
    policyCaptured = true;
    const policyBytes = Buffer.from("合成普通归档制度：逐项核对七类必交实际材料、四项核验和独立批准；没有必交缺项，不使用例外核准。仅工程验收，不是律所正式制度。", "utf8");
    const policyPath = await storage.writeFile("m3_http_archive_policy", policyBytes);
    const policy = await db.firmFile.create({ data: { name: "合成普通归档制度.txt", path: policyPath, category: "POLICY", mimeType: "text/plain",
      size: policyBytes.length, sha256: sha256(policyBytes), uploadedById: admin.user.id, tags: ["工程验收"] } });
    await saveArchivePolicy({ name: "合成普通归档制度", version: "synthetic-complete-1", effectiveAt: "2026-01-01", sourceFileId: policy.id });
    const builtins = BUILTIN_TEMPLATES.filter(row => ["archive_cover", "archive_catalog"].includes(row.key));
    previouslyEnabledTemplates.push(...(await db.documentTemplate.findMany({ where: { name: { in: builtins.map(row => row.name) }, isBuiltIn: true, enabled: true }, select: { id: true } })).map(row => row.id));
    await db.documentTemplate.updateMany({ where: { id: { in: previouslyEnabledTemplates } }, data: { enabled: false } });
    for (const builtin of builtins) {
      const bytes = await builtin.buildBuffer(), path = await storage.writeFile("m3_http_archive_template", bytes);
      const blob = await db.document.create({ data: { name: `${builtin.name}.docx`, path, category: "OTHER", uploadedById: admin.user.id,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: bytes.length, sha256: sha256(bytes), tags: ["合成内置模板"] } });
      const template = await db.documentTemplate.create({ data: { name: builtin.name, category: builtin.category, description: builtin.description,
        applicableCategories: builtin.applicableCategories, docxBlobId: blob.id, variables: builtin.variables, isBuiltIn: true, enabled: true, createdById: admin.user.id } });
      templates.push(template.id);
    }

    const materialSpecs = [
      { itemId: "retainer_contract", name: "合成委托代理合同.docx", category: "CONTRACT", zipPath: "合同/001_合成委托代理合同.docx",
        content: "合成委托人委托合成经办人处理本工程事项的材料整理、结案和归档；本场景没有实际收费、签署或对外委托。服务边界仅限隔离验收。" },
      { itemId: "power_of_attorney", name: "合成授权委托书.docx", category: "PROCEDURE", zipPath: "程序文书/001_合成授权委托书.docx",
        content: "合成授权范围为本工程事项材料核对和归档流转，不含真实承认、放弃或变更诉讼请求；无真实签名，不作为对外代理凭证。" },
      { itemId: "pleading", name: "合成起诉状.docx", category: "PLEADING", zipPath: "诉讼文书/001_合成起诉状.docx",
        content: "合成请求为核对演示成果是否完成交接；事实包括一份合成成果交接记录及其目录。此文书只验证诉讼材料类型及字节留存，不提交真实机关。" },
      { itemId: "evidence_catalog", name: "合成证据目录.docx", category: "EVIDENCE", zipPath: "证据/001_合成证据目录.docx",
        content: "证据一：合成成果交接记录.docx。拟证明事项：演示成果在本合成场景中完成一次交接。来源为本次工程生成，独立原件随目录入卷；真实性与证明力未由专业人员确认。" },
      { itemId: "evidence_catalog", name: "合成成果交接记录.docx", category: "EVIDENCE", zipPath: "证据/002_合成成果交接记录.docx",
        content: "合成成果编号 SYNTHETIC-DELIVERY-001，交接对象为演示数据一份；记录字段包含交出、接收和核对范围。无真实客户或外部送达，仅用于与证据目录核对。" },
      { itemId: "judgment", name: "合成裁判文书.docx", category: "JUDGMENT", zipPath: "裁判文书/001_合成裁判文书.docx",
        content: "合成裁判结果占位：本演示程序已结束，结果仅用于验证裁判类文件入卷。未伪造法院、裁判效力或真实送达，材料来源记为自行收集的工程合成文件。" },
      { itemId: "closing_form", name: "合成结案登记表.docx", category: "OTHER", zipPath: "其他/001_合成结案登记表.docx",
        content: "本工程事项的任务和受托程序通过原业务操作结束；无保全、未承接交接或财务事项。结案理由为合成流程完成，实际完成时点由服务记录。" },
      { itemId: "case_summary", name: "合成办案小结.docx", category: "OTHER", zipPath: "其他/002_合成办案小结.docx",
        content: "本次依次准备委托、授权、诉讼、证据、裁判和结案材料，核对八份原件及逐项归档关系；独立审批只为工程验证，浏览器体验和法律专业内容仍待真人验收。" },
    ] as const;
    const materials: { id: string; itemId: string; name: string; zipPath: string; bytes: Buffer; version: number; hash: string; workflowStatus: string }[] = [];
    config.actor = owner.actor;
    for (const spec of materialSpecs) {
      const bytes = await Packer.toBuffer(new Docx({ sections: [{ children: [new Paragraph(spec.name), new Paragraph(matter.internalCode!),
        new Paragraph("工程合成材料，不含真实客户数据，不代表律师专业认可。"), new Paragraph(spec.content)] }] }));
      const form = new FormData();
      form.set("file", new File([new Uint8Array(bytes)], spec.name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      form.set("name", spec.name); form.set("matterId", matter.id); form.set("category", spec.category);
      form.set("sourceOrigin", "SELF_COLLECTED"); form.set("archiveChecklistItemId", spec.itemId);
      form.set("encrypted", "true"); form.set("requestKey", randomUUID());
      const uploaded = await uploadDocument(form);
      expect(uploaded.ok).toBe(true);
      if (!uploaded.ok) throw new Error(uploaded.message);
      const document = await db.document.findUniqueOrThrow({ where: { id: uploaded.id } });
      expect(document).toMatchObject({ matterId: matter.id, name: spec.name, version: 1, sha256: sha256(bytes), encrypted: true,
        archiveChecklistItemId: spec.itemId, sourceOrigin: "SELF_COLLECTED", status: "DRAFT" });
      expect((await storage.readFile(document.path)).equals(bytes)).toBe(false);
      materials.push({ id: document.id, itemId: spec.itemId, name: spec.name, zipPath: spec.zipPath, bytes,
        version: document.version, hash: document.sha256!, workflowStatus: document.status });
    }
    expect(new Set(materials.map(row => row.hash)).size).toBe(8);
    const task = await createTask({ matterId: matter.id, title: "合成卷宗核对工作", priority: 0, requestKey: randomUUID() });
    await toggleTaskCompleted(task.id);
    expect(await db.workResponsibility.findUnique({ where: { taskId: task.id } })).toMatchObject({ state: "DONE", assigneeId: owner.user.id });
    const procedure = await addProcedure({ matterId: matter.id, type: "FIRST_INSTANCE", engagement: "ENGAGED", isExternalLead: false, leadLawyerId: owner.user.id });
    const currentProcedure = await db.matterProcedure.findUniqueOrThrow({ where: { id: procedure.id } });
    await updateProcedure({ id: procedure.id, expectedUpdatedAt: currentProcedure.updatedAt, status: "CONCLUDED", concludedAt: new Date(),
      outcomeNote: "合成程序操作已结束，不表示真实裁判结果" });
    const summary = "合成普通卷宗：七必交由八份独立实际文件组成，任务及受托程序已办理结束，无真实财务对象；专业复核待真人。";
    await closeMatter({ id: matter.id, summary });
    expect((await db.matter.findUniqueOrThrow({ where: { id: matter.id } })).status).toBe("CLOSED");
    expect(await db.timelineEvent.findFirst({ where: { matterId: matter.id, eventType: "MATTER_CLOSED" } })).toMatchObject({ content: summary });
    await saveClosure({ matterId: matter.id, revision: null, financeOwnerId: null, serviceCompletedAt: new Date(),
      reason: "本合成服务已结束，责任与程序已处置；不存在收费、票据或代收代付对象，不声称结清真实账款" });
    expect(await assertClosureReady(db, matter.id)).not.toBeNull();

    const prep = await getArchivePrepData(matter.id);
    expect(prep.existingSummary).toBe(summary);
    expect(prep.policy).toMatchObject({ configured: true, version: "synthetic-complete-1", sourceFileId: policy.id, sourceFileSha256: sha256(policyBytes) });
    const requiredIds = ["retainer_contract", "power_of_attorney", "pleading", "evidence_catalog", "judgment", "closing_form", "case_summary"];
    expect(prep.checklist.items.filter(item => item.required && !item.autoGenerated).map(item => item.id)).toEqual(requiredIds);
    const checklistItems: ArchiveSubmitInput["checklistItems"] = {};
    for (const id of requiredIds) {
      const selected = materials.filter(row => row.itemId === id);
      expect(prep.docsByItem[id]?.map(row => row.id)).toEqual(selected.map(row => row.id));
      checklistItems[id] = { status: "ATTACHED", documentIds: selected.map(row => row.id), note: "本项实际工程合成原件，不以分析稿改名代替" };
    }
    const optionalReasons = { risk_disclosure: "本场景无真实委托风险告知环节", intake_form: "工程事项直接建立，不存在真实收案申请",
      hearing_record: "合成程序未发生开庭、谈话或阅卷", agent_opinion: "合成程序未形成对外代理词或律师函", fee_receipt: "本场景无收付款对象，未生成收费凭证" };
    for (const [id, note] of Object.entries(optionalReasons)) checklistItems[id] = { status: "NOT_APPLICABLE", documentIds: [], note };
    const submitted = await archiveMatter({ matterId: matter.id, summary, closedReason: "OTHER", completedAt: new Date(), checklistItems, forceWithMissing: false,
      manualChecks: {
        archive_scope: { confirmed: true, note: "核对本工程事项八份材料与真实记录的程序终点，不表示真实案件范围获专业确认" },
        originals_handled: { confirmed: true, note: "八份工程输入原件以加密本地存储保留；无纸质原件退还或对外交接" },
        fees_handled: { confirmed: true, note: "已核本合成事项财务集合为空，没有实际账款需结清" },
        catalog_pagination: { confirmed: true, note: "按七项清单核八份文件顺序；目录页码栏保留空白，未宣称已编印刷页码" },
      } });
    expect(submitted).toMatchObject({ ok: true, status: "PENDING_REVIEW" });
    const archive = await db.archiveRecord.findFirstOrThrow({ where: { matterId: matter.id, archiveNo: submitted.archiveNo } });
    expect(archive).toMatchObject({ status: "PENDING_REVIEW", missingItems: [], reviewedById: null, reviewedAt: null, frozenManifest: null });
    expect(archive.coverDocId).not.toBeNull(); expect(archive.catalogDocId).not.toBeNull();
    expect((await db.matter.findUniqueOrThrow({ where: { id: matter.id } })).status).toBe("CLOSED");
    const snapshot = parseArchiveSnapshot(archive.checklistJson)!;
    expect(snapshot).not.toBeNull(); expect(snapshot.excludedDocuments).toEqual([]);
    expect(snapshot.documentIds).toEqual([...materials.map(row => row.id), archive.coverDocId, archive.catalogDocId]);
    expect(snapshot.documents).toHaveLength(10);
    const verificationIds = requiredArchiveVerificationIds(snapshot);
    config.actor = reviewer.actor;
    expect(reviewer.user.id).not.toBe(owner.user.id);
    await approveArchiveRecord({ archiveId: archive.id, verificationIds, exceptionApproved: false,
      note: "独立合成审批人逐项核对材料和制度，本普通包无必交缺项；仅证明工程链，不是律师专业验收" });
    const approved = await db.archiveRecord.findUniqueOrThrow({ where: { id: archive.id } });
    expect(approved).toMatchObject({ status: "APPROVED", reviewedById: reviewer.user.id, missingItems: [] });
    expect(approved.frozenManifest).not.toBeNull();
    expect((await db.matter.findUniqueOrThrow({ where: { id: matter.id } })).status).toBe("ARCHIVED");
    const approvals = await db.auditLog.findMany({ where: { action: "ARCHIVE_APPROVE", targetId: archive.id } });
    expect(approvals).toEqual(expect.arrayContaining([expect.objectContaining({ userId: reviewer.user.id,
      detail: expect.objectContaining({ verificationIds, exceptionApproved: false, policyFileId: policy.id, policyVersion: "synthetic-complete-1" }) })]));

    const frozen = approved.frozenManifest as unknown as Awaited<ReturnType<typeof buildArchiveManifest>>;
    function assertArchiveContents(bytes: Buffer) {
      const zip = new PizZip(bytes), root = archive.archiveNo;
      expect(JSON.parse(zip.file(`${root}/manifest.json`)!.asText())).toEqual(frozen);
      expect(frozen.matter).toMatchObject({ id: matter.id, status: "ARCHIVED", internalCode: matter.internalCode });
      expect(frozen.documents.map(row => row.id)).toEqual(snapshot.documentIds);
      materials.forEach((material, index) => {
        expect(frozen.documents[index]).toMatchObject({ id: material.id, version: material.version, sha256: material.hash,
          workflowStatus: material.workflowStatus, order: index + 1, checklistItemIds: [material.itemId] });
        expect(zip.file(`${root}/材料/${material.zipPath}`)?.asNodeBuffer().equals(material.bytes)).toBe(true);
      });
      const cover = zip.file(`${root}/封皮和目录/卷宗封皮.docx`)!.asNodeBuffer();
      const catalog = zip.file(`${root}/封皮和目录/卷宗目录.docx`)!.asNodeBuffer();
      for (const [id, bytes] of [[archive.coverDocId, cover], [archive.catalogDocId, catalog]] as const) {
        expect(frozen.documents.find(row => row.id === id)?.sha256).toBe(sha256(bytes));
        const xml = new PizZip(bytes).file("word/document.xml")!.asText();
        expect(xml).toContain(root); expect(xml).toContain(matter.title); expect(xml).toContain(matter.internalCode!);
      }
      const catalogXml = new PizZip(catalog).file("word/document.xml")!.asText();
      materials.forEach(material => expect(catalogXml).toContain(material.name));
      expect(Object.values(zip.files).filter(file => !file.dir)).toHaveLength(12);
    }
    config.actor = owner.actor;
    const built = await buildArchiveZip(archive.id, owner.actor);
    assertArchiveContents(built.buffer);
    expect(await db.auditLog.count({ where: { action: "ARCHIVE_EXPORT", targetId: archive.id } })).toBe(0);

    const ownerHttp = httpClient(new URL(config.origin!).origin);
    await ownerHttp.login(owner.user.email, owner.password);
    const response = await ownerHttp.request(`/api/archive/${matter.id}/export?archiveId=${archive.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(`${archive.archiveNo}.zip`)}`);
    const received = Buffer.from(await response.arrayBuffer());
    // Next's Node sendResponse filters handler framing headers. The received
    // ZIP and its audit byte count/hash prove completeness even without a length header.
    const contentLength = response.headers.get("content-length"), contentEncoding = response.headers.get("content-encoding");
    expect(received.length).toBeGreaterThan(0);
    if (contentLength !== null && (!contentEncoding || contentEncoding === "identity")) expect(contentLength).toBe(String(received.length));
    assertArchiveContents(received); // Compare again to fixed inputs/snapshot, not just the prior service ZIP.
    const exports = await db.auditLog.findMany({ where: { action: "ARCHIVE_EXPORT", targetId: archive.id } });
    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatchObject({ userId: owner.user.id, targetType: "ArchiveRecord", targetId: archive.id,
      detail: { matterId: matter.id, archiveNo: archive.archiveNo, size: received.length, checksum: sha256(received) } });
    const nonexistent = await ownerHttp.request(`/api/archive/${matter.id}/export?archiveId=nonexistent-${randomUUID()}`);
    expect(nonexistent.status).toBe(404); await nonexistent.arrayBuffer();
    expect(await db.auditLog.count({ where: { action: "ARCHIVE_EXPORT", targetId: archive.id } })).toBe(1);
    console.info("M3 ordinary archive HTTP", JSON.stringify({ success: response.status, exactMissingRecord: nonexistent.status,
      requiredManualItems: requiredIds.length, originalDocuments: materials.length, frozenDocuments: frozen.documents.length, exceptionApproved: false,
      receivedBytes: received.length, contentLength, contentEncoding, transferEncoding: response.headers.get("transfer-encoding") }));
  }, 240_000);
});
