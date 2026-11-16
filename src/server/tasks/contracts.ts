import { z } from "zod";
import { shDateFromKey } from "@/lib/ui/sh-time";

const id = z.string().cuid();
const reason = z.string().trim().min(1, "请填写原因或处理结果").max(1000);
export const taskDaySchema = z.string().refine(value => {
  try { shDateFromKey(value); return true; } catch { return false; }
}, "请填写有效日期");

const fields = {
  title: z.string().trim().min(1, "请填写待办标题").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  priority: z.coerce.number().int().min(0).max(2).default(0),
  stageId: id.optional().or(z.literal("")),
};
export const taskCreateSchema = z.object({ matterId: id, requestKey: z.string().uuid(), ...fields,
  assigneeId: id.optional().or(z.literal("")), dueAt: z.coerce.date().optional(),
}).strict();
export const taskUpdateSchema = z.object({ matterId: id, id, expectedRevision: z.number().int().nonnegative(), ...fields, reason }).strict();
export const taskWaitStartSchema = z.object({ matterId: id, taskId: id, expectedRevision: z.number().int().nonnegative(),
  requestKey: z.string().uuid(), externalParty: z.string().trim().min(1, "请填写等待对象").max(200),
  expectedResult: z.string().trim().min(1, "请填写预期取得的结果").max(1000), reason, nextCheckDate: taskDaySchema,
}).strict();
export const taskWaitChangeSchema = z.object({ matterId: id, taskId: id, id, revision: z.number().int().positive(),
  nextCheckDate: taskDaySchema, reason,
}).strict();
export const taskWaitEndSchema = z.object({ matterId: id, taskId: id, id, revision: z.number().int().positive(), result: reason }).strict();
export const taskDependencySchema = z.object({ matterId: id, taskId: id, prerequisiteTaskId: id,
  expectedRevision: z.number().int().nonnegative(), reason,
}).strict();
export const taskDependencyRemoveSchema = z.object({ matterId: id, taskId: id, id,
  expectedRevision: z.number().int().nonnegative(), reason,
}).strict();
export type TaskCreateInput = z.input<typeof taskCreateSchema>;
export type TaskUpdateInput = z.input<typeof taskUpdateSchema>;
export type TaskWaitStartInput = z.input<typeof taskWaitStartSchema>;
export type TaskWaitChangeInput = z.input<typeof taskWaitChangeSchema>;
export type TaskWaitEndInput = z.input<typeof taskWaitEndSchema>;
export type TaskDependencyInput = z.input<typeof taskDependencySchema>;
export type TaskDependencyRemoveInput = z.input<typeof taskDependencyRemoveSchema>;

export type TaskState = "OPEN" | "DONE" | "CANCELLED";
export const taskStateLabels: Record<TaskState, string> = { OPEN: "办理中", DONE: "已完成", CANCELLED: "已取消" };
export type TaskSummary = {
  id: string; title: string; stageId: string|null; stageName: string|null; description: string|null;
  dueAt: string|null; priority: number; state: TaskState; workId: string; revision: number;
  assigneeId: string; assigneeName: string; assigneeActive: boolean; acceptedAt: string|null;
  proposedAssigneeId: string|null; proposedAssigneeName: string|null;
  waiting: { id: string; externalParty: string; nextCheckDate: string }|null;
  blockers: number;
};
export type TaskWaitView = {
  id: string; externalParty: string; expectedResult: string; reason: string; nextCheckDate: string;
  startedAt: string; endedAt: string|null; result: string|null; revision: number; createdByName: string; endedByName: string|null;
};
export type TaskDependencyView = { id: string; taskId: string; title: string; state: TaskState; satisfied: boolean };
export type TaskDetail = TaskSummary & {
  canWrite: boolean; canCancel: boolean; canAccept: boolean; canDecline: boolean; reason: string|null;
  waits: TaskWaitView[]; prerequisites: TaskDependencyView[]; dependents: TaskDependencyView[];
};
export type MatterTasksView = {
  canWrite: boolean; tasks: TaskSummary[];
  stages: { id: string; name: string; procedureLabel: string }[];
  people: { id: string; name: string }[];
};
