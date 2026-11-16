import { z } from "zod";

export type TaskWorkState = "OPEN" | "DONE" | "CANCELLED";

export type TaskWaitingItem = {
  id: string;
  waitingFor: string;
  expectedResult: string;
  nextCheckAt: Date;
  startedAt: Date;
  endedAt: Date | null;
  result: string | null;
  createdById: string;
  endedById: string | null;
};

export type TaskWorkflowItem = {
  id: string;
  matterId: string;
  stageId: string | null;
  stageName: string | null;
  procedureTitle: string | null;
  title: string;
  description: string | null;
  dueAt: Date | null;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  responsibility: {
    id: string;
    revision: number;
    state: TaskWorkState;
    assigneeId: string;
    name: string;
    active: boolean;
    proposedAssigneeId: string | null;
    proposedName: string | null;
    acceptedAt: Date | null;
    reason: string | null;
  };
  activeWaiting: TaskWaitingItem | null;
  waitings: TaskWaitingItem[];
  prerequisites: { id: string; title: string; state: TaskWorkState }[];
};

export type TaskWorkflowPerson = { id: string; name: string };
type TaskWorkflowAccess = {
  people: TaskWorkflowPerson[];
  canWrite: boolean;
  currentUserId: string;
};
export type TaskWorkflowWorkspace = TaskWorkflowAccess & { tasks: TaskWorkflowItem[] };
export type TaskWorkflowDetail = TaskWorkflowAccess & { task: TaskWorkflowItem };

const taskId = z.string().cuid();
const revision = z.number().int().nonnegative();
const waitingId = z.string().uuid();
const dateInput = z.union([z.date(), z.string().min(1).pipe(z.coerce.date())]);
const reason = z.string().trim().min(1, "请填写变更原因").max(1000);

export const taskWorkspaceInput = z.object({
  matterId: z.string().cuid(),
  includeClosed: z.boolean().default(false)
});

export const taskDependenciesInput = z.object({
  taskId,
  revision,
  prerequisiteIds: z.array(taskId),
  reason
});

export const taskWaitingStartInput = z.object({
  taskId,
  revision,
  waitingId,
  waitingFor: z.string().trim().min(1, "请填写等待对象").max(200),
  expectedResult: z.string().trim().min(1, "请填写待收成果").max(2000),
  nextCheckAt: dateInput
});

export const taskWaitingFinishInput = z.object({
  taskId,
  revision,
  waitingId,
  result: z.string().trim().min(1, "请记录等待结束的实际结果").max(2000)
});

export const taskWaitingRescheduleInput = z.object({
  taskId,
  revision,
  waitingId,
  nextCheckAt: dateInput,
  reason
});
