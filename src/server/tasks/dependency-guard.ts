import type { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";

export function dependencyWouldCycle(edges: readonly { taskId: string; prerequisiteTaskId: string }[], taskId: string, prerequisiteTaskId: string) {
  const pending = [prerequisiteTaskId], visited = new Set<string>();
  const parents = new Map<string, string[]>();
  for (const edge of edges) parents.set(edge.taskId, [...parents.get(edge.taskId) ?? [], edge.prerequisiteTaskId]);
  while (pending.length) {
    const id = pending.pop()!;
    if (id === taskId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...parents.get(id) ?? []);
  }
  return false;
}

/** Called by the existing responsibility transition, including board and bulk actions. */
export async function assertTaskCanClose(db: Prisma.TransactionClient, taskId: string, matterId: string, complete: boolean) {
  if (await db.taskWait.count({ where: { taskId, endedAt: null } })) throw new ActionError("请先结束等待并填写取得的结果，再结束此待办");
  if (!complete) return;
  const edges = await db.taskDependency.findMany({ where: { taskId }, include: { prerequisiteTask: { select: {
    matterId: true, title: true, responsibility: { select: { state: true } },
  } } } });
  if (edges.some(edge => edge.prerequisiteTask.matterId !== matterId)) throw new ActionError("前置待办关联异常，请先核对依赖");
  const blocked = edges.filter(edge => edge.prerequisiteTask.responsibility?.state !== "DONE");
  if (blocked.length) throw new ActionError(`前置待办尚未完成：${blocked.slice(0, 3).map(edge => edge.prerequisiteTask.title).join("、")}${blocked.length > 3 ? "等" : ""}。已取消的前置也须先处理依赖`);
}
