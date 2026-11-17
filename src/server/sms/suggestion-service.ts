import { Prisma, type SmsSuggestion } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/action-error";
import type { WorkspaceActor } from "@/lib/runtime/actor";
import { checkRoleMutation } from "@/lib/roles/service";
import { matterAssociationFilter } from "@/lib/permissions";
import { canReadDocument } from "@/lib/approvals/documents";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { smsDecisionInput, savedSmsDecision, suggestionPayload, type SmsDecisionInput, type SmsDecisionResult } from "@/lib/sms/suggestions";
import { auditTx } from "@/server/audit";
import { recordTimelineEvent } from "@/server/timeline/record";

export type SmsActor = WorkspaceActor & { sessionVersion: number };
type Tx = Prisma.TransactionClient;
type Decision = ReturnType<typeof smsDecisionInput.parse>;
type Choice = NonNullable<Decision["items"][number]["event"]>;

export async function smsActor(): Promise<SmsActor> {
  const initial = await requireSession("matters.write");
  const baseline = await prisma.user.findUnique({ where: { id: initial.user.id }, select: { sessionVersion: true } });
  // Validate the real session after capturing its version, outside the transaction connection.
  const current = await requireSession("matters.write");
  if (!baseline || current.user.id !== initial.user.id) throw new ActionError("登录状态已变化，请重新打开来件");
  return { ...current.user, sessionVersion: baseline.sessionVersion };
}

/** Shared authorization lock first; callers use ReadCommitted to see a preceding revocation. */
export async function lockSmsActor(tx: Tx, actor: SmsActor) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, sessionVersion: true } });
  if (!user?.active || user.role !== actor.role || user.sessionVersion !== actor.sessionVersion) throw new ActionError("账号、岗位或登录状态已变化，请重新打开来件");
  await checkRoleMutation(tx, actor, "matters.write");
}

async function lockMatter(tx: Tx, actor: SmsActor, matterId: string) {
  await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${matterId} FOR UPDATE`;
  const matter = await tx.matter.findFirst({ where: {
    id: matterId, deletedAt: null, ...(actor.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(actor.id)),
  }, select: { id: true, status: true } });
  if (!matter) throw new ActionError("案件不存在或当前无权办理");
  if (matter.status === "ARCHIVED") throw new ActionError("案件已归档，不能处理来件建议");
}

/** All entry points lock in authorization → matter → incoming message order. */
export async function lockSms(tx: Tx, actor: SmsActor, smsId: string, extraMatterIds: string[] = []) {
  await lockSmsActor(tx, actor);
  const before = await tx.smsMessage.findUnique({ where: { id: smsId }, select: { receivedById: true, matchedMatterId: true } });
  if (!before) throw new ActionError("来件不存在");
  if (before.receivedById !== actor.id && !before.matchedMatterId) throw new ActionError("只能处理本人收到的未匹配来件");
  const matters = [...new Set([before.matchedMatterId, ...extraMatterIds].filter((id): id is string => Boolean(id)))].sort();
  for (const id of matters) await lockMatter(tx, actor, id);
  await tx.$queryRaw`SELECT id FROM "SmsMessage" WHERE id=${smsId} FOR UPDATE`;
  const sms = await tx.smsMessage.findUniqueOrThrow({ where: { id: smsId } });
  if (sms.matchedMatterId !== before.matchedMatterId || sms.receivedById !== before.receivedById) throw new ActionError("来件归属已变化，请刷新后核对");
  return sms;
}

async function assertSource(tx: Tx, actor: SmsActor, row: SmsSuggestion, matterId: string | null) {
  if (!row.fileId) return;
  await tx.$queryRaw`SELECT id FROM "SmsInboundFile" WHERE id=${row.fileId} FOR SHARE`;
  const file = await tx.smsInboundFile.findUnique({ where: { id: row.fileId }, include: { document: true } });
  if (!file || file.smsId !== row.smsId || file.state === "SUPERSEDED" || file.state === "FAILED") throw new ActionError("建议来源文件已变化或不可用，请重新核对");
  if (file.document && (file.document.deletedAt || file.document.matterId !== matterId || !await canReadDocument(actor.id, file.document, tx))) throw new ActionError("当前不能读取此建议的来源材料");
}

export function eventDate(dateText: string, timeText: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) throw new ActionError("请核对事项日期与实际时刻");
  const [hour, minute] = timeText.split(":").map(Number);
  const value = new Date(`${dateText}T${timeText}:00+08:00`);
  if (hour > 23 || minute > 59 || Number.isNaN(value.getTime()) || shDayKey(value) !== dateText || shTime(value) !== timeText) throw new ActionError("事项日期或时刻无效，请核对原文");
  return value;
}

async function lockProcedure(tx: Tx, matterId: string, procedureId: string) {
  await tx.$queryRaw`SELECT id FROM "MatterProcedure" WHERE id=${procedureId} FOR UPDATE`;
  const procedure = await tx.matterProcedure.findUnique({ where: { id: procedureId } });
  if (!procedure || procedure.matterId !== matterId || procedure.engagement !== "ENGAGED") throw new ActionError("请选择本案当前实际代理的程序");
  return procedure;
}

/** Date/time comparison is against real structured source data, never against a guessed default. */
function assertLinkedEvent(row: SmsSuggestion, at: Date) {
  const payload = suggestionPayload(row.payload);
  const sourceDay = typeof payload.dateText === "string" ? payload.dateText.trim() : "";
  if (!sourceDay || shDayKey(at) !== sourceDay) throw new ActionError("所选事项日期与建议原文不一致，请核对后再关联");
  const sourceTime = typeof payload.timeText === "string" ? payload.timeText.trim() : "";
  if (sourceTime && shTime(at) !== sourceTime) throw new ActionError("所选事项时刻与建议原文不一致，请核对后再关联");
}

async function applyEvent(tx: Tx, row: SmsSuggestion, matterId: string, choice: Choice): Promise<Omit<SmsDecisionResult, "replayed">> {
  await lockProcedure(tx, matterId, choice.procedureId);
  const type = row.kind === "HEARING" ? "Hearing" : "Deadline";
  if (choice.mode === "LINK") {
    if (type === "Hearing") await tx.$queryRaw`SELECT id FROM "Hearing" WHERE id=${choice.targetId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Deadline" WHERE id=${choice.targetId} FOR UPDATE`;
    const target = type === "Hearing"
      ? await tx.hearing.findUnique({ where: { id: choice.targetId }, select: { id: true, procedureId: true, updatedAt: true, startsAt: true } })
      : await tx.deadline.findUnique({ where: { id: choice.targetId }, select: { id: true, procedureId: true, updatedAt: true, dueAt: true } });
    if (!target || target.procedureId !== choice.procedureId) throw new ActionError("所选事项不属于当前程序或已经不存在");
    if (target.updatedAt.getTime() !== choice.expectedTargetUpdatedAt.getTime()) throw new ActionError("所选事项已被修改，请重新读取后核对");
    assertLinkedEvent(row, "startsAt" in target ? target.startsAt : target.dueAt);
    return { suggestionId: row.id, outcome: "LINKED", targetType: type, targetId: target.id, matterId };
  }
  const at = eventDate(choice.dateText, choice.timeText);
  const duplicate = type === "Hearing"
    ? await tx.hearing.findFirst({ where: { procedureId: choice.procedureId, title: choice.title, startsAt: at }, select: { id: true } })
    : await tx.deadline.findFirst({ where: { procedureId: choice.procedureId, title: choice.title, dueAt: at }, select: { id: true } });
  if (duplicate) throw new ActionError("本程序已有同标题、同时间的事项，请核对后明确关联已有事项");
  // This is an explicit human input; preserve the original proposal in payload.
  const target = type === "Hearing"
    ? await tx.hearing.create({ data: { procedureId: choice.procedureId, title: choice.title, startsAt: at, notes: row.sourceExcerpt }, select: { id: true } })
    : await tx.deadline.create({ data: { procedureId: choice.procedureId, title: choice.title, category: "CUSTOM", dueAt: at, basis: `法院来件确认：${row.sourceExcerpt ?? "原文"}` }, select: { id: true } });
  // The standard database trigger creates responsibility and its notification exactly once.
  await recordTimelineEvent(tx, { matterId, eventType: type === "Hearing" ? "HEARING_ADDED" : "DEADLINE_ADDED", title: `来件确认：${choice.title}`, occurredAt: new Date(), refType: type, refId: target.id });
  return { suggestionId: row.id, outcome: "CREATED", targetType: type, targetId: target.id, matterId };
}

function requestFor(data: Decision, item: Decision["items"][number]) {
  const event = item.event?.mode === "LINK" ? { ...item.event, expectedTargetUpdatedAt: item.event.expectedTargetUpdatedAt.toISOString() } : item.event ?? null;
  return { decision: data.decision, expectedUpdatedAt: item.expectedUpdatedAt.toISOString(), expectedMatchedMatterId: data.expectedMatchedMatterId, event, note: data.note };
}

function sameRequest(stored: unknown, requested: ReturnType<typeof requestFor>) {
  const previous = suggestionPayload(stored);
  const event = suggestionPayload(previous.event);
  const next = suggestionPayload(requested.event);
  return previous.decision === requested.decision && previous.expectedUpdatedAt === requested.expectedUpdatedAt
    && previous.expectedMatchedMatterId === requested.expectedMatchedMatterId && previous.note === requested.note
    && (previous.event === null) === (requested.event === null)
    && ["mode", "procedureId", "targetId", "expectedTargetUpdatedAt", "title", "dateText", "timeText"].every(key => event[key] === next[key]);
}

export async function decideSmsSuggestionsTx(tx: Tx, actor: SmsActor, input: SmsDecisionInput) {
  const data = smsDecisionInput.parse(input);
  // Read only IDs needed to acquire the matter locks; all mutable data is read again below.
  const matches = data.decision === "ACCEPTED" ? await tx.smsSuggestion.findMany({ where: { id: { in: data.items.map(item => item.id) }, smsId: data.smsId, kind: "MATTER_MATCH" }, select: { targetId: true } }) : [];
  const matchTargets = [...new Set(matches.map(row => row.targetId).filter((id): id is string => Boolean(id)))];
  if (matchTargets.length > 1) throw new ActionError("本批指向不同案件，请逐条核对归属");
  const sms = await lockSms(tx, actor, data.smsId, matchTargets);
  for (const id of data.items.map(item => item.id).sort()) await tx.$queryRaw`SELECT id FROM "SmsSuggestion" WHERE id=${id} FOR UPDATE`;
  const rows = await tx.smsSuggestion.findMany({ where: { id: { in: data.items.map(item => item.id) } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (rows.length !== data.items.length || rows.some(row => row.smsId !== sms.id)) throw new ActionError("只能处理当前来件中存在的建议，请刷新");
  if (rows.some(row => row.kind === "DOC_TYPE")) throw new ActionError("文书分类是已记录信息，无需作为业务建议确认");
  if (rows.some(row => row.status === "PENDING") && sms.matchedMatterId !== data.expectedMatchedMatterId) throw new ActionError("来件归属已变化，请刷新后核对");
  const ordered = rows.sort((a, b) => Number(b.kind === "MATTER_MATCH") - Number(a.kind === "MATTER_MATCH"));
  const results: SmsDecisionResult[] = [];
  let matterId = sms.matchedMatterId;
  for (const row of ordered) {
    const item = data.items.find(item => item.id === row.id)!;
    if (data.decision === "ACCEPTED" && (row.kind === "HEARING" || row.kind === "DEADLINE")) {
      if (!item.event) throw new ActionError("请明确选择事件的程序及新建或关联方式");
      await checkRoleMutation(tx, actor, item.event.mode === "CREATE" ? "schedule.write" : "schedule.read");
    }
    const request = requestFor(data, item);
    const receipt = savedSmsDecision(row.payload);
    if (row.status !== "PENDING") {
      if (!receipt || row.status !== data.decision || !sameRequest(receipt.request, request)
        || receipt.result.suggestionId !== row.id
        || (data.decision === "ACCEPTED" && (receipt.result.targetId !== row.targetId || receipt.result.targetType !== row.targetType))) throw new ActionError("建议已处理；本次决定或所选目标不同，或历史未记录实际产物，请核对原记录");
      if (receipt.result.matterId && receipt.result.matterId !== matterId) throw new ActionError("已采纳建议的案件归属已变化，请核对历史");
      if (data.decision === "ACCEPTED") await assertSource(tx, actor, row, matterId);
      results.push({ ...receipt.result, replayed: true });
      continue;
    }
    if (row.updatedAt.getTime() !== item.expectedUpdatedAt.getTime()) throw new ActionError("建议内容已变化，请刷新后核对；本次未应用");
    if (data.decision === "ACCEPTED") await assertSource(tx, actor, row, matterId);
    let result: Omit<SmsDecisionResult, "replayed">;
    if (data.decision === "REJECTED") {
      if (item.event) throw new ActionError("拒绝建议时不提交创建或关联选择");
      result = { suggestionId: row.id, outcome: "REJECTED", targetType: null, targetId: null, matterId };
    } else if (row.kind === "MATTER_MATCH") {
      if (item.event || !row.targetId || !matchTargets.includes(row.targetId)) throw new ActionError("案件归属建议已变化，请重新核对");
      if (matterId && matterId !== row.targetId) throw new ActionError("来件已有其他案件归属，请先通过案件匹配入口核对");
      result = { suggestionId: row.id, outcome: matterId === row.targetId ? "UNCHANGED" : "UPDATED", targetType: "Matter", targetId: row.targetId, matterId: row.targetId };
      matterId = row.targetId;
      await tx.smsMessage.update({ where: { id: sms.id }, data: { matchedMatterId: matterId, matchedBy: "MANUAL" } });
    } else {
      if (!matterId) throw new ActionError("请先确认来件归属案件");
      if (row.kind === "HEARING" || row.kind === "DEADLINE") {
        if (!item.event) throw new ActionError("请明确选择事件的程序及新建或关联方式");
        result = await applyEvent(tx, row, matterId, item.event);
      } else {
        if (item.event || row.kind !== "FIELD_CHANGE" || !row.targetId || !row.fieldKey || !row.suggestedValue || !["caseNumber", "handlingAgency"].includes(row.fieldKey)) throw new ActionError("字段建议不完整或不受支持");
        const procedure = await lockProcedure(tx, matterId, row.targetId);
        const fieldKey = row.fieldKey as "caseNumber" | "handlingAgency";
        const current = procedure[fieldKey] ?? "";
        if (current !== row.suggestedValue && current !== (row.currentValue ?? "")) throw new ActionError("程序字段已被修改，请刷新并核对原值");
        const changed = current !== row.suggestedValue;
        if (changed) {
          await tx.matterProcedure.update({ where: { id: row.targetId }, data: { [fieldKey]: row.suggestedValue } });
          await recordTimelineEvent(tx, { matterId, eventType: "PROCEDURE_UPDATED", title: `来件确认修正${fieldKey === "caseNumber" ? "案号" : "法院"}`, occurredAt: new Date(), refType: "SmsSuggestion", refId: row.id });
        }
        result = { suggestionId: row.id, outcome: changed ? "UPDATED" : "UNCHANGED", targetType: "MatterProcedure", targetId: row.targetId, matterId };
      }
    }
    await tx.smsSuggestion.update({ where: { id: row.id }, data: {
      status: data.decision, decidedById: actor.id, decidedAt: new Date(),
      ...(data.decision === "ACCEPTED" ? { targetType: result.targetType, targetId: result.targetId } : {}),
      payload: { ...suggestionPayload(row.payload), decisionReceipt: { request, result } } as Prisma.InputJsonObject,
    } });
    await auditTx(tx, { userId: actor.id, action: data.decision === "ACCEPTED" ? "SMS_SUGGESTION_APPLIED" : "SMS_SUGGESTION_REJECTED", targetType: "SmsSuggestion", targetId: row.id,
      detail: { smsId: sms.id, request, result } });
    results.push({ ...result, replayed: false });
  }
  return { smsId: sms.id, matterId, results };
}

/** Called after optional filing I/O. Never hides unresolved files or manufactures decisions. */
export async function finishSmsSuggestionsTx(tx: Tx, actor: SmsActor, smsId: string) {
  const sms = await lockSms(tx, actor, smsId);
  const remainingSuggestions = await tx.smsSuggestion.count({ where: { smsId, status: "PENDING", kind: { not: "DOC_TYPE" } } });
  const remainingFiles = await tx.smsInboundFile.count({ where: { smsId, OR: [{ state: { in: ["PENDING_REVIEW", "FAILED"] } }, { state: "FILED", documentId: null }] } });
  const attachmentResults = suggestionPayload(sms.parsedJson).attachmentResults;
  const unresolvedFetch = Array.isArray(attachmentResults) && attachmentResults.some(result => !["DOWNLOADED", "ALREADY_DOWNLOADED"].includes(String(suggestionPayload(result).status)));
  const manualFetch = sms.needsManualAction || unresolvedFetch || ["PROCESSING", "NEEDS_MANUAL_FETCH"].includes(sms.processingState);
  const unresolved = remainingSuggestions > 0 || remainingFiles > 0 || manualFetch;
  const mayOrganize = Boolean(sms.matchedMatterId) && !unresolved && !sms.processed && sms.processingState !== "NO_ACTION_NEEDED";
  if (mayOrganize && sms.processingState !== "ORGANIZED") {
    await tx.smsMessage.update({ where: { id: smsId }, data: { processingState: "ORGANIZED" } });
    await auditTx(tx, { userId: actor.id, action: "SMS_ORGANIZED", targetType: "SmsMessage", targetId: smsId, detail: { remainingSuggestions, remainingFiles } });
  }
  if (sms.processingState === "ORGANIZED" && unresolved && !sms.processed) {
    const state = remainingFiles || manualFetch ? "PARTIAL" : "READY_FOR_REVIEW";
    await tx.smsMessage.update({ where: { id: smsId }, data: { processingState: state } });
    await auditTx(tx, { userId: actor.id, action: "SMS_REVIEW_REOPENED", targetType: "SmsMessage", targetId: smsId,
      detail: { remainingSuggestions, remainingFiles, needsManualFetch: manualFetch, state } });
  }
  return { remainingSuggestions, remainingFiles, needsManualFetch: manualFetch, processingNote: sms.processingNote, organized: !unresolved && (mayOrganize || sms.processingState === "ORGANIZED") };
}

export async function listSmsEventTargetsTx(tx: Tx, actor: SmsActor, input: { smsId: string; suggestionId: string; procedureId: string; query: string }) {
  const sms = await lockSms(tx, actor, input.smsId);
  await checkRoleMutation(tx, actor, "schedule.read");
  if (!sms.matchedMatterId) throw new ActionError("请先确认来件归属案件");
  const row = await tx.smsSuggestion.findFirst({ where: { id: input.suggestionId, smsId: sms.id, status: "PENDING", kind: { in: ["HEARING", "DEADLINE"] } } });
  if (!row) throw new ActionError("建议已处理或不存在，请刷新");
  await assertSource(tx, actor, row, sms.matchedMatterId);
  await lockProcedure(tx, sms.matchedMatterId, input.procedureId);
  const day = String(suggestionPayload(row.payload).dateText ?? "");
  const from = eventDate(day, "00:00"), to = new Date(from.getTime() + 86_400_000);
  const common = { procedureId: input.procedureId, ...(input.query ? { title: { contains: input.query, mode: "insensitive" as const } } : {}) };
  const targets = row.kind === "HEARING"
    ? (await tx.hearing.findMany({ where: { ...common, startsAt: { gte: from, lt: to } }, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 101 })).map(target => ({ id: target.id, title: target.title, at: target.startsAt, updatedAt: target.updatedAt }))
    : (await tx.deadline.findMany({ where: { ...common, dueAt: { gte: from, lt: to } }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 101 })).map(target => ({ id: target.id, title: target.title, at: target.dueAt, updatedAt: target.updatedAt }));
  return { targets: targets.slice(0, 100), truncated: targets.length > 100 };
}
