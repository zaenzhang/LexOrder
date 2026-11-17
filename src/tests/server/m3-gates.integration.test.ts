// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceActor } from "@/lib/runtime/actor";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("M3 gate tests require an isolated _test database");
  return { url, actor: null as WorkspaceActor | null };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/gates_test") };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: config.actor })), getSession: vi.fn(async () => ({ user: config.actor })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Keep reminder retirement in the actual transaction; dispatch is a separate boundary.
vi.mock("@/server/reminders/schedule", async () => ({
  ...await vi.importActual<typeof import("@/server/reminders/schedule")>("@/server/reminders/schedule"),
  refreshScheduleReminderAfterSave: vi.fn(),
}));

import { prisma as db } from "@/lib/prisma";
import { resolveRoleUser } from "@/lib/roles/service";
import { approvalTransaction } from "@/lib/approvals/service";
import { runMatterReview, decideMatterReview } from "@/server/conflicts/matter-actions";
import { assertMatterReviewCurrent, matterReviewState, readMatterReview } from "@/server/conflicts/matter-review";
import { addProcedure, updateProcedure } from "@/server/procedures/actions";
import { registerBillingTx, signBillingTx } from "@/server/finance/ledger-registration";
import { bindContractScopeTx } from "@/server/finance/ledger-contracts";
import { createIntake, convertIntakeToMatter, resubmitIntake } from "@/server/intakes/actions";
import { runCheckAndSave } from "@/server/conflicts/actions";
import { confirmDeadline, adjustDeadline } from "@/server/deadlines/confirm";
import { assertDeadlineRecalcWritable } from "@/server/deadlines/recalc-guard";

const users: string[] = [], matters: string[] = [], clients: string[] = [], roles: string[] = [], groups: string[] = [];
async function setActor(user: User) {
  config.actor = { id: user.id, name: user.name, email: user.email, avatar: user.avatar, systemRole: user.systemRole,
    ...await resolveRoleUser(user.id, user.role), runtimeMode: "SERVER" };
}
async function makeUser(custom = false) {
  let roleId: string | undefined;
  if (custom) {
    const name = `gates-${randomUUID()}`;
    const role = await db.roleDefinition.create({ data: { name, normalizedName: name,
      permissions: { create: ["schedule.read", "schedule.write", "matters.read", "matters.write", "finance.write"].map(permissionKey => ({ permissionKey, scope: "OWN" })) } } });
    roles.push(role.id); roleId = role.id;
  }
  const user = await db.user.create({ data: { name: "合成门禁经办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only",
    role: custom ? "CUSTOM" : "LAWYER", roleDefinitionId: roleId } }); users.push(user.id);
  return user;
}
async function fixture(custom = false) {
  const user = await makeUser(custom); await setActor(user);
  const matter = await db.matter.create({ data: { title: "合成门禁事项", internalCode: `GATES-${randomUUID()}`, ownerId: user.id, status: "IN_PROGRESS" } }); matters.push(matter.id);
  const party = await db.party.create({ data: { matterId: matter.id, role: "CLIENT_PARTY", name: `合成主体-${randomUUID()}` } });
  const procedure = await addProcedure({ matterId: matter.id, type: "FIRST_INSTANCE", engagement: "ENGAGED", isExternalLead: false });
  return { user, matter, party, procedure };
}
async function latestCheck(matterId: string) {
  return db.conflictCheck.findFirstOrThrow({ where: { matterId }, orderBy: [{ checkedAt: "desc" }, { id: "desc" }], include: { hits: true } });
}
async function review(matterId: string) {
  await runMatterReview(matterId);
  const check = await latestCheck(matterId);
  await decideMatterReview({ matterId, checkId: check.id, expectedDecidedAt: check.decidedAt, conclusion: "DIFFERENT", note: "合成工程核查已检查范围与已列命中；不构成真实客户专业判断。" });
  return check.id;
}
async function procedureVersion(id: string) { return db.matterProcedure.findUniqueOrThrow({ where: { id } }); }
async function signedContract(f: Awaited<ReturnType<typeof fixture>>) {
  const billing = await approvalTransaction(tx => registerBillingTx(tx, f.user.id, { matterId: f.matter.id, title: "合成零收费委托", moneyKind: "LAWYER_FEE", amount: "0", installments: [] }));
  await approvalTransaction(tx => signBillingTx(tx, f.user.id, { id: billing.id, revision: 0, signedAt: new Date("2026-10-01T04:00:00Z"), installments: [] }));
  return billing.id;
}
async function bind(billingId: string, f: Awaited<ReturnType<typeof fixture>>, state: "COVERED" | "PENDING_REVIEW") {
  const billing = await db.billing.findUniqueOrThrow({ where: { id: billingId } });
  await approvalTransaction(tx => bindContractScopeTx(tx, f.user.id, { billingId, revision: billing.revision, procedureId: f.procedure.id, state, note: "合成委托范围条款核对依据" }));
}
async function pendingDeadline(procedureId: string) {
  // Initial unconfirmed record only; every confirmation/adjustment below uses its real action.
  return db.deadline.create({ data: { procedureId, title: "合成待核期限", dueAt: new Date("2027-02-01T04:00:00Z"), basis: "合成待核来源", confirmStatus: "PENDING" } });
}

/** A concurrent authorization/archive fixture commits before the waiting business write. */
async function priorCommit(mutate: (tx: Prisma.TransactionClient) => Promise<unknown>, attempt: () => Promise<unknown>) {
  let unlock!: () => void, acquired!: () => void;
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const locked = new Promise<void>(resolve => { acquired = resolve; });
  const prior = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
    await mutate(tx); acquired(); await gate;
  }, { timeout: 20000 });
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
  expect(observedWaiting, "business write must actually wait behind the prior authorization/archive commit").toBe(true);
  return outcome;
}

const deniedStates = ["archive", "disabled", "permission"] as const;
async function revoke(tx: Prisma.TransactionClient, f: Awaited<ReturnType<typeof fixture>>, state: typeof deniedStates[number]) {
  if (state === "archive") return tx.matter.update({ where: { id: f.matter.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
  if (state === "disabled") return tx.user.update({ where: { id: f.user.id }, data: { active: false } });
  return tx.rolePermission.deleteMany({ where: { roleId: f.user.roleDefinitionId!, permissionKey: "schedule.write" } });
}

describe.skipIf(!config.url)("M3 程序冲突、合同与人工期限守卫：真实 PG", () => {
  beforeAll(async () => { vi.stubEnv("LEXORDER_RUNTIME_MODE", "SERVER"); await db.$connect(); });
  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.roleDefinition.updateMany({ where: { id: { in: roles } }, data: { active: false } });
    await db.approvalPermissionGroup.updateMany({ where: { id: { in: groups } }, data: { active: false } });
    await db.$disconnect();
  });

  it("普通零命中检索仍待人工判断，读取不生成决定；明确判断后才放行", async () => {
    const f = await fixture();
    await runMatterReview(f.matter.id);
    const check = await latestCheck(f.matter.id);
    expect(check.hits).toHaveLength(0);
    expect(check).toMatchObject({ conclusion: "PENDING", decidedById: null, decidedAt: null });
    const auditCount = await db.auditLog.count({ where: { targetId: check.id } });
    const view = await readMatterReview(db, f.matter.id);
    expect(view).toMatchObject({ needsReview: true, checks: [{ id: check.id, current: true, decisionRecorded: false }] });
    expect(await latestCheck(f.matter.id)).toEqual(check);
    expect(await db.auditLog.count({ where: { targetId: check.id } })).toBe(auditCount);
    await expect(assertMatterReviewCurrent(db, f.matter.id)).rejects.toThrow("请记录人工判断");
    await decideMatterReview({ matterId: f.matter.id, checkId: check.id, expectedDecidedAt: check.decidedAt, conclusion: "DIFFERENT", note: "合成核查：已查看检索范围并核实业务背景" });
    await expect(assertMatterReviewCurrent(db, f.matter.id)).resolves.toBeUndefined();
    expect((await readMatterReview(db, f.matter.id))?.needsReview).toBe(false);
    const decided = await latestCheck(f.matter.id);
    await expect(decideMatterReview({ matterId: f.matter.id, checkId: check.id, expectedDecidedAt: null, conclusion: "SAME_SUBJECT", note: "旧页面试图覆盖后来已保存结论" })).rejects.toThrow("复核结论已被修改");
    expect(await latestCheck(f.matter.id)).toEqual(decided);
  });

  it("旧自动 DIFFERENT 与不匹配身份的审计均不冒充人工决定；读取不改旧字段", async () => {
    const f = await fixture(), other = await makeUser();
    const state = await matterReviewState(db, f.matter.id);
    // Explicit legacy data fixture reproduces the previous automatic record shape.
    const legacy = await db.conflictCheck.create({ data: { matterId: f.matter.id, subjectFingerprint: state.subjectFingerprint,
      queryPayload: { queries: state.queries }, conclusion: "DIFFERENT", decidedById: f.user.id, decidedAt: new Date(), note: "系统检索未命中，仍须结合实际业务判断" } });
    await db.auditLog.create({ data: { userId: other.id, action: "MATTER_CONFLICT_DECISION", targetType: "ConflictCheck", targetId: legacy.id, detail: { matterId: f.matter.id, conclusion: "DIFFERENT" } } });
    expect((await readMatterReview(db, f.matter.id))?.checks[0]).toMatchObject({ id: legacy.id, decisionRecorded: false });
    await expect(assertMatterReviewCurrent(db, f.matter.id)).rejects.toThrow("请记录人工判断");
    expect(await db.conflictCheck.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(legacy);
    await decideMatterReview({ matterId: f.matter.id, checkId: legacy.id, expectedDecidedAt: legacy.decidedAt, conclusion: "DIFFERENT", note: "本次实际人工核对，保留原检索记录" });
    await expect(assertMatterReviewCurrent(db, f.matter.id)).resolves.toBeUndefined();
  });

  it("实际独立收案批准转案所继承的决定保留，并以原审批操作者为依据", async () => {
    const owner = await makeUser(), approver = await makeUser();
    const group = await db.approvalPermissionGroup.create({ data: { name: `合成收案审批-${randomUUID()}`, members: { create: { userId: approver.id } },
      rules: { create: { action: "INTAKE_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] } } } }); groups.push(group.id);
    const client = await db.client.create({ data: { name: `合成收案主体-${randomUUID()}`, type: "INDIVIDUAL", ownerUserId: owner.id, tags: [] } }); clients.push(client.id);
    await setActor(owner);
    const intake = await createIntake({ category: "NON_LITIGATION", firstProcedureType: "NON_LITIGATION_PHASE", clientId: client.id, clientType: "INDIVIDUAL",
      contactName: "合成联络人", contactPhone: "00000000", counterclaim: false, coUserIds: [], parties: [] });
    await runCheckAndSave({ intakeId: intake.id, queries: [{ role: "CLIENT_PARTY", name: client.name }] });
    await resubmitIntake(intake.id);
    await setActor(approver);
    const converted = await convertIntakeToMatter(intake.id, "合成工程验收：独立审批后批准转案"); matters.push(converted.matterId);
    const inherited = await latestCheck(converted.matterId);
    expect(inherited.decidedById).toBe(approver.id);
    expect(await db.auditLog.count({ where: { userId: approver.id, action: "INTAKE_APPROVE", targetId: intake.id } })).toBe(1);
    expect((await readMatterReview(db, converted.matterId))?.checks[0]).toMatchObject({ decisionRecorded: true });
    await expect(assertMatterReviewCurrent(db, converted.matterId)).resolves.toBeUndefined();
  });

  it("启动与重开同时消费当前合同覆盖、动态复核、所见程序版本及真实结束历史", async () => {
    const f = await fixture();
    const initial = await procedureVersion(f.procedure.id);
    await expect(updateProcedure({ id: initial.id, expectedUpdatedAt: initial.updatedAt, status: "IN_PROGRESS" })).rejects.toThrow("无有效委托覆盖");
    await review(f.matter.id);
    const billingId = await signedContract(f);
    await bind(billingId, f, "COVERED");
    await expect(updateProcedure({ id: initial.id, expectedUpdatedAt: initial.updatedAt, status: "IN_PROGRESS" })).rejects.toThrow("动态冲突复核");
    expect((await procedureVersion(initial.id)).status).toBe("PENDING");
    expect(await db.auditLog.count({ where: { targetId: initial.id, action: "PROCEDURE_UPDATE" } })).toBe(0);
    await review(f.matter.id);
    const competing = await Promise.allSettled([
      updateProcedure({ id: initial.id, expectedUpdatedAt: initial.updatedAt, status: "IN_PROGRESS" }),
      updateProcedure({ id: initial.id, expectedUpdatedAt: initial.updatedAt, status: "IN_PROGRESS" }),
    ]);
    expect(competing.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(competing.filter(result => result.status === "rejected")).toHaveLength(1);
    const started = await procedureVersion(initial.id);
    const endedAt = new Date();
    await updateProcedure({ id: initial.id, expectedUpdatedAt: started.updatedAt, status: "CONCLUDED", concludedAt: endedAt, outcome: "COMPLETED", outcomeNote: "合成实际终结记录" });
    const concluded = await procedureVersion(initial.id);
    await expect(updateProcedure({ id: initial.id, expectedUpdatedAt: concluded.updatedAt, status: "IN_PROGRESS" })).rejects.toThrow("恢复办理的原因");
    await bind(billingId, f, "PENDING_REVIEW");
    await expect(updateProcedure({ id: initial.id, expectedUpdatedAt: concluded.updatedAt, status: "IN_PROGRESS", changeReason: "合成需要继续办理" })).rejects.toThrow("无有效委托覆盖");
    await review(f.matter.id); await bind(billingId, f, "COVERED"); await review(f.matter.id);
    await updateProcedure({ id: initial.id, expectedUpdatedAt: concluded.updatedAt, status: "IN_PROGRESS", changeReason: "合成后续办理依据已核实" });
    expect(await procedureVersion(initial.id)).toMatchObject({ status: "IN_PROGRESS", concludedAt: null, outcome: null, outcomeNote: null });
    const audit = await db.auditLog.findFirstOrThrow({ where: { targetId: initial.id, action: "PROCEDURE_UPDATE", detail: { path: ["fromStatus"], equals: "CONCLUDED" } }, orderBy: { createdAt: "desc" } });
    expect(audit.detail).toMatchObject({ previousConcludedAt: endedAt.toISOString(), previousOutcome: "COMPLETED", previousOutcomeNote: "合成实际终结记录", reason: "合成后续办理依据已核实" });
  });

  it("他案新增命中后读取与办理守卫都提示重核，且不向当前页面增加他案正文或 ID", async () => {
    const f = await fixture(); await review(f.matter.id);
    const checked = await latestCheck(f.matter.id);
    const related = await db.matter.create({ data: { title: "合成另案", internalCode: `NEW-HIT-${randomUUID()}`, ownerId: f.user.id } }); matters.push(related.id);
    await db.party.create({ data: { matterId: related.id, role: "OPPOSING_PARTY", name: f.party.name } });
    const view = await readMatterReview(db, f.matter.id);
    expect(view).toMatchObject({ needsReview: true });
    expect(view?.reviewReason).toContain("新增相关命中");
    expect(JSON.stringify(view)).not.toContain(related.id);
    await expect(assertMatterReviewCurrent(db, f.matter.id)).rejects.toThrow("新增相关命中");
    await expect(decideMatterReview({ matterId: f.matter.id, checkId: checked.id, expectedDecidedAt: checked.decidedAt, conclusion: "DIFFERENT", note: "旧检索不可跳过新增命中" })).rejects.toThrow("新增冲突命中");
    await review(f.matter.id);
    await expect(assertMatterReviewCurrent(db, f.matter.id)).resolves.toBeUndefined();
  });

  it.each(["run", "decide"])("冲突 %s 排队期间内置岗位撤为财务岗，旧会话不能继续登记检索或决定", async action => {
    const f = await fixture();
    await runMatterReview(f.matter.id);
    const check = await latestCheck(f.matter.id);
    const count = await db.conflictCheck.count({ where: { matterId: f.matter.id } });
    const audits = await db.auditLog.count({ where: { targetId: check.id } });
    const result = await priorCommit(tx => tx.user.update({ where: { id: f.user.id }, data: { role: "FINANCE" } }), () => action === "run"
      ? runMatterReview(f.matter.id)
      : decideMatterReview({ matterId: f.matter.id, checkId: check.id, expectedDecidedAt: check.decidedAt, conclusion: "DIFFERENT", note: "排队期间岗位已变化" }));
    expect(result.error).toBeInstanceOf(Error);
    expect(await latestCheck(f.matter.id)).toEqual(check);
    expect(await db.conflictCheck.count({ where: { matterId: f.matter.id } })).toBe(count);
    expect(await db.auditLog.count({ where: { targetId: check.id } })).toBe(audits);
  });

  it.each(deniedStates)("程序保存遇 %s 先提交时，旧请求不越过当前写入守卫", async state => {
    const f = await fixture(state === "permission"), before = await procedureVersion(f.procedure.id);
    const result = await priorCommit(tx => revoke(tx, f, state), () => updateProcedure({ id: before.id, expectedUpdatedAt: before.updatedAt, caseNumber: "不会落库的旧请求" }));
    expect(result.error).toBeInstanceOf(Error);
    expect(await procedureVersion(before.id)).toEqual(before);
    expect(await db.auditLog.count({ where: { targetId: before.id, action: "PROCEDURE_UPDATE" } })).toBe(0);
  });

  it("确认和明确调整使用所见版本，旧页面不确认新值，已核期限继续受原重算保护", async () => {
    const f = await fixture(), pending = await pendingDeadline(f.procedure.id);
    await expect(assertDeadlineRecalcWritable([pending.id])).resolves.toBeUndefined();
    await confirmDeadline({ id: pending.id, expectedUpdatedAt: pending.updatedAt });
    const confirmed = await db.deadline.findUniqueOrThrow({ where: { id: pending.id } });
    expect(confirmed).toMatchObject({ confirmStatus: "CONFIRMED", dueAt: pending.dueAt });
    await expect(assertDeadlineRecalcWritable([pending.id])).rejects.toThrow("人工确认或调整");
    await expect(adjustDeadline({ id: pending.id, expectedUpdatedAt: pending.updatedAt, dueAt: new Date("2027-02-03T04:00:00Z"), reason: "旧页面" })).rejects.toThrow("期限已被修改");
    const nextDue = new Date("2027-02-02T04:00:00Z");
    await adjustDeadline({ id: pending.id, expectedUpdatedAt: confirmed.updatedAt, dueAt: nextDue, reason: "合成核实实际送达日期" });
    const adjusted = await db.deadline.findUniqueOrThrow({ where: { id: pending.id } });
    expect(adjusted).toMatchObject({ confirmStatus: "ADJUSTED", dueAt: nextDue, adjustedById: f.user.id });
    await expect(assertDeadlineRecalcWritable([pending.id])).rejects.toThrow("人工确认或调整");
    await expect(confirmDeadline({ id: pending.id, expectedUpdatedAt: confirmed.updatedAt })).rejects.toThrow("期限已被修改");
    const audit = await db.auditLog.findFirstOrThrow({ where: { targetId: pending.id, action: "DEADLINE_ADJUST" } });
    expect(audit.detail).toMatchObject({ previousDueAt: pending.dueAt.toISOString(), newDueAt: nextDue.toISOString(), reason: "合成核实实际送达日期" });
    expect(await db.deadline.findUniqueOrThrow({ where: { id: pending.id } })).toEqual(adjusted);
  });

  it.each(deniedStates.flatMap(state => ["confirm", "adjust"].map(action => ({ state, action }))))("期限 $action 遇 $state 先提交时不确认、不改期、不写审计", async ({ state, action }) => {
    const f = await fixture(state === "permission"), pending = await pendingDeadline(f.procedure.id);
    const result = await priorCommit(tx => revoke(tx, f, state), () => action === "confirm"
      ? confirmDeadline({ id: pending.id, expectedUpdatedAt: pending.updatedAt })
      : adjustDeadline({ id: pending.id, expectedUpdatedAt: pending.updatedAt, dueAt: new Date("2027-02-04T04:00:00Z"), reason: "排队期间已失效的请求" }));
    expect(result.error).toBeInstanceOf(Error);
    expect(await db.deadline.findUniqueOrThrow({ where: { id: pending.id } })).toEqual(pending);
    expect(await db.auditLog.count({ where: { targetId: pending.id, action: { in: ["DEADLINE_CONFIRM", "DEADLINE_ADJUST"] } } })).toBe(0);
  });
});
