import { fragmentsSchema } from "@/lib/workbench/fixed-fragments";
import { z } from "zod";
import { aiChat, AiNotConfiguredError, extractJson } from "@/lib/ai/client";
import { loadFixedFragments } from "@/server/ai/fixed-fragments";
import { ActionError } from "@/lib/action-error";
import { prisma } from "@/lib/prisma";
import { auditTx } from "@/server/audit";
import { assertCurrentJobLease, type JobLease } from "@/server/cron/queue";
import { contextAccess } from "@/server/matters/context-service";
import { researchTransaction } from "@/server/research/service";
import { resolvePersonalActor } from "@/server/runtime/personal";
import { baselineCurrent, readBase, readFollowUpPriorDecision } from "./signoff-service";
import { followUpSchema, nativeAiCandidatesSchema, prepareNativeAiResult, signoffAiExecutionSchema, signoffItemLabels, signoffMethod,
  type SignoffAiExecution, type SkillResult } from "./signoff-contract";

const jobInput = z.strictObject({ commissionId: z.uuid() });
const apiUsage = z.object({ usage: z.object({
  prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(),
}) });
const outputFormat = JSON.stringify(z.toJSONSchema(nativeAiCandidatesSchema));

function resultUsage(raw: unknown): SignoffAiExecution["usage"] {
  const parsed = apiUsage.safeParse(raw);
  return parsed.success ? { inputTokens: parsed.data.usage.prompt_tokens, outputTokens: parsed.data.usage.completion_tokens } : undefined;
}

export async function processSignoffAi(payload: Record<string, unknown>, lease: JobLease) {
  const { commissionId } = jobInput.parse(payload);
  const dispatch = await researchTransaction(prisma, async tx => {
    await assertCurrentJobLease(tx, lease);
    const run = await tx.skillCommission.findUniqueOrThrow({ where: { id: commissionId } });
    const previous = signoffAiExecutionSchema.parse(run.aiExecution);
    if (previous.state === "DISPATCHED") {
      // A lost reply may have consumed tokens. Startup recovery never repeats the provider request.
      await tx.skillCommission.update({ where: { id: run.id }, data: {
        aiExecution: { ...previous, state: "UNCERTAIN", error: "INTERRUPTED", finishedAt: new Date().toISOString() },
      } });
      return null;
    }
    if (previous.state !== "QUEUED") return null;
    try {
      const actor = await resolvePersonalActor(tx, run.authorId);
      if (!actor) throw new ActionError("本机工作区已不可用");
      const access = await contextAccess(tx, actor, run.matterId, true);
      const base = await readBase(tx, access, run.baseResearchId);
      if (!baselineCurrent(base, run) || run.result) throw new ActionError("研究或争点已更新");
      const followUp = run.followUp == null ? null : followUpSchema.parse(run.followUp);
      if (followUp) await readFollowUpPriorDecision(tx, access, run, followUp);
      const ranges = fragmentsSchema.parse(run.ranges);
      const fragments = await loadFixedFragments(tx, access, ranges, true);
      const receipt: SignoffAiExecution = { ...previous, state: "DISPATCHED", dispatchedAt: new Date().toISOString() };
      await tx.skillCommission.update({ where: { id: run.id }, data: { aiExecution: receipt } });
      return { run, ranges, fragments, receipt, followUp, question: base.issue.title };
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      await tx.skillCommission.update({ where: { id: run.id }, data: {
        aiExecution: { ...previous, state: "FAILED", error: "PERMISSION", finishedAt: new Date().toISOString() },
      } });
      return null;
    }
  });
  if (!dispatch) return;

  const { run, receipt, ranges, fragments, followUp } = dispatch;
  const focus = followUp?.kind;
  let result: SkillResult | undefined;
  let usage: SignoffAiExecution["usage"];
  let sentCharacters: number | undefined;
  let error: SignoffAiExecution["error"];
  try {
    const reply = await aiChat({
      messages: [
        { role: "system", content: [
          focus ? "仅核对" + signoffItemLabels[focus] + "。区分合同要求、材料记载和缺失证据。只返回一个核对项，kind 必须为 " + focus + "。"
            : signoffMethod.instructions[0],
          ...signoffMethod.instructions.slice(1, 3),
          "只返回一个 JSON 对象。引文写片段编号和逐字原句，无需填写偏移。每条引文在该片段中应只出现一次。",
          "输出结构：" + outputFormat,
        ].join("\n") },
        { role: "user", content: JSON.stringify({ question: dispatch.question, ...(focus ? { focus } : {}),
          fragments: fragments.map(({ index, text }) => ({ index, text })) }) },
      ],
      expectedDestination: { baseUrl: receipt.baseUrl, model: receipt.model },
      maxTokens: 1800, timeoutMs: 45_000, temperature: 0, logAction: "signoff-skill", userId: run.authorId,
    });
    sentCharacters = fragments.reduce((count, fragment) => count + fragment.text.length, 0);
    usage = resultUsage(reply.raw);
    try { result = prepareNativeAiResult(extractJson(reply.content), run.id, fragments, focus); }
    catch { error = "RESULT"; }
  } catch (failure) {
    error = failure instanceof AiNotConfiguredError ? "UNAVAILABLE"
      : failure instanceof Error && failure.name === "AbortError" ? "INTERRUPTED" : "PROVIDER";
  }

  await researchTransaction(prisma, async tx => {
    await assertCurrentJobLease(tx, lease);
    if (result) {
      try {
        const actor = await resolvePersonalActor(tx, run.authorId);
        if (!actor) throw new ActionError("本机工作区已不可用");
        const access = await contextAccess(tx, actor, run.matterId, true);
        await readBase(tx, access, run.baseResearchId);
        if (followUp) await readFollowUpPriorDecision(tx, access, run, followUp);
        await loadFixedFragments(tx, access, ranges, true);
      } catch (failure) {
        if (!(failure instanceof ActionError)) throw failure;
        error = "PERMISSION";
        result = undefined;
      }
    }
    const now = new Date();
    const execution: SignoffAiExecution = { ...receipt,
      state: result ? "SUCCEEDED" : error === "INTERRUPTED" ? "UNCERTAIN" : "FAILED", finishedAt: now.toISOString(),
      ...(usage ? { usage } : {}), ...(sentCharacters !== undefined ? { sentCharacters } : {}), ...(error ? { error } : {}),
    };
    await tx.skillCommission.update({ where: { id: run.id }, data: {
      aiExecution: execution, ...(result ? { result, submittedAt: now } : {}),
    } });
    await auditTx(tx, { userId: run.authorId, targetType: "SkillCommission", targetId: run.id,
      action: result ? "SKILL_AI_SUBMIT" : "SKILL_AI_FAIL",
      detail: { matterId: run.matterId, model: receipt.model, ...(error ? { error } : {}), ...(usage ? { usage } : {}) },
    });
  });
}
