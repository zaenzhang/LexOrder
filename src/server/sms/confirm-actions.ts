"use server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { assertCanAssociateMatter } from "@/lib/permissions";
import { smsDecisionInput, type SmsDecisionInput } from "@/lib/sms/suggestions";
import { revalidateMatter } from "@/server/matters/route";
import { revalidatePath } from "next/cache";
import { refreshScheduleReminderAfterSave } from "@/server/reminders/schedule";
import { fileSmsInboundFilesToMatter } from "./inbound-filing";
import { decideSmsSuggestionsTx, finishSmsSuggestionsTx, listSmsEventTargetsTx, lockSms, smsActor } from "./suggestion-service";

/** 建议清单（收件人本人或案件经办可读） */
export async function listSmsSuggestions(smsId: string) {
  const session = await requireSession("matters.write");
  const sms = await prisma.smsMessage.findUnique({ where: { id: smsId }, select: { receivedById: true, matchedMatterId: true } });
  if (!sms) throw new ActionError("来件不存在");
  if (sms.receivedById !== session.user.id) {
    if (!sms.matchedMatterId) throw new ActionError("只能处理本人收到的来件");
    await assertCanAssociateMatter(session.user.id, sms.matchedMatterId);
  }
  return prisma.smsSuggestion.findMany({
    where: { smsId, kind: { not: "DOC_TYPE" } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: { file: { select: { originalName: true, displayName: true, docType: true, analysisState: true } } }
  });
}

/** 分析触发入口（取件后手动/队列调用共用；对象级权限与列表一致） */
export async function analyzeSmsInboundFiles(input: { smsId: string; fileIds?: string[] }) {
  const session = await requireSession("matters.write");
  const sms = await prisma.smsMessage.findUnique({ where: { id: input.smsId }, select: { receivedById: true, matchedMatterId: true } });
  if (!sms) throw new ActionError("来件不存在");
  if (sms.receivedById !== session.user.id) {
    if (!sms.matchedMatterId) throw new ActionError("只能处理本人收到的来件");
    await assertCanAssociateMatter(session.user.id, sms.matchedMatterId);
  }
  const { analyzeInboundFile } = await import("./analysis");
  // 2026-09-20 P3 修复：含 ANALYZING——分析中途崩溃卡死的文件可经本入口手动重跑
  const files = await prisma.smsInboundFile.findMany({
    where: { smsId: input.smsId, ...(input.fileIds?.length ? { id: { in: input.fileIds } } : {}), state: { in: ["PENDING_REVIEW", "FILED"] }, documentId: null, analysisState: { in: ["PENDING", "ANALYZING", "FAILED", "NEEDS_OCR"] } },
    select: { id: true }
  });
  const results: { fileId: string; state: string; suggestionCount: number }[] = [];
  for (const f of files) results.push({ fileId: f.id, ...(await analyzeInboundFile(f.id, session.user.id)) });
  revalidatePath("/inbox");
  return { ok: true, results };
}

export async function decideSmsSuggestions(input: SmsDecisionInput) {
  const data = smsDecisionInput.parse(input);
  const actor = await smsActor();
  const applied = await prisma.$transaction(tx => decideSmsSuggestionsTx(tx, actor, data), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 });
  const warnings: string[] = [];
  let filedFiles = 0;
  // Original decision and its target are already committed. Filing can be retried independently.
  if (data.decision === "ACCEPTED" && applied.matterId) {
    try { filedFiles = await fileSmsInboundFilesToMatter({ smsId: applied.smsId, matterId: applied.matterId, userId: actor.id }); }
    catch (error) { warnings.push(`建议已保存；文件尚未完成入卷：${error instanceof ActionError ? error.message : "请从来件继续处理"}`); }
  }
  let remaining: Awaited<ReturnType<typeof finishSmsSuggestionsTx>> | null = null;
  try { remaining = await prisma.$transaction(tx => finishSmsSuggestionsTx(tx, actor, applied.smsId), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }); }
  catch (error) { warnings.push(`建议已保存；处理状态未更新：${error instanceof ActionError ? error.message : "请刷新后核对当前权限和文件"}`); }
  for (const result of applied.results) {
    if (result.outcome === "CREATED" && !result.replayed && result.targetId && (result.targetType === "Hearing" || result.targetType === "Deadline")) {
      try { await refreshScheduleReminderAfterSave(result.targetType, result.targetId); }
      catch { warnings.push("事项已保存；即时提醒未完成，请在事项中核对"); }
    }
  }
  revalidatePath("/inbox");
  if (applied.matterId) await revalidateMatter(applied.matterId);
  return { ok: true as const, results: applied.results, filedFiles, remaining, warnings: [...new Set(warnings)] };
}

const targetInput = z.object({ smsId: z.string().cuid(), suggestionId: z.string().cuid(), procedureId: z.string().cuid(), query: z.string().trim().max(100).default("") });
export async function listSmsEventTargets(input: z.input<typeof targetInput>) {
  const data = targetInput.parse(input), actor = await smsActor();
  return prisma.$transaction(tx => listSmsEventTargetsTx(tx, actor, data), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function retrySmsSuggestionFiling(smsId: string) {
  z.string().cuid().parse(smsId);
  const actor = await smsActor();
  const sms = await prisma.$transaction(tx => lockSms(tx, actor, smsId), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  if (!sms.matchedMatterId) throw new ActionError("请先确认来件归属案件");
  let filedFiles = 0;
  let warning: string | null = null;
  try { filedFiles = await fileSmsInboundFilesToMatter({ smsId, matterId: sms.matchedMatterId, userId: actor.id }); }
  catch (error) { warning = error instanceof ActionError ? error.message : "入卷失败，请重试"; }
  const remaining = await prisma.$transaction(tx => finishSmsSuggestionsTx(tx, actor, smsId), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  revalidatePath("/inbox"); await revalidateMatter(sms.matchedMatterId);
  return { filedFiles, remaining, warning };
}
