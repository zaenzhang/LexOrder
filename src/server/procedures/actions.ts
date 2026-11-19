"use server";
import { Prisma } from "@prisma/client";
import {assertMatterReviewCurrent} from "@/server/conflicts/matter-review";
import {assertProcedureCovered} from "@/server/finance/ledger-contracts";
import { approvalTransaction } from "@/lib/approvals/service";
import { changeWorkTx,readWorkRows,responsibilityReady } from "@/server/reminders/responsibility";
import { roleMutation, checkRoleMutation } from "@/lib/roles/service";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { refreshScheduleReminderAfterSave, retireScheduleReminders } from "@/server/reminders/schedule";
import { audit, auditTx } from "@/server/audit";
import { lockWritableMatters } from "@/server/matters/write-access";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanHandleMatter, matterAssociationFilter } from "@/lib/permissions";
import { assertAgencyAllowedForProcedure, normalizeJurisdictionForAgency } from "@/lib/china-regions";
import {
  defaultStageNamesForProcedure,
  normalizeProcedureStageName,
  stagePresetForName
} from "@/lib/procedure-stage-defaults";
import {
  procedureCreateSchema,
  procedureUpdateSchema,
  procedureStageCreateSchema,
  procedureStageRemoveSchema,
  deadlineCreateSchema,
  hearingCreateSchema,
  type ProcedureCreateInput,
  type ProcedureUpdateInput,
  type ProcedureStageCreateInput,
  type ProcedureStageRemoveInput,
  type DeadlineCreateInput,
  type HearingCreateInput
} from "./schemas";
import { revalidateMatter } from "@/server/matters/route";
import { recordTimelineEvent } from "@/server/timeline/record";
import { shDayKey, civilFromKey, civilKey } from "@/lib/ui/sh-time";
import { computeDeadlineDate } from "@/lib/deadline-rules";
import { adjustDeadlineForHolidays } from "@/lib/calendar/holidays";
import { ActionError } from "@/lib/action-error";
import { assertPersonalProcedureOpen } from "./personal-schedule";
import { assertActualProcedureConclusion } from "./lifecycle";

function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === "" ? null : v;
  }
  return out as T;
}

// ============ Procedure ============

export async function addProcedure(input: ProcedureCreateInput) {
  const session = await requireSession("schedule.write");
  const data = procedureCreateSchema.parse(input);
  assertAgencyAllowedForProcedure(data.handlingAgency, data.type);

  const created = await prisma.$transaction(async tx => {
    const [matter] = await lockWritableMatters(tx, session.user, "schedule.write", [data.matterId]);
    if (data.engagement === "ENGAGED" && matter.status === "CLOSED") throw new ActionError("案件已结案，请先重新开启案件再新增受托程序");
    const lastOrder = await tx.matterProcedure.findFirst({
      where: { matterId: data.matterId }, orderBy: { order: "desc" }, select: { order: true }
    });
    const procedure = await tx.matterProcedure.create({ data: {
      matterId: data.matterId,
      type: data.type,
      customLabel: data.customLabel || null,
      engagement: data.engagement,
      order: (lastOrder?.order ?? 0) + 1,
      caseNumber: data.caseNumber || null,
      jurisdiction: normalizeJurisdictionForAgency(data.handlingAgency, data.jurisdiction),
      handlingAgency: data.handlingAgency || null,
      panel: data.panel || null,
      handler: data.handler || null,
      acceptedAt: data.acceptedAt,
      leadLawyerId: data.isExternalLead ? null : (data.leadLawyerId || null),
      isExternalLead: data.isExternalLead,
      status: "PENDING"
    } });
    await recordTimelineEvent(tx, {
      matterId: data.matterId,
      eventType: "PROCEDURE_ADDED",
      title: `新增程序：${procedure.customLabel ?? procedure.type}`,
      occurredAt: new Date(),
      refType: "MatterProcedure",
      refId: procedure.id
    });
    await auditTx(tx, { userId: session.user.id, action: "PROCEDURE_CREATE", targetType: "MatterProcedure",
      targetId: procedure.id, detail: { matterId: data.matterId, type: data.type } });
    return procedure;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 });

  await revalidateMatter(data.matterId);
  return { ok: true, id: created.id };
}

export async function updateProcedure(input: ProcedureUpdateInput) {
  const session = await requireSession("schedule.write");
  const data = procedureUpdateSchema.parse(input);
  const { id, expectedUpdatedAt, changeReason, ...rest } = data;

  const existing = await prisma.matterProcedure.findUnique({
    where: { id },
    select: { matterId: true }
  });
  if (!existing) throw new ActionError("程序不存在");

  // 状态转换门禁先于写入且整体原子（2026-09-20 A 批 P1-3）：事务内 FOR UPDATE 复读当前状态，
  // 首次进入办理时先核合同覆盖与动态冲突复核，条件更新带原状态；门禁失败零写入，
  // 重试不会因状态已落库而跳过首次启动判断。内置岗位与自定义角色走同一事务语义。
  const updated = await prisma.$transaction(async db => {
    const [matter] = await lockWritableMatters(db, session.user, "schedule.write", [existing.matterId]);
    await db.$queryRaw`SELECT id FROM "MatterProcedure" WHERE id = ${id} FOR UPDATE`;
    const current = await db.matterProcedure.findUnique({ where: { id }, select: {
      matterId: true, status: true, engagement: true, type: true, jurisdiction: true, handlingAgency: true,
      updatedAt: true, acceptedAt: true, concludedAt: true, outcome: true, outcomeNote: true
    } });
    if (!current) throw new ActionError("程序不存在");
    if (current.matterId !== existing.matterId) throw new ActionError("程序归属已变化，请刷新");
    if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ActionError("程序已被修改，请刷新后核对；当前输入尚未保存");
    assertAgencyAllowedForProcedure(rest.handlingAgency ?? current.handlingAgency, rest.type ?? current.type);
    const normalizedRest = { ...rest };
    if (rest.jurisdiction !== undefined || rest.handlingAgency !== undefined) {
      normalizedRest.jurisdiction = normalizeJurisdictionForAgency(
        rest.handlingAgency ?? current.handlingAgency, rest.jurisdiction ?? current.jurisdiction
      ) ?? "";
    }
    if (rest.status === "PENDING" && current.status !== "PENDING") throw new ActionError("已办理的程序不能改回未开始，请核对实际状态");
    if (rest.status === "CONCLUDED" && !rest.concludedAt) throw new ActionError("请填写程序实际终结日期");
    if (rest.concludedAt === null) throw new ActionError("终结日期不能直接清空；恢复办理请使用程序状态动作");
    if (rest.concludedAt && (rest.status !== undefined ? rest.status !== "CONCLUDED" : current.status !== "CONCLUDED")) throw new ActionError("请通过终结程序动作记录实际终结日期");
    if (rest.concludedAt) assertActualProcedureConclusion(rest.concludedAt, rest.acceptedAt ?? current.acceptedAt);
    else if (rest.acceptedAt && current.concludedAt && (rest.status ?? current.status) === "CONCLUDED") assertActualProcedureConclusion(current.concludedAt, rest.acceptedAt);
    if (rest.status === "IN_PROGRESS" && current.status !== "IN_PROGRESS") {
      if (current.status === "CONCLUDED" && !changeReason) throw new ActionError(current.engagement === "INFORMATIONAL" && !current.concludedAt ? "请说明核对后的程序状态" : "请说明恢复办理的原因");
      if (current.engagement === "ENGAGED") {
        if (matter.status === "CLOSED") throw new ActionError("案件已结案，请先重新开启案件再恢复办理程序");
        await assertProcedureCovered(db, id);
        await assertMatterReviewCurrent(db, current.matterId);
      }
      normalizedRest.concludedAt = null;
      // The old conclusion remains in this transition's audit record.
    }
    const mutation = emptyToNull(normalizedRest) as Prisma.MatterProcedureUpdateManyMutationInput;
    if (rest.status === "IN_PROGRESS" && current.status === "CONCLUDED") {
      mutation.outcome = null;
      mutation.outcomeNote = null;
    }
    const result = await db.matterProcedure.updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data: mutation });
    if (result.count === 0) throw new ActionError("程序状态已变化，请刷新后重试");
    await auditTx(db, { userId: session.user.id, action: "PROCEDURE_UPDATE", targetType: "MatterProcedure", targetId: id,
      detail: { matterId: current.matterId, fromStatus: current.status, toStatus: rest.status ?? current.status,
        previousConcludedAt: current.concludedAt?.toISOString() ?? null, previousOutcome: current.outcome,
        previousOutcomeNote: current.outcomeNote, concludedAt: normalizedRest.concludedAt === undefined ? current.concludedAt?.toISOString() ?? null : normalizedRest.concludedAt?.toISOString() ?? null,
        reason: changeReason ?? null } });
    return { matterId: current.matterId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 });

  await revalidateMatter(updated.matterId);
  return { ok: true };
}

export async function deleteProcedure(id: string) {
  const session = await requireSession("schedule.write");
  const reference = await prisma.matterProcedure.findUnique({ where: { id }, select: { matterId: true } });
  if (!reference) return { ok: false };
  const deleted = await approvalTransaction(async tx => {
    await lockWritableMatters(tx, session.user, "schedule.write", [reference.matterId], true);
    await tx.$queryRaw`SELECT id FROM "MatterProcedure" WHERE id=${id} FOR UPDATE`;
    const procedure = await tx.matterProcedure.findFirst({ where: { id, matterId: reference.matterId },
      include: { _count: { select: { stages: true, deadlines: true, hearings: true, documents: true, procedureParties: true, memos: true, billingScopes: true } } } });
    if (!procedure) return false;
    const [uploadIntents, audits, events] = await Promise.all([
      tx.materialIngestIntent.count({ where: { matterId: reference.matterId, metadata: { path: ["document", "procedureId"], equals: id } } }),
      tx.auditLog.count({ where: { action: { not: "PROCEDURE_CREATE" }, OR: [{ targetType: "MatterProcedure", targetId: id }, { detail: { path: ["procedureId"], equals: id } }] } }),
      tx.timelineEvent.count({ where: { matterId: reference.matterId, refType: "MatterProcedure", refId: id, eventType: { not: "PROCEDURE_ADDED" } } })
    ]);
    if (Object.values(procedure._count).some(count => count > 0) || uploadIntents || audits || events ||
        procedure.status !== "PENDING" || procedure.caseNumber || procedure.acceptedAt || procedure.concludedAt || procedure.outcome || procedure.outcomeNote ||
        procedure.handlingAgency || procedure.jurisdiction || procedure.panel || procedure.handler || procedure.presidingJudge || procedure.presidingJudgeContact ||
        procedure.judgeAssistant || procedure.judgeAssistantContact || procedure.ourStanding) {
      throw new ActionError("该程序已有业务或历史记录，不能删除；已取消、隐藏及未完成上传的记录也需保留");
    }
    await tx.matterProcedure.delete({ where: { id } });
    await auditTx(tx, { userId: session.user.id, action: "PROCEDURE_DELETE", targetType: "MatterProcedure", targetId: id, detail: { matterId: reference.matterId } });
    return true;
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  if (!deleted) return { ok: false };
  await revalidateMatter(reference.matterId);
  return { ok: true };
}

// ============ Procedure Stage ============

async function materializeProcedureStage(
  input: ProcedureStageCreateInput,
  options: { allowExisting: boolean }
) {
  const session = await requireSession("schedule.write");
  const data = procedureStageCreateSchema.parse(input);

  const procedure = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { matterId: true, type: true }
  });
  if (!procedure) throw new ActionError("程序不存在");

  const targetName = data.name.trim();
  const normalizedTarget = normalizeProcedureStageName(targetName);
  const result = await approvalTransaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "schedule.write");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${session.user.id} FOR SHARE`;
    const user = await tx.user.findUnique({ where: { id: session.user.id }, select: { active: true, role: true } });
    if (!user?.active || user.role !== session.user.role) throw new ActionError("账号或岗位已变化，请刷新后重试");
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${procedure.matterId} FOR UPDATE`;
    // The existing writable-matter guard also requires principal lawyers to be associated with this matter.
    const matter = await tx.matter.findFirst({ where: { id: procedure.matterId, deletedAt: null,
      ...matterAssociationFilter(session.user.id) }, select: { status: true } });
    if (!matter) throw new ActionError("案件不存在或无权处理");
    if (matter.status === "ARCHIVED") throw new ActionError("案件已归档，禁止修改");
    await tx.$queryRaw`SELECT id FROM "MatterProcedure" WHERE id=${data.procedureId} FOR UPDATE`;
    const lockedProcedure = await tx.matterProcedure.findFirst({ where: { id: data.procedureId, matterId: procedure.matterId }, select: { type: true } });
    if (!lockedProcedure) throw new ActionError("程序不存在或已变化");
    const record = async (value: { stage: { id: string; name: string; order: number }; created: boolean; revived: boolean; materializedCount: number }) => {
      if (value.created || value.revived) {
        await recordTimelineEvent(tx, { matterId: procedure.matterId, eventType: "STAGE_ADDED",
          title: value.revived ? `恢复环节：${value.stage.name}` : `新增环节：${value.stage.name}`,
          occurredAt: new Date(), refType: "MatterStage", refId: value.stage.id });
        await auditTx(tx, { userId: session.user.id, action: "MATTER_STAGE_CREATE", targetType: "MatterStage",
          targetId: value.stage.id, detail: { matterId: procedure.matterId, procedureId: data.procedureId, materializedCount: value.materializedCount } });
      }
      return value;
    };
    const existingStages = await tx.matterStage.findMany({
      where: { procedureId: data.procedureId },
      orderBy: { order: "asc" },
      select: { id: true, name: true, order: true, status: true }
    });
    const existing = existingStages.find((stage) => normalizeProcedureStageName(stage.name) === normalizedTarget);

    if (existing) {
      // v0.48: 隐藏的环节重新添加时恢复为 ACTIVE（数据未删，直接复用）
      if (existing.status === "HIDDEN") {
        const revived = await tx.matterStage.update({
          where: { id: existing.id },
          data: { status: "ACTIVE" },
          select: { id: true, name: true, order: true }
        });
        return record({ stage: revived, created: false, revived: true, materializedCount: 0 });
      }
      if (options.allowExisting) {
        return record({ stage: existing, created: false, revived: false, materializedCount: 0 });
      }
      throw new ActionError("该环节已存在");
    }

    if (existingStages.length === 0) {
      const names = [...defaultStageNamesForProcedure(lockedProcedure.type)];
      if (!names.some((name) => normalizeProcedureStageName(name) === normalizedTarget)) {
        const insertionIndex = insertionIndexForNames(names, data);
        names.splice(insertionIndex, 0, targetName);
      }

      let targetStage: { id: string; name: string; order: number } | null = null;
      let order = 0;
      for (const name of names) {
        order += 1;
        const created = await tx.matterStage.create({
          data: {
            procedureId: data.procedureId,
            name,
            description: normalizeProcedureStageName(name) === normalizedTarget ? data.description || null : null,
            order
          },
          select: { id: true, name: true, order: true }
        });
        if (normalizeProcedureStageName(name) === normalizedTarget) {
          targetStage = created;
        }
      }

      if (!targetStage) throw new ActionError("环节创建失败");
      return record({ stage: targetStage, created: true, revived: false, materializedCount: names.length });
    }

    const insertOrder = nextStageOrder(existingStages, data);
    await tx.matterStage.updateMany({
      where: { procedureId: data.procedureId, order: { gte: insertOrder } },
      data: { order: { increment: 1 } }
    });

    const created = await tx.matterStage.create({
      data: {
        procedureId: data.procedureId,
        name: targetName,
        description: data.description || null,
        order: insertOrder
      },
      select: { id: true, name: true, order: true }
    });
    return record({ stage: created, created: true, revived: false, materializedCount: 1 });
  }, Prisma.TransactionIsolationLevel.ReadCommitted);

  if (result.created || result.revived) {
    await revalidateMatter(procedure.matterId);
  }

  return { ok: true, id: result.stage.id, created: result.created };
}

export async function createProcedureStage(input: ProcedureStageCreateInput) {
  return materializeProcedureStage(input, { allowExisting: false });
}

export async function ensureProcedureStage(input: ProcedureStageCreateInput) {
  return materializeProcedureStage(input, { allowExisting: true });
}

function insertionIndexForNames(names: string[], data: ProcedureStageCreateInput) {
  if (data.insertPosition === "START") return 0;
  if (data.insertPosition !== "AFTER") return names.length;
  const afterName = data.insertAfterStageName?.trim();
  if (!afterName) return names.length;
  const normalizedAfterName = normalizeProcedureStageName(afterName);
  const afterIndex = names.findIndex((name) => normalizeProcedureStageName(name) === normalizedAfterName);
  return afterIndex >= 0 ? afterIndex + 1 : names.length;
}

function nextStageOrder(
  stages: { id: string; name: string; order: number; status?: string }[],
  data: ProcedureStageCreateInput
) {
  if (data.insertPosition === "START") return 1;
  if (data.insertPosition === "AFTER") {
    const afterStage = data.insertAfterStageId
      ? stages.find((stage) => stage.id === data.insertAfterStageId)
      : stages.find(
          (stage) =>
            data.insertAfterStageName &&
            normalizeProcedureStageName(stage.name) === normalizeProcedureStageName(data.insertAfterStageName)
        );
    if (afterStage) return afterStage.order + 1;
  }
  return (stages[stages.length - 1]?.order ?? 0) + 1;
}

export async function removeProcedureStage(input: ProcedureStageRemoveInput) {
  const session = await requireSession("schedule.write");
  const data = procedureStageRemoveSchema.parse(input);
  const reference = await prisma.matterStage.findUnique({ where: { id: data.id },
    select: { procedureId: true, procedure: { select: { matterId: true } } } });
  if (!reference) return { ok: false };

  const result = await approvalTransaction(async tx => {
    await checkRoleMutation(tx, session.user, "schedule.write");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${session.user.id} FOR SHARE`;
    const user = await tx.user.findUnique({ where: { id: session.user.id }, select: { active: true, role: true } });
    if (!user?.active || user.role !== session.user.role) throw new ActionError("账号或岗位已变化，请刷新后重试");
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${reference.procedure.matterId} FOR UPDATE`;
    const matter = await tx.matter.findFirst({ where: { id: reference.procedure.matterId, deletedAt: null,
      ...matterAssociationFilter(session.user.id) }, select: { status: true } });
    if (!matter) throw new ActionError("案件不存在或无权处理");
    if (matter.status === "ARCHIVED") throw new ActionError("案件已归档，禁止修改");
    await tx.$queryRaw`SELECT id FROM "MatterProcedure" WHERE id=${reference.procedureId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "MatterStage" WHERE id=${data.id} FOR UPDATE`;
    const stage = await tx.matterStage.findFirst({ where: { id: data.id, procedureId: reference.procedureId,
      procedure: { matterId: reference.procedure.matterId } }, include: { procedure: { select: { type: true } }, _count: { select: { tasks: true } } } });
    if (!stage) return null;
    if (stage.status === "HIDDEN") return { hidden: true, changed: false };
    if (stagePresetForName(stage.procedure.type, stage.name)?.kind === "required") throw new ActionError("必备环节不能移除");

    // Count historical documents and reserved uploads as well as committed work.
    // Task and ingest writes use the same transaction lock, so a concurrent write
    // cannot be detached by an out-of-date empty-stage decision.
    const [documents, preservationRecords, uploadIntents] = await Promise.all([
      tx.document.count({ where: { stageId: stage.id } }),
      stage.name.includes("保全") ? tx.preservationCase.count({ where: { matterId: reference.procedure.matterId } }) : Promise.resolve(0),
      tx.materialIngestIntent.count({ where: { matterId: reference.procedure.matterId, metadata: { path: ["document", "stageId"], equals: stage.id } } })
    ]);
    const hidden = stage._count.tasks > 0 || documents > 0 || preservationRecords > 0 || uploadIntents > 0;
    if (hidden) await tx.matterStage.update({ where: { id: stage.id }, data: { status: "HIDDEN" } });
    else {
      await tx.matterStage.delete({ where: { id: stage.id } });
      await tx.matterStage.updateMany({ where: { procedureId: stage.procedureId, order: { gt: stage.order } }, data: { order: { decrement: 1 } } });
    }
    await recordTimelineEvent(tx, { matterId: reference.procedure.matterId, eventType: "STAGE_REMOVED",
      title: hidden ? `隐藏环节：${stage.name}（数据保留）` : `移除环节：${stage.name}`,
      occurredAt: new Date(), refType: "MatterStage", refId: stage.id });
    await auditTx(tx, { userId: session.user.id, action: hidden ? "MATTER_STAGE_HIDE" : "MATTER_STAGE_REMOVE",
      targetType: "MatterStage", targetId: stage.id, detail: { matterId: reference.procedure.matterId,
        procedureId: stage.procedureId, tasks: stage._count.tasks, documents, preservationRecords, uploadIntents } });
    return { hidden, changed: true };
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  if (!result) return { ok: false };
  if (result.changed) await revalidateMatter(reference.procedure.matterId);
  return { ok: true, hidden: result.hidden };
}

// ============ Deadline ============

export async function addDeadline(input: DeadlineCreateInput) {
  const session = await requireSession("schedule.write");
  const data = deadlineCreateSchema.parse(input);

  const procedureForGuard = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { matterId: true }
  });
  if (!procedureForGuard) throw new ActionError("程序不存在");
  await assertCanHandleMatter(session.user, procedureForGuard.matterId);
  await assertMatterWritable(procedureForGuard.matterId);

  // 第六轮体检 P2-1：规则生成的期限此前日期值系统自己没算过也没验过。服务端按
  // sourceTriggerDate + 规则重算（上海日历口径，civilFromKey 本地正午载体与
  // 生产客户端同一套 civil 算法，时区无关），与提交值不一致不拒绝（允许人工调整
  // ——表单明示「可再人工调整」），但在 basis 追加提示，确认律师核对时可见。
  let basis = data.basis || null;
  if (data.sourceRuleId && data.sourceTriggerDate) {
    const rule = await prisma.deadlineRule.findUnique({
      where: { id: data.sourceRuleId },
      select: { name: true, periodValue: true, periodUnit: true }
    });
    if (rule) {
      const rawKey = civilKey(computeDeadlineDate(
        civilFromKey(shDayKey(data.sourceTriggerDate)), rule.periodValue, rule.periodUnit
      ));
      // 读取故障必须在写入前中止；年度未录入则保留人工日期与待核对提示。
      const adjusted = await adjustDeadlineForHolidays(rawKey);
      const submittedKey = shDayKey(data.dueAt);
      let note = "";
      if (adjusted.status === "UNCONFIGURED") {
        note = `；系统按规则「${rule.name}」计算基础日期为 ${rawKey}；${adjusted.missingYears.join("、")} 年放假安排未录入，未完成休假日顺延核对。保留提交日期 ${submittedKey}，请人工核对`;
      } else if (adjusted.key !== submittedKey) {
        // 口径＝提示，不改写 dueAt（第七轮体检 P2-3）：法定休假日顺延在个案中
        // 可能有例外（法院指定期间、当事人另有约定），系统不替律师改日期，
        // 只给出建议值由律师核对后自行调整。文案据此写「建议顺延至」而非「已顺延至」。
        note = adjusted.adjusted
          ? `；系统按规则「${rule.name}」重算为 ${rawKey}，建议按放假安排顺延至 ${adjusted.key}（${adjusted.reason}），与提交日期 ${submittedKey} 不一致，请核对后自行调整`
          : `；系统按规则「${rule.name}」重算为 ${rawKey}，与提交日期 ${submittedKey} 不一致，请核对`;
      }
      if (note) {
        // 截断保护警告本身：此前 `${basis}${note}`.slice(0,300) 从尾部截，
        // 恰好把最该被看见的不一致提示切掉。改为优先保留 note，截原 basis 尾部。
        const LIMIT = 300;
        basis = note.length >= LIMIT
          ? note.slice(0, LIMIT)
          : `${(basis ?? "").slice(0, LIMIT - note.length)}${note}`;
      }
    }
  }

  const insertDeadline = (db: Prisma.TransactionClient) => db.deadline.create({
    data: {
      procedureId: data.procedureId,
      title: data.title,
      category: data.category,
      dueAt: data.dueAt,
      duePrecision: data.duePrecision,
      basis,
      remindDays: data.remindDays,
      // v1.x P0-8: 带来源规则的期限为"待确认"（律师核对起算事实后确认）；
      // 人工录入的期限由录入者负责，直接视为已确认。
      sourceRuleId: data.sourceRuleId || null,
      startFact: data.startFact || null,
      sourceDocumentId: data.sourceDocumentId || null,
      confirmStatus: data.sourceRuleId ? "PENDING" : "CONFIRMED"
    }
  });
  const created = session.user.runtimeMode === "PERSONAL"
    ? await approvalTransaction(async db => {
      await lockWritableMatters(db, session.user, "schedule.write", [procedureForGuard.matterId]);
      await assertPersonalProcedureOpen(db, procedureForGuard.matterId, data.procedureId);
      return insertDeadline(db);
    }, Prisma.TransactionIsolationLevel.ReadCommitted)
    : await roleMutation(session.user, "schedule.write", insertDeadline);

  const procedure = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { matterId: true }
  });

  if (procedure) {
    await audit({
      userId: session.user.id,
      action: "DEADLINE_CREATE",
      targetType: "Deadline",
      targetId: created.id,
      detail: { matterId: procedure.matterId, procedureId: data.procedureId, dueAt: data.dueAt.toISOString(), duePrecision: data.duePrecision }
    });
    // v0.43 项4：写入案件动态时间线
    await roleMutation(session.user, "schedule.write", async roleDb => recordTimelineEvent(roleDb, {
        matterId: procedure.matterId,
        eventType: "DEADLINE_ADDED",
        title: `新增期限：${data.title}`,
        occurredAt: new Date(),
        refType: "Deadline",
        refId: created.id
      }));
    await revalidateMatter(procedure.matterId);
  }

  await refreshScheduleReminderAfterSave("Deadline", created.id);
  return { ok: true, id: created.id };
}

export async function toggleDeadlineCompleted(id: string) {
  const session = await requireSession("schedule.write");
  const current = await prisma.deadline.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!current) return { ok: false };
  await assertCanHandleMatter(session.user, current.procedure.matterId);
  await assertMatterWritable(current.procedure.matterId);

  if(await responsibilityReady(prisma)){
    if(current.completed)throw new ActionError("重新办理请从事项责任面板填写原因");
    await approvalTransaction(async db=>{const w=(await readWorkRows(db)).find(w=>w.kind==='Deadline'&&w.targetId===id);if(!w)throw new ActionError('事项责任缺失');await changeWorkTx(db,session.user.id,{id:w.id,revision:w.revision,action:'COMPLETE',reason:'经办通过完成操作确认已办结'});});
    await revalidateMatter(current.procedure.matterId);return {ok:true};
  }
  const next = !current.completed;
  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "schedule.write");
    await tx.deadline.update({ where: { id }, data: { completed: next, completedAt: next ? new Date() : null } });
    if (next) await retireScheduleReminders(tx, "Deadline", id, new Date(), "CANCELLED");
  });
  if (!next) await refreshScheduleReminderAfterSave("Deadline", id);

  await audit({
    userId: session.user.id,
    action: next ? "DEADLINE_COMPLETE" : "DEADLINE_REOPEN",
    targetType: "Deadline",
    targetId: id
  });

  await revalidateMatter(current.procedure.matterId);
  return { ok: true };
}

export async function deleteDeadline(id: string) {
  if(await responsibilityReady(prisma))throw new ActionError("请在事项责任面板取消期限并填写原因，原记录保留");
  const session = await requireSession("schedule.write");
  const current = await prisma.deadline.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!current) return { ok: false };
  await assertCanHandleMatter(session.user, current.procedure.matterId);
  await assertMatterWritable(current.procedure.matterId);

  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "schedule.write");
    await tx.deadline.delete({ where: { id } });
    await retireScheduleReminders(tx, "Deadline", id, new Date(), "CANCELLED");
  });
  await audit({
    userId: session.user.id,
    action: "DEADLINE_DELETE",
    targetType: "Deadline",
    targetId: id
  });
  await revalidateMatter(current.procedure.matterId);
  return { ok: true };
}

// ============ Hearing ============

export async function addHearing(input: HearingCreateInput) {
  const session = await requireSession("schedule.write");
  const data = hearingCreateSchema.parse(input);

  const procedureForGuard = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { matterId: true }
  });
  if (!procedureForGuard) throw new ActionError("程序不存在");
  await assertCanHandleMatter(session.user, procedureForGuard.matterId);
  await assertMatterWritable(procedureForGuard.matterId);

  const created = await roleMutation(session.user, "schedule.write", async roleDb => roleDb.hearing.create({
    data: {
      procedureId: data.procedureId,
      title: data.title,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      room: data.room || null,
      address: data.address || null,
      judge: data.judge || null,
      contact: data.contact || null,
      notes: data.notes || null
    }
  }));

  const procedure = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { matterId: true }
  });

  if (procedure) {
    await roleMutation(session.user, "schedule.write", async roleDb => recordTimelineEvent(roleDb, {
        matterId: procedure.matterId,
        eventType: "HEARING_SCHEDULED",
        title: `开庭：${data.title}`,
        occurredAt: data.startsAt,
        refType: "Hearing",
        refId: created.id
      }));

    await audit({
      userId: session.user.id,
      action: "HEARING_CREATE",
      targetType: "Hearing",
      targetId: created.id,
      detail: { matterId: procedure.matterId, procedureId: data.procedureId }
    });
    await revalidateMatter(procedure.matterId);
  }

  await refreshScheduleReminderAfterSave("Hearing", created.id);
  return { ok: true, id: created.id };
}

export async function deleteHearing(id: string) {
  if(await responsibilityReady(prisma))throw new ActionError("请在事项责任面板取消开庭并填写原因，原记录保留");
  const session = await requireSession("schedule.write");
  const current = await prisma.hearing.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!current) return { ok: false };
  await assertCanHandleMatter(session.user, current.procedure.matterId);
  await assertMatterWritable(current.procedure.matterId);

  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "schedule.write");
    await tx.hearing.delete({ where: { id } });
    await retireScheduleReminders(tx, "Hearing", id, new Date(), "CANCELLED");
  });
  await audit({
    userId: session.user.id,
    action: "HEARING_DELETE",
    targetType: "Hearing",
    targetId: id
  });
  await revalidateMatter(current.procedure.matterId);
  return { ok: true };
}

// ============ ProcedureMemo（v0.42 备忘录）============

export async function addProcedureMemo(input: {
  procedureId: string;
  content: string;
}) {
  const session = await requireSession("schedule.write");
  const content = input.content.trim();
  if (!content) throw new ActionError("备忘内容不能为空");
  if (content.length > 1000) throw new ActionError("备忘内容过长（≤1000字）");

  const proc = await prisma.matterProcedure.findUnique({
    where: { id: input.procedureId },
    select: { matterId: true }
  });
  if (!proc) throw new ActionError("程序不存在");
  const created = await approvalTransaction(async tx => {
    await lockWritableMatters(tx, session.user, "schedule.write", [proc.matterId]);
    await tx.$queryRaw`SELECT id FROM "MatterProcedure" WHERE id=${input.procedureId} FOR UPDATE`;
    if (!await tx.matterProcedure.findFirst({ where: { id: input.procedureId, matterId: proc.matterId }, select: { id: true } })) throw new ActionError("程序不存在或已变化");
    const memo = await tx.procedureMemo.create({ data: { procedureId: input.procedureId, content, createdById: session.user.id } });
    await auditTx(tx, { userId: session.user.id, action: "PROCEDURE_MEMO_CREATE", targetType: "ProcedureMemo", targetId: memo.id,
      detail: { matterId: proc.matterId, procedureId: input.procedureId } });
    return memo;
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  await revalidateMatter(proc.matterId);
  return { ok: true, id: created.id };
}

export async function toggleProcedureMemo(id: string) {
  const session = await requireSession("schedule.write");
  const current = await prisma.procedureMemo.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!current) return { ok: false };
  await approvalTransaction(async tx => {
    await lockWritableMatters(tx, session.user, "schedule.write", [current.procedure.matterId]);
    await tx.$queryRaw`SELECT id FROM "MatterProcedure" WHERE id=${current.procedureId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ProcedureMemo" WHERE id=${id} FOR UPDATE`;
    const memo = await tx.procedureMemo.findFirst({ where: { id, procedureId: current.procedureId, procedure: { matterId: current.procedure.matterId } }, select: { done: true } });
    if (!memo) throw new ActionError("备忘不存在或已变化");
    const next = !memo.done;
    await tx.procedureMemo.update({ where: { id }, data: { done: next, doneAt: next ? new Date() : null } });
    await auditTx(tx, { userId: session.user.id, action: next ? "PROCEDURE_MEMO_COMPLETE" : "PROCEDURE_MEMO_REOPEN", targetType: "ProcedureMemo", targetId: id,
      detail: { matterId: current.procedure.matterId, procedureId: current.procedureId } });
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  await revalidateMatter(current.procedure.matterId);
  return { ok: true };
}

export async function deleteProcedureMemo(id: string) {
  const session = await requireSession("schedule.write");
  const current = await prisma.procedureMemo.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!current) return { ok: false };
  await approvalTransaction(async tx => {
    await lockWritableMatters(tx, session.user, "schedule.write", [current.procedure.matterId]);
    await tx.$queryRaw`SELECT id FROM "MatterProcedure" WHERE id=${current.procedureId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ProcedureMemo" WHERE id=${id} FOR UPDATE`;
    if (!await tx.procedureMemo.findFirst({ where: { id, procedureId: current.procedureId, procedure: { matterId: current.procedure.matterId } }, select: { id: true } })) throw new ActionError("备忘不存在或已变化");
    await tx.procedureMemo.delete({ where: { id } });
    await auditTx(tx, { userId: session.user.id, action: "PROCEDURE_MEMO_DELETE", targetType: "ProcedureMemo", targetId: id,
      detail: { matterId: current.procedure.matterId, procedureId: current.procedureId } });
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  await revalidateMatter(current.procedure.matterId);
  return { ok: true };
}
