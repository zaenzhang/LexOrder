"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { approvalTransaction } from "@/lib/approvals/service";
import { revalidatePath } from "next/cache";
import { revalidateMatter } from "@/server/matters/route";
import { actionErrorMessage } from "@/lib/action-error";
import { workChangeInput } from "@/server/reminders/responsibility";
import {
  createTaskTx, updateTaskTx, readMatterTasks, readTask, changeTaskTx, completeTaskTx,
  startTaskWaitTx, changeTaskWaitTx, endTaskWaitTx, addTaskDependencyTx, removeTaskDependencyTx,
} from "./service";
import type { TaskCreateInput, TaskUpdateInput, TaskWaitStartInput, TaskWaitChangeInput, TaskWaitEndInput, TaskDependencyInput, TaskDependencyRemoveInput } from "./contracts";
export type { TaskCreateInput, TaskUpdateInput } from "./contracts";

const idSchema = z.string().cuid();
async function refresh(matterId: string) {
  await revalidateMatter(matterId);
  revalidatePath("/schedule");
}
export async function getMatterTasks(matterId: string) {
  const session = await requireSession("schedule.read");
  return readMatterTasks(prisma, session.user, idSchema.parse(matterId));
}
export async function getTask(matterId: string, id: string) {
  const session = await requireSession("schedule.read");
  return readTask(prisma, session.user, idSchema.parse(matterId), idSchema.parse(id));
}
export async function createTask(input: TaskCreateInput) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(tx => createTaskTx(tx, session.user, input));
  await refresh(input.matterId);
  return result;
}
export async function updateTask(input: TaskUpdateInput) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(tx => updateTaskTx(tx, session.user, input));
  await refresh(input.matterId);
  return result;
}
export async function changeTask(input: Omit<z.input<typeof workChangeInput>, "id"> & { matterId: string; taskId: string }) {
  const session = await requireSession("schedule.write");
  const matterId = idSchema.parse(input.matterId), taskId = idSchema.parse(input.taskId);
  const result = await approvalTransaction(tx => changeTaskTx(tx, session.user, matterId, taskId, input));
  await refresh(matterId);
  return result;
}
export async function startTaskWait(input: TaskWaitStartInput) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(tx => startTaskWaitTx(tx, session.user, input));
  await refresh(input.matterId);
  return result;
}
export async function changeTaskWait(input: TaskWaitChangeInput) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(tx => changeTaskWaitTx(tx, session.user, input));
  await refresh(input.matterId);
  return result;
}
export async function endTaskWait(input: TaskWaitEndInput) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(tx => endTaskWaitTx(tx, session.user, input));
  await refresh(input.matterId);
  return result;
}
export async function addTaskDependency(input: TaskDependencyInput) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(tx => addTaskDependencyTx(tx, session.user, input));
  await refresh(input.matterId);
  return result;
}
export async function removeTaskDependency(input: TaskDependencyRemoveInput) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(tx => removeTaskDependencyTx(tx, session.user, input));
  await refresh(input.matterId);
  return result;
}

/** Existing quick complete entry; reopening always requires the explicit responsibility action. */
export async function toggleTaskCompleted(id: string) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(tx => completeTaskTx(tx, session.user, idSchema.parse(id), "经办通过完成操作确认已办结", false));
  await refresh(result.matterId);
  return { ok: true as const };
}

/** Every item uses the same current authorization and prerequisite guard as single completion. */
export async function completeTasksBatch(input: { ids: string[]; reason: string }) {
  const session = await requireSession("schedule.write");
  const data = z.object({ ids: z.array(idSchema).min(1, "请先选择要办结的待办").max(100, "单次最多办结 100 条，请分批处理"),
    reason: z.string().trim().min(1, "请填写批量办结的处理结果").max(1000) }).parse(input);
  const results: { id: string; ok: boolean; error?: string }[] = [], matters = new Set<string>();
  for (const id of data.ids) {
    try {
      const result = await approvalTransaction(tx => completeTaskTx(tx, session.user, id, data.reason, true));
      matters.add(result.matterId);
      results.push({ id, ok: true });
    } catch (error) { results.push({ id, ok: false, error: actionErrorMessage(error) }); }
  }
  for (const matterId of matters) await refresh(matterId);
  return { ok: true as const, results };
}
