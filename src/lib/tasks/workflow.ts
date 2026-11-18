import { z } from "zod";

export type TaskWorkState = "OPEN" | "DONE" | "CANCELLED";

/** Current read projection only; never a persisted task state or permission to complete. */
export type TaskProgressSummary =
  | { availability: "UNAVAILABLE" }
  | { availability: "REVIEW" }
  | {
      availability: "AVAILABLE";
      waiting: { waitingFor: string; expectedResult: string; nextCheckAt: Date } | null;
      blockingPrerequisiteCount: number;
      cancelledPrerequisiteCount: number;
      checkDue: boolean;
    };

export type TaskProgressFilter = "ALL" | "UNBLOCKED" | "WAITING" | "BLOCKED" | "CHECK_DUE";
export const taskProgressFilters: { value: TaskProgressFilter; label: string }[] = [
  { value: "ALL", label: "全部事项" },
  { value: "UNBLOCKED", label: "无已知阻塞的任务" },
  { value: "WAITING", label: "等待外部的任务" },
  { value: "BLOCKED", label: "前置未完成的任务" },
  { value: "CHECK_DUE", label: "待检查的任务" }
];

export function summarizeTaskProgress(source: {
  matterId: string;
  stageMatterId: string | null;
  responsibility: { state: TaskWorkState } | null;
  waitings: { waitingFor: string; expectedResult: string; nextCheckAt: Date }[];
  prerequisites: { matterId: string; state: TaskWorkState | null }[];
}, now: Date): TaskProgressSummary {
  if (!source.responsibility || source.stageMatterId && source.stageMatterId !== source.matterId ||
      source.waitings.length > 1 || source.prerequisites.some(p => p.matterId !== source.matterId || p.state === null)) {
    return { availability: "REVIEW" };
  }
  const waiting = source.waitings[0] ?? null;
  return {
    availability: "AVAILABLE",
    waiting,
    blockingPrerequisiteCount: source.prerequisites.filter(p => p.state !== "DONE").length,
    cancelledPrerequisiteCount: source.prerequisites.filter(p => p.state === "CANCELLED").length,
    checkDue: Boolean(waiting && waiting.nextCheckAt.getTime() <= now.getTime())
  };
}

export function taskHasNoKnownBlockers(summary: TaskProgressSummary | null | undefined): boolean {
  return summary?.availability === "AVAILABLE" && !summary.waiting && summary.blockingPrerequisiteCount === 0;
}

export function taskWaitingCheckDue(summary: TaskProgressSummary | null | undefined, observedAt?: Date): boolean {
  if (summary?.availability !== "AVAILABLE" || !summary.waiting) return false;
  // A later interaction can make a check due without polling or changing the recorded date.
  return summary.checkDue || Boolean(observedAt && new Date(summary.waiting.nextCheckAt).getTime() <= observedAt.getTime());
}

export function matchesTaskProgressFilter(summary: TaskProgressSummary | null | undefined, filter: TaskProgressFilter, observedAt?: Date): boolean {
  if (filter === "ALL") return true;
  if (summary?.availability !== "AVAILABLE") return false;
  if (filter === "UNBLOCKED") return taskHasNoKnownBlockers(summary);
  if (filter === "WAITING") return Boolean(summary.waiting);
  if (filter === "BLOCKED") return summary.blockingPrerequisiteCount > 0;
  return taskWaitingCheckDue(summary, observedAt);
}

export function taskProgressLabels(summary: TaskProgressSummary | null | undefined, observedAt?: Date): string[] {
  if (!summary || summary.availability === "REVIEW") return ["任务记录待核对"];
  if (summary.availability === "UNAVAILABLE") return ["任务详情当前不可读取"];
  const labels: string[] = [];
  if (summary.waiting) labels.push(`等待 ${summary.waiting.waitingFor}`);
  if (summary.blockingPrerequisiteCount) labels.push(`前置未完成 ${summary.blockingPrerequisiteCount} 项${summary.cancelledPrerequisiteCount ? `（含已取消 ${summary.cancelledPrerequisiteCount} 项）` : ""}`);
  if (taskWaitingCheckDue(summary, observedAt)) labels.push("待检查");
  return labels.length ? labels : ["无已知阻塞"];
}

export type TaskWaitingItem = {
  id: string;
  waitingFor: string;
  expectedResult: string;
  reason: string | null;
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
export type TaskWorkflowWorkspace = TaskWorkflowAccess & {
  tasks: TaskWorkflowItem[];
  /** Existing tasks without a responsibility record cannot use the workflow yet. */
  untrackedTasks: { id: string; title: string; stageId?: string | null; stageName: string | null; procedureTitle: string | null; dueAt: Date | null; completed: boolean; assigneeName: string | null }[];
};
export type TaskWorkflowDetail = TaskWorkflowAccess & { task: TaskWorkflowItem };

const taskId = z.string().cuid();
const revision = z.number().int().nonnegative();
const waitingId = z.string().uuid();
const dateInput = z.union([z.date(), z.string().min(1).pipe(z.coerce.date())]);
const reason = z.string().trim().min(1, "请填写变更原因").max(1000);

export const taskWorkspaceInput = z.object({
  matterId: z.string().cuid(),
  includeClosed: z.boolean().default(false),
  returnTaskId: taskId.optional()
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
  reason: z.string().trim().max(1000).optional(),
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
