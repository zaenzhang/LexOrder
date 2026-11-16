"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { approvalTransaction } from "@/lib/approvals/service";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  taskDependenciesInput,
  taskWaitingFinishInput,
  taskWaitingRescheduleInput,
  taskWaitingStartInput,
  taskWorkspaceInput
} from "@/lib/tasks/workflow";
import { revalidateMatter } from "@/server/matters/route";
import {
  finishTaskWaitingTx,
  readTaskWorkflowTx,
  readTaskWorkspaceTx,
  rescheduleTaskWaitingTx,
  saveTaskDependenciesTx,
  startTaskWaitingTx
} from "./workflow-service";

async function refreshTasks(matterId: string) {
  await revalidateMatter(matterId);
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
}

export async function getTaskWorkspace(input: z.input<typeof taskWorkspaceInput>) {
  const session = await requireSession("schedule.read");
  return prisma.$transaction(db => readTaskWorkspaceTx(db, session.user.id, input), { isolationLevel: "RepeatableRead" });
}

export async function getTaskWorkflow(taskId: string, expectedMatterId?: string) {
  const session = await requireSession("schedule.read");
  return prisma.$transaction(db => readTaskWorkflowTx(db, session.user.id, taskId, expectedMatterId), { isolationLevel: "RepeatableRead" });
}

export async function saveTaskDependencies(input: z.input<typeof taskDependenciesInput>) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(db => saveTaskDependenciesTx(db, session.user.id, input), Prisma.TransactionIsolationLevel.ReadCommitted);
  await refreshTasks(result.matterId);
  return { ok: true };
}

export async function startTaskWaiting(input: z.input<typeof taskWaitingStartInput>) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(db => startTaskWaitingTx(db, session.user.id, input), Prisma.TransactionIsolationLevel.ReadCommitted);
  await refreshTasks(result.matterId);
  return { ok: true };
}

export async function finishTaskWaiting(input: z.input<typeof taskWaitingFinishInput>) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(db => finishTaskWaitingTx(db, session.user.id, input), Prisma.TransactionIsolationLevel.ReadCommitted);
  await refreshTasks(result.matterId);
  return { ok: true };
}

export async function rescheduleTaskWaiting(input: z.input<typeof taskWaitingRescheduleInput>) {
  const session = await requireSession("schedule.write");
  const result = await approvalTransaction(db => rescheduleTaskWaitingTx(db, session.user.id, input), Prisma.TransactionIsolationLevel.ReadCommitted);
  await refreshTasks(result.matterId);
  return { ok: true };
}
