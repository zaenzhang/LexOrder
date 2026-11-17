// @vitest-environment node
// Actual PostgreSQL suggestion decisions, responsibility triggers and file mapping.
// Only authentication transport, storage bytes and reminder dispatch are controlled fixtures.
import { randomUUID } from "node:crypto";
import { Prisma, type SmsSuggestion, type User } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceActor } from "@/lib/runtime/actor";
import type { SmsDecisionInput } from "@/lib/sms/suggestions";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("SMS tests require an isolated _test database");
  return { url, actor: null as WorkspaceActor | null, bytes: new Map<string, Buffer>(), deleted: [] as string[] };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/sms_test") };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: config.actor })), getSession: vi.fn(async () => ({ user: config.actor })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/reminders/schedule", () => ({ refreshScheduleReminderAfterSave: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storage: {
  readFile: vi.fn(async (path: string) => {
    const bytes = config.bytes.get(path);
    if (!bytes) throw Object.assign(new Error("synthetic missing original"), { code: "ENOENT" });
    return bytes;
  }),
  writeFile: vi.fn(async (_prefix: string, bytes: Buffer) => {
    const path = `synthetic-new-${crypto.randomUUID()}`; config.bytes.set(path, bytes); return path;
  }),
  deleteFile: vi.fn(async (path: string) => { config.deleted.push(path); config.bytes.delete(path); }),
} }));

import { prisma as db } from "@/lib/prisma";
import { resolveRoleUser } from "@/lib/roles/service";
import { sha256 } from "@/lib/storage/crypto";
import { storage } from "@/lib/storage";
import { decideSmsSuggestions, retrySmsSuggestionFiling, listSmsEventTargets } from "@/server/sms/confirm-actions";
import { fileSmsInboundFilesToMatter } from "@/server/sms/inbound-filing";
import { uploadSmsInboundFile } from "@/server/sms/actions";

const users: string[] = [], matters: string[] = [], roles: string[] = [];
async function actor(user: User) {
  config.actor = { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
    ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" };
}
async function makeUser(custom = false, principal = false) {
  let roleDefinitionId: string | undefined;
  if (custom) {
    const name = `sms-${randomUUID()}`;
    const definition = await db.roleDefinition.create({ data: { name, normalizedName: name, permissions: { create: ["matters.write", "matters.read", "schedule.read", "schedule.write", "documents.write"].map(permissionKey => ({ permissionKey, scope: "OWN" })) } } });
    roles.push(definition.id); roleDefinitionId = definition.id;
  }
  const user = await db.user.create({ data: { name: "合成来件经办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: principal ? "PRINCIPAL_LAWYER" : custom ? "CUSTOM" : "LAWYER", roleDefinitionId } });
  users.push(user.id); return user;
}
async function fixture(custom = false) {
  const user = await makeUser(custom); await actor(user);
  const matter = await db.matter.create({ data: { title: "合成来件案件", internalCode: `SMS-${randomUUID()}`, ownerId: user.id, status: "IN_PROGRESS" } }); matters.push(matter.id);
  const first = await db.matterProcedure.create({ data: { matterId: matter.id, type: "FIRST_INSTANCE", engagement: "ENGAGED", order: 0, caseNumber: `合成一审-${randomUUID()}` } });
  const second = await db.matterProcedure.create({ data: { matterId: matter.id, type: "SECOND_INSTANCE", engagement: "ENGAGED", order: 1, caseNumber: `合成二审-${randomUUID()}` } });
  const sms = await db.smsMessage.create({ data: { rawText: "合成法院来件", parsedJson: {}, receivedById: user.id, matchedMatterId: matter.id, matchedBy: "MANUAL" } });
  return { user, matter, first, second, sms };
}
async function suggestion(f: Awaited<ReturnType<typeof fixture>>, kind: "HEARING" | "DEADLINE" = "HEARING", dateText = "2027-02-03", timeText: string | null = "09:30") {
  return db.smsSuggestion.create({ data: { smsId: f.sms.id, kind, suggestedValue: `合成${kind} ${dateText}`, createdById: f.user.id,
    payload: { title: `合成${kind}`, dateText, ...(timeText ? { timeText } : {}), procedureId: f.second.id } } });
}
function request(f: Awaited<ReturnType<typeof fixture>>, rows: SmsSuggestion[], decision: "ACCEPTED" | "REJECTED" = "ACCEPTED"): SmsDecisionInput {
  return { smsId: f.sms.id, expectedMatchedMatterId: f.matter.id, decision, items: rows.map(row => {
    const payload = row.payload as { title: string; dateText: string; timeText?: string };
    return { id: row.id, expectedUpdatedAt: row.updatedAt, ...(decision === "ACCEPTED" ? { event: { mode: "CREATE" as const, procedureId: f.second.id, title: payload.title, dateText: payload.dateText, timeText: payload.timeText ?? "" } } : {}) };
  }) };
}
async function sourceFile(f: Awaited<ReturnType<typeof fixture>>, available: boolean) {
  const key = `synthetic-source-${randomUUID()}`, bytes = Buffer.from("Synthetic original source; no client data.");
  if (available) config.bytes.set(key, bytes);
  return db.smsInboundFile.create({ data: { smsId: f.sms.id, sourceUrl: "https://example.invalid/synthetic", storageKey: key, originalName: "合成来件原件.txt", mimeType: "text/plain", size: bytes.length, sha256: sha256(bytes), downloadedById: f.user.id } });
}
async function priorCommit(mutate: (tx: Prisma.TransactionClient) => Promise<unknown>, attempt: () => Promise<unknown>) {
  let release!: () => void, acquired!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const first = db.$transaction(async tx => { await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`; await mutate(tx); acquired(); await gate; }, { timeout: 20000 });
  await ready;
  let settled = false, waited = false;
  const result = attempt().then(value => ({ value, error: null }), error => ({ value: null, error })).finally(() => { settled = true; });
  try {
    for (let index = 0; index < 100 && !settled; index++) {
      const [row] = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM pg_locks WHERE locktype='advisory' AND objid=72606101 AND NOT granted`;
      if (Number(row.count)) { waited = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally { release(); }
  await first; expect(waited).toBe(true); return result;
}

describe.skipIf(!config.url)("来件逐项采纳：真实 PostgreSQL", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  beforeEach(() => { config.bytes.clear(); config.deleted.length = 0; });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.$disconnect();
  });

  it("首次同批建立开庭和期限，按实际第二程序保存并各由触发器建立唯一责任/通知", async () => {
    const f = await fixture(), hearing = await suggestion(f), deadline = await suggestion(f, "DEADLINE", "2027-02-05", "17:00");
    const result = await decideSmsSuggestions(request(f, [hearing, deadline]));
    expect(result.results.map(row => row.outcome)).toEqual(["CREATED", "CREATED"]);
    expect(await db.hearing.count({ where: { procedureId: f.first.id } })).toBe(0);
    expect(await db.deadline.count({ where: { procedureId: f.first.id } })).toBe(0);
    for (const item of result.results) {
      const saved = await db.smsSuggestion.findUniqueOrThrow({ where: { id: item.suggestionId } });
      expect(saved).toMatchObject({ status: "ACCEPTED", targetId: item.targetId, targetType: item.targetType, decidedById: f.user.id });
      const responsibility = await db.workResponsibility.findFirstOrThrow({ where: item.targetType === "Hearing" ? { hearingId: item.targetId! } : { deadlineId: item.targetId! } });
      expect(responsibility.assigneeId).toBe(f.user.id);
      expect(await db.notification.count({ where: { refType: "WorkResponsibility", refId: responsibility.id } })).toBe(1);
      expect(await db.auditLog.count({ where: { action: "SMS_SUGGESTION_APPLIED", targetId: saved.id } })).toBe(1);
    }
    expect(await db.smsMessage.findUniqueOrThrow({ where: { id: f.sms.id } })).toMatchObject({ processingState: "ORGANIZED", generatedHearingId: null, generatedDeadlineId: null });
  });

  it("message已有生成记录不吞掉另一事件；相同事件必须明确关联，不自动合并", async () => {
    const f = await fixture();
    const original = await db.hearing.create({ data: { procedureId: f.second.id, title: "合成HEARING", startsAt: new Date("2027-02-03T01:30:00Z") } });
    await db.smsMessage.update({ where: { id: f.sms.id }, data: { generatedHearingId: original.id, processed: true, processedAt: new Date() } });
    const other = await suggestion(f, "HEARING", "2027-02-04");
    expect((await decideSmsSuggestions(request(f, [other]))).results[0].outcome).toBe("CREATED");
    const same = await suggestion(f);
    await expect(decideSmsSuggestions(request(f, [same]))).rejects.toThrow("明确关联");
    const input = request(f, [same]);
    input.items[0].event = { mode: "LINK", procedureId: f.second.id, targetId: original.id, expectedTargetUpdatedAt: original.updatedAt };
    expect((await decideSmsSuggestions(input)).results[0]).toMatchObject({ outcome: "LINKED", targetId: original.id });
    expect(await db.hearing.count({ where: { procedureId: f.second.id } })).toBe(2);
  });

  it("相同请求并发/重放只创建一次；改变决定、程序或输入明确冲突", async () => {
    const f = await fixture(), row = await suggestion(f), input = request(f, [row]);
    const results = await Promise.all([decideSmsSuggestions(input), decideSmsSuggestions(input)]);
    expect(results.flatMap(result => result.results).filter(item => item.replayed)).toHaveLength(1);
    expect(await db.hearing.count({ where: { procedureId: f.second.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "SMS_SUGGESTION_APPLIED", targetId: row.id } })).toBe(1);
    expect((await decideSmsSuggestions(input)).results[0].replayed).toBe(true);
    const altered = request(f, [row]); altered.items[0].event = { mode: "CREATE", procedureId: f.first.id, title: "合成HEARING", dateText: "2027-02-03", timeText: "09:30" };
    await expect(decideSmsSuggestions(altered)).rejects.toThrow("本次决定或所选目标不同");
    await expect(decideSmsSuggestions(request(f, [row], "REJECTED"))).rejects.toThrow("本次决定或所选目标不同");
  });

  it("混入另一来件、越案程序、过时建议均原子拒绝，不留下成功假象", async () => {
    const f = await fixture(), row = await suggestion(f), other = await fixture(), otherRow = await suggestion(other);
    await actor(f.user);
    const mixed = request(f, [row, otherRow]);
    await expect(decideSmsSuggestions(mixed)).rejects.toThrow("当前来件");
    const wrong = request(f, [row]); wrong.items[0].event = { mode: "CREATE", procedureId: other.first.id, title: "合成HEARING", dateText: "2027-02-03", timeText: "09:30" };
    await expect(decideSmsSuggestions(wrong)).rejects.toThrow("实际代理");
    await db.smsSuggestion.update({ where: { id: row.id }, data: { updatedAt: new Date(row.updatedAt.getTime() + 1000), suggestedValue: "已由另一请求修改" } });
    await expect(decideSmsSuggestions(request(f, [row]))).rejects.toThrow("建议内容已变化");
    expect(await db.hearing.count({ where: { procedureId: f.second.id } })).toBe(0);
    expect((await db.smsSuggestion.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PENDING");
  });

  it("关联读取限实际程序同日；目标版本变化后不采用旧选择，日期型来源不伪造时刻", async () => {
    const f = await fixture(), row = await suggestion(f, "DEADLINE", "2027-02-03", null);
    await expect(decideSmsSuggestions(request(f, [row]))).rejects.toThrow();
    const target = await db.deadline.create({ data: { procedureId: f.second.id, title: "人工登记日期型期限", dueAt: new Date("2027-02-03T00:00:00Z") } });
    const options = await listSmsEventTargets({ smsId: f.sms.id, suggestionId: row.id, procedureId: f.second.id });
    expect(options.targets.map(item => item.id)).toContain(target.id);
    const input = request(f, [row]); input.items[0].event = { mode: "LINK", procedureId: f.second.id, targetId: target.id, expectedTargetUpdatedAt: target.updatedAt };
    await db.deadline.update({ where: { id: target.id }, data: { title: "人工登记已更正", updatedAt: new Date(target.updatedAt.getTime() + 1000) } });
    await expect(decideSmsSuggestions(input)).rejects.toThrow("所选事项已被修改");
    const current = await db.deadline.findUniqueOrThrow({ where: { id: target.id } });
    input.items[0].event = { mode: "LINK", procedureId: f.second.id, targetId: target.id, expectedTargetUpdatedAt: current.updatedAt };
    expect((await decideSmsSuggestions(input)).results[0]).toMatchObject({ outcome: "LINKED", targetId: target.id });
    expect(await db.deadline.count({ where: { procedureId: f.second.id } })).toBe(1);
  });

  it("旧ACCEPTED无产物仍保留原样；旧DOC_TYPE不伪造人工决定、不阻塞真实完成", async () => {
    const f = await fixture(), legacy = await suggestion(f);
    await db.smsSuggestion.update({ where: { id: legacy.id }, data: { status: "ACCEPTED", decidedById: f.user.id, decidedAt: new Date() } });
    await expect(decideSmsSuggestions(request(f, [legacy]))).rejects.toThrow("历史未记录实际产物");
    const metadata = await db.smsSuggestion.create({ data: { smsId: f.sms.id, kind: "DOC_TYPE", createdById: f.user.id, suggestedValue: "传票" } });
    const current = await suggestion(f, "HEARING", "2027-02-04");
    const result = await decideSmsSuggestions(request(f, [current]));
    expect(result.remaining?.organized).toBe(true);
    expect(await db.smsSuggestion.findUniqueOrThrow({ where: { id: metadata.id } })).toMatchObject({ status: "PENDING", decidedById: null, decidedAt: null });
    expect(await db.smsSuggestion.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ targetId: null, targetType: null });
  });

  it("缺失原件不回滚已采纳事件，逐文件原因可见，补齐后只接续入卷不重复事件", async () => {
    const f = await fixture(), row = await suggestion(f), file = await sourceFile(f, false);
    const result = await decideSmsSuggestions(request(f, [row]));
    expect(result.results[0].outcome).toBe("CREATED");
    expect(result.remaining).toMatchObject({ remainingFiles: 1, organized: false });
    expect(result.remaining?.processingNote).toContain("合成来件原件.txt：暂存原件不存在");
    expect((await db.smsInboundFile.findUniqueOrThrow({ where: { id: file.id } })).documentId).toBeNull();
    config.bytes.set(file.storageKey, Buffer.from("Synthetic original source; no client data."));
    const retried = await retrySmsSuggestionFiling(f.sms.id);
    expect(retried).toMatchObject({ filedFiles: 1, remaining: { remainingFiles: 0, organized: true } });
    const filed = await db.smsInboundFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(filed.documentId).not.toBeNull();
    expect(await db.document.count({ where: { id: filed.documentId! } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: file.id, action: "SMS_FILE_FILED" } })).toBe(1);
    expect((await retrySmsSuggestionFiling(f.sms.id)).filedFiles).toBe(0);
    expect(await db.hearing.count({ where: { procedureId: f.second.id } })).toBe(1);
  });

  it("通过真实补传入口接续同内容缺失原件，保留原文件身份与历史且不重复入卷", async () => {
    const f = await fixture(), original = await sourceFile(f, false), row = await suggestion(f);
    await db.smsSuggestion.update({ where: { id: row.id }, data: { fileId: original.id } });
    const form = () => {
      const data = new FormData(); data.set("smsId", f.sms.id);
      data.append("files", new File(["Synthetic original source; no client data."], "重新取得的原件.txt", { type: "text/plain" }));
      return data;
    };
    const result = await uploadSmsInboundFile(form());
    expect(result).toMatchObject({ ok: true, saved: [], replenished: ["重新取得的原件.txt"], failed: [], filedFiles: 1 });
    const current = await db.smsInboundFile.findUniqueOrThrow({ where: { id: original.id } });
    expect(current).toMatchObject({ originalName: original.originalName, downloadedAt: original.downloadedAt, downloadedById: original.downloadedById, sha256: original.sha256, state: "FILED" });
    expect(current.documentId).not.toBeNull();
    expect((await db.smsSuggestion.findUniqueOrThrow({ where: { id: row.id } })).fileId).toBe(original.id);
    expect(await db.auditLog.count({ where: { targetId: original.id, action: "SMS_INBOUND_FILE_REPLENISHED" } })).toBe(1);
    expect((await uploadSmsInboundFile(form())).skippedDuplicates).toEqual(["重新取得的原件.txt"]);
    expect(await db.smsInboundFile.count({ where: { smsId: f.sms.id } })).toBe(1);
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(1);
  });

  it("另一请求已入卷的文件不因多余副本清理失败而误报，仍明确保留真正缺失的原件", async () => {
    const f = await fixture(), available = await sourceFile(f, true);
    const missing = await db.smsInboundFile.create({ data: { smsId: f.sms.id, storageKey: `synthetic-missing-${randomUUID()}`,
      sourceUrl: "https://example.invalid/missing", originalName: "仍缺失的合成原件.txt", mimeType: "text/plain", size: 21,
      sha256: sha256(Buffer.from("Different missing original")), downloadedById: f.user.id } });
    vi.mocked(storage.writeFile).mockImplementationOnce(async (_prefix, bytes) => {
      const path = `synthetic-extra-copy-${randomUUID()}`; config.bytes.set(path, bytes);
      // The first caller prepares outside the transaction while a second real call completes filing.
      expect(await fileSmsInboundFilesToMatter({ smsId: f.sms.id, matterId: f.matter.id, userId: f.user.id })).toBe(1);
      return path;
    });
    vi.mocked(storage.deleteFile).mockRejectedValueOnce(new Error("synthetic cleanup unavailable"));
    expect(await fileSmsInboundFilesToMatter({ smsId: f.sms.id, matterId: f.matter.id, userId: f.user.id })).toBe(0);
    const message = await db.smsMessage.findUniqueOrThrow({ where: { id: f.sms.id } });
    expect(message.processingNote).toContain(`${missing.originalName}：暂存原件不存在`);
    expect(message.processingNote).not.toContain(`${available.originalName}：`);
    expect((await db.smsInboundFile.findUniqueOrThrow({ where: { id: available.id } })).documentId).not.toBeNull();
    expect((await db.smsInboundFile.findUniqueOrThrow({ where: { id: missing.id } })).documentId).toBeNull();
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: available.id, action: "SMS_FILE_FILED" } })).toBe(1);
  });

  it("多文件补传如实返回各项成功/失败，失败不抹掉已提交的原件", async () => {
    const f = await fixture(), form = new FormData(); form.set("smsId", f.sms.id);
    form.append("files", new File(["Synthetic valid source"], "合成原件.txt", { type: "text/plain" }));
    form.append("files", new File(["Synthetic invalid source"], "合成禁止脚本.exe", { type: "application/octet-stream" }));
    form.append("files", new File([], "合成空原件.txt", { type: "text/plain" }));
    const result = await uploadSmsInboundFile(form);
    expect(result).toMatchObject({ ok: false, saved: ["合成原件.txt"], filedFiles: 1 });
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0].name).toBe("合成禁止脚本.exe");
    expect(result.failed[1]).toEqual({ name: "合成空原件.txt", message: "文件为空" });
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(1);
  });

  it.each([false, true])("并发同内容补传只保存一份，核对另一方原件后跳过；清理失败不重复记为失败（原件缺失=%s）", async missingOriginal => {
    const f = await fixture();
    await db.smsMessage.update({ where: { id: f.sms.id }, data: { matchedMatterId: null, matchedBy: "UNMATCHED" } });
    const original = missingOriginal ? await sourceFile(f, false) : null;
    let prepared = 0, release!: () => void;
    const bothPrepared = new Promise<void>(resolve => { release = resolve; });
    const write = vi.mocked(storage.writeFile), originalWrite = write.getMockImplementation()!;
    write.mockImplementation(async (_prefix, bytes) => {
      const path = `synthetic-concurrent-${randomUUID()}`; config.bytes.set(path, bytes);
      if (++prepared === 2) release();
      await bothPrepared;
      return path;
    });
    vi.mocked(storage.deleteFile).mockRejectedValueOnce(new Error("synthetic cleanup unavailable"));
    const form = () => {
      const data = new FormData(); data.set("smsId", f.sms.id);
      data.append("files", new File(["Synthetic original source; no client data."], "并发原件.txt", { type: "text/plain" }));
      return data;
    };
    try {
      const results = await Promise.all([uploadSmsInboundFile(form()), uploadSmsInboundFile(form())]);
      expect(results.every(result => result.ok && result.failed.length === 0)).toBe(true);
      expect(results.flatMap(result => result.skippedDuplicates)).toEqual(["并发原件.txt"]);
      expect(results.flatMap(result => missingOriginal ? result.replenished : result.saved)).toEqual(["并发原件.txt"]);
      const files = await db.smsInboundFile.findMany({ where: { smsId: f.sms.id } });
      expect(files).toHaveLength(1);
      if (original) expect(files[0]).toMatchObject({ id: original.id, downloadedAt: original.downloadedAt, downloadedById: original.downloadedById });
      expect(sha256(config.bytes.get(files[0].storageKey)!)).toBe(files[0].sha256);
      expect(await db.auditLog.count({ where: { targetId: files[0].id, action: { in: ["SMS_INBOUND_FILE_UPLOAD", "SMS_INBOUND_FILE_REPLENISHED"] } } })).toBe(1);
    } finally { write.mockImplementation(originalWrite); }
  });

  it.each(["disabled", "receiver"] as const)("补传准备后 %s 变化阻止提交并保留原文件历史", async changed => {
    const f = await fixture(), original = await sourceFile(f, false), other = await makeUser();
    vi.mocked(storage.writeFile).mockImplementationOnce(async (_prefix, bytes) => {
      const path = `synthetic-uncommitted-${randomUUID()}`; config.bytes.set(path, bytes);
      if (changed === "disabled") await db.user.update({ where: { id: f.user.id }, data: { active: false } });
      else await db.smsMessage.update({ where: { id: f.sms.id }, data: { receivedById: other.id } });
      return path;
    });
    const form = new FormData(); form.set("smsId", f.sms.id);
    form.append("files", new File(["Synthetic original source; no client data."], "撤权后原件.txt", { type: "text/plain" }));
    const result = await uploadSmsInboundFile(form);
    expect(result).toMatchObject({ ok: false, saved: [], replenished: [], skippedDuplicates: [], filedFiles: 0 });
    expect(result.failed).toHaveLength(1);
    expect(await db.smsInboundFile.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    expect(await db.auditLog.count({ where: { targetId: original.id, action: "SMS_INBOUND_FILE_REPLENISHED" } })).toBe(0);
    expect(config.deleted.some(path => path.startsWith("synthetic-uncommitted-"))).toBe(true);
  });

  it("补传返回业务失败文案，不将原生存储异常细节作为结果发送", async () => {
    const f = await fixture();
    vi.mocked(storage.writeFile).mockRejectedValueOnce(new Error("synthetic internal storage detail"));
    const form = new FormData(); form.set("smsId", f.sms.id);
    form.append("files", new File(["Synthetic source"], "失败原件.txt", { type: "text/plain" }));
    expect((await uploadSmsInboundFile(form)).failed).toEqual([{ name: "失败原件.txt", message: "补传失败，请重试" }]);
  });

  it("文件准备后撤权不提交材料/映射，清理的仅是本次未提交副本", async () => {
    const f = await fixture(), file = await sourceFile(f, true);
    vi.mocked(storage.writeFile).mockImplementationOnce(async (_prefix, bytes) => {
      const path = `synthetic-unused-${randomUUID()}`; config.bytes.set(path, bytes);
      await db.user.update({ where: { id: f.user.id }, data: { active: false } }); return path;
    });
    await expect(fileSmsInboundFilesToMatter({ smsId: f.sms.id, matterId: f.matter.id, userId: f.user.id })).rejects.toThrow("账号");
    expect((await db.smsInboundFile.findUniqueOrThrow({ where: { id: file.id } })).documentId).toBeNull();
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(0);
    expect(config.deleted.some(path => path.startsWith("synthetic-unused-"))).toBe(true);
    expect(config.bytes.has(file.storageKey)).toBe(true);
  });

  it("取件失败且没有文件行时也不把来件伪装成已整理", async () => {
    const f = await fixture(), row = await suggestion(f);
    await db.smsMessage.update({ where: { id: f.sms.id }, data: { processingState: "PARTIAL", parsedJson: { attachmentResults: [{ status: "FAILED" }] } } });
    const result = await decideSmsSuggestions(request(f, [row]));
    expect(result.remaining).toMatchObject({ organized: false, needsManualFetch: true });
  });

  it.each([false, true])("已整理后出现新待办，剩余建议/文件使其回到待核对（文件=%s）", async withFile => {
    const f = await fixture(), row = await suggestion(f);
    await suggestion(f, "HEARING", "2027-02-04");
    if (withFile) await sourceFile(f, false);
    await db.smsMessage.update({ where: { id: f.sms.id }, data: { processingState: "ORGANIZED" } });
    const result = await decideSmsSuggestions(request(f, [row], "REJECTED"));
    expect(result.remaining).toMatchObject({ organized: false, remainingSuggestions: 1, remainingFiles: withFile ? 1 : 0 });
    expect((await db.smsMessage.findUniqueOrThrow({ where: { id: f.sms.id } })).processingState).toBe(withFile ? "PARTIAL" : "READY_FOR_REVIEW");
    expect(await db.auditLog.count({ where: { targetId: f.sms.id, action: "SMS_REVIEW_REOPENED" } })).toBe(1);
  });

  it("事项读写资格分别检查；没有日程权限仍可明确拒绝建议", async () => {
    const f = await fixture(true), row = await suggestion(f);
    const target = await db.hearing.create({ data: { procedureId: f.second.id, title: "已登记合成开庭", startsAt: new Date("2027-02-03T01:30:00Z") } });
    await db.rolePermission.deleteMany({ where: { roleId: f.user.roleDefinitionId!, permissionKey: { in: ["schedule.read", "schedule.write"] } } });
    await actor(f.user);
    await expect(decideSmsSuggestions(request(f, [row]))).rejects.toThrow("无权");
    await expect(listSmsEventTargets({ smsId: f.sms.id, suggestionId: row.id, procedureId: f.second.id })).rejects.toThrow("无权");
    const linked = request(f, [row]); linked.items[0].event = { mode: "LINK", procedureId: f.second.id, targetId: target.id, expectedTargetUpdatedAt: target.updatedAt };
    await expect(decideSmsSuggestions(linked)).rejects.toThrow("无权");
    expect(await db.hearing.count({ where: { procedureId: f.second.id } })).toBe(1);
    expect((await decideSmsSuggestions(request(f, [row], "REJECTED"))).results[0].outcome).toBe("REJECTED");
  });

  it("采纳事件不借用案件写权入卷材料，缺少材料写权时保留真实待处理文件", async () => {
    const f = await fixture(true), row = await suggestion(f), file = await sourceFile(f, true);
    await db.rolePermission.deleteMany({ where: { roleId: f.user.roleDefinitionId!, permissionKey: "documents.write" } });
    await actor(f.user);
    const result = await decideSmsSuggestions(request(f, [row]));
    expect(result.results[0].outcome).toBe("CREATED");
    expect(result.remaining).toMatchObject({ organized: false, remainingFiles: 1 });
    expect(await db.document.count({ where: { matterId: f.matter.id } })).toBe(0);
    expect((await db.smsInboundFile.findUniqueOrThrow({ where: { id: file.id } })).documentId).toBeNull();
  });

  it("主任律师保留非成员案件办理口径", async () => {
    const f = await fixture(), row = await suggestion(f), principal = await makeUser(false, true);
    await actor(principal);
    const result = await decideSmsSuggestions(request(f, [row]));
    expect(result.results[0].outcome).toBe("CREATED");
    expect((await db.smsSuggestion.findUniqueOrThrow({ where: { id: row.id } })).decidedById).toBe(principal.id);
  });

  it.each(["archive", "disabled", "permission", "session", "membership"])("排队期间 %s 先提交，旧请求不创建/采纳/审计", async state => {
    const f = await fixture(state === "permission"), row = await suggestion(f), alternate = state === "membership" ? await makeUser() : null;
    const result = await priorCommit(async tx => {
      if (state === "archive") return tx.matter.update({ where: { id: f.matter.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      if (state === "disabled") return tx.user.update({ where: { id: f.user.id }, data: { active: false } });
      if (state === "session") return tx.user.update({ where: { id: f.user.id }, data: { sessionVersion: { increment: 1 } } });
      if (state === "membership") return tx.matter.update({ where: { id: f.matter.id }, data: { ownerId: alternate!.id } });
      return tx.rolePermission.deleteMany({ where: { roleId: f.user.roleDefinitionId!, permissionKey: "matters.write" } });
    }, () => decideSmsSuggestions(request(f, [row])));
    expect(result.error).toBeInstanceOf(Error);
    expect(await db.hearing.count({ where: { procedureId: f.second.id } })).toBe(0);
    expect((await db.smsSuggestion.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PENDING");
    expect(await db.auditLog.count({ where: { targetId: row.id, action: "SMS_SUGGESTION_APPLIED" } })).toBe(0);
  });
});
