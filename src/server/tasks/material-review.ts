import { Prisma } from "@prisma/client";
import { approvalTransaction } from "@/lib/approvals/service";
import { requireSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/action-error";
import { materialPresentation } from "@/lib/documents/presentation";
import { prisma } from "@/lib/prisma";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { auditTx } from "@/server/audit";
import { sourceReader } from "@/server/evidence/source-links";
import { recordTimelineEvent } from "@/server/timeline/record";
import { assertTaskMatterAccess, getTaskForChange } from "./workflow-service";
import {
  saveTaskMaterialReviewSchema, type SaveTaskMaterialReviewInput,
  type TaskReviewDetail, type TaskReviewHistory, type TaskReviewOption,
} from "./material-review-contract";

const unavailableMessage = "有选中材料已撤回、不可查看或缺少可靠的原件标识，请重新选材。";
const pdfPages = (document: { mimeType: string | null; pageCount: number | null }) =>
  document.mimeType?.toLowerCase() === "application/pdf" ? document.pageCount : null;

async function readReview<T>(
  matterId: string, taskId: string, read: (db: Prisma.TransactionClient, userId: string) => Promise<T>,
) {
  const { user } = await requireSession("schedule.read");
  if (!hasCustomPermission(user, "documents.read")) throw new ActionError("当前操作者无权读取任务核对材料。");
  return prisma.$transaction(async db => {
    await assertTaskMatterAccess(db, user.id, matterId, "read");
    if (!await db.task.count({ where: { id: taskId, matterId } })) throw new ActionError("任务不存在或不属于当前案件。");
    return read(db, user.id);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export function taskMaterialReviewOptions(matterId: string, taskId: string, documentIds: string[]) {
  return readReview<TaskReviewOption[]>(matterId, taskId, async (db, userId) => {
    const reader = await sourceReader(userId, matterId, documentIds.map(documentId => ({ documentId })), db);
    return documentIds.map(id => {
      const document = reader.documentById(id);
      if (!document?.sha256 || !/^[a-f0-9]{64}$/.test(document.sha256)) throw new ActionError(unavailableMessage);
      return { id, name: document.name, version: document.version, pdfPages: pdfPages(document) };
    });
  });
}

export function listTaskMaterialReviews(matterId: string, taskId: string, cursor?: string) {
  return readReview<TaskReviewHistory>(matterId, taskId, async db => {
    if (cursor && !await db.taskMaterialReview.count({ where: { id: cursor, taskId } })) {
      throw new ActionError("核对记录分页位置无效，请返回第一页。");
    }
    const rows = await db.taskMaterialReview.findMany({
      where: { taskId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, createdAt: true, author: { select: { name: true } }, _count: { select: { sources: true } } },
    });
    return {
      items: rows.slice(0, 20).map(row => ({ id: row.id, createdAt: row.createdAt.toISOString(), author: row.author.name, sourceCount: row._count.sources })),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  });
}

export function getTaskMaterialReview(matterId: string, taskId: string, id: string) {
  return readReview<TaskReviewDetail>(matterId, taskId, async (db, userId) => {
    const record = await db.taskMaterialReview.findFirst({
      where: { taskId, id },
      include: { author: { select: { name: true } }, sources: { orderBy: { position: "asc" } } },
    });
    if (!record) throw new ActionError("核对记录不存在或不属于当前任务。");
    const reader = await sourceReader(userId, matterId, record.sources, db);
    const sources: Extract<TaskReviewDetail, { state: "AVAILABLE" }>["sources"] = [];
    for (const source of record.sources) {
      const document = reader.documentById(source.documentId);
      if (!document || document.sha256 !== source.documentSha256 || document.version !== source.documentVersion) {
        return { state: "UNAVAILABLE" };
      }
      sources.push({
        documentId: source.documentId, name: source.documentName, version: source.documentVersion, page: source.page,
        ...materialPresentation(document, source.page == null ? undefined : { kind: "PAGE", page: source.page }),
      });
    }
    return { state: "AVAILABLE", content: record.content, createdAt: record.createdAt.toISOString(), author: record.author.name, sources };
  });
}

export async function saveTaskMaterialReview(input: SaveTaskMaterialReviewInput) {
  const data = saveTaskMaterialReviewSchema.parse(input);
  const { user } = await requireSession("schedule.write");
  if (!hasCustomPermission(user, "documents.read")) throw new ActionError("当前操作者无权读取任务核对材料。");
  return approvalTransaction(async db => {
    const task = await getTaskForChange(db, user.id, data.taskId);
    if (task.matterId !== data.matterId) throw new ActionError("任务不存在或不属于当前案件。");
    const previous = await db.taskMaterialReview.findUnique({
      where: { authorId_requestKey: { authorId: user.id, requestKey: data.requestKey } },
      include: { sources: { orderBy: { position: "asc" } } },
    });
    if (previous) {
      const sameSources = previous.sources.length === data.sources.length
        && previous.sources.every((source, i) => source.documentId === data.sources[i].documentId && source.page === data.sources[i].page);
      if (previous.taskId !== task.id || previous.taskRevision !== data.taskRevision || previous.content !== data.content || !sameSources) {
        throw new ActionError("该提交标识已用于另一条核对记录，请重新打开表单。");
      }
    } else if (task.responsibility.state !== "OPEN" || task.responsibility.revision !== data.taskRevision) {
      throw new ActionError("任务状态或修订已变化。请回到任务工作台重新读取，再保存核对意见。");
    }

    // Lock only the concrete versions being cited; content digests come from the existing material records.
    const ids = data.sources.map(source => source.documentId);
    await db.$queryRaw`SELECT id FROM "Document" WHERE id IN (${Prisma.join(ids)}) AND "matterId" = ${task.matterId} ORDER BY id FOR SHARE`;
    const reader = await sourceReader(user.id, task.matterId, data.sources, db);
    const sources = data.sources.map(({ documentId, page }, position) => {
      const document = reader.documentById(documentId);
      if (!document?.sha256 || !/^[a-f0-9]{64}$/.test(document.sha256)) throw new ActionError(unavailableMessage);
      const pageCount = pdfPages(document);
      if (page !== null && (!pageCount || page > pageCount)) throw new ActionError("页码须在该 PDF 固定版本的页数范围内。");
      return { documentId, documentName: document.name, documentSha256: document.sha256, documentVersion: document.version, page, position };
    });
    if (previous) {
      if (previous.sources.some((source, i) => source.documentSha256 !== sources[i].documentSha256 || source.documentVersion !== sources[i].documentVersion)) {
        throw new ActionError("来源版本身份已变化，请核对原件。");
      }
      return { id: previous.id };
    }

    const record = await db.taskMaterialReview.create({
      data: {
        taskId: task.id, authorId: user.id, requestKey: data.requestKey, taskRevision: data.taskRevision,
        content: data.content, sources: { create: sources },
      },
      select: { id: true, createdAt: true },
    });
    await recordTimelineEvent(db, {
      matterId: task.matterId, eventType: "TASK_REVIEW_SAVED", title: `记录核对意见：${task.title}`,
      occurredAt: record.createdAt, refType: "TaskMaterialReview", refId: record.id,
    });
    await auditTx(db, {
      userId: user.id, action: "TASK_REVIEW_SAVED", targetType: "TaskMaterialReview", targetId: record.id,
      detail: { matterId: task.matterId, taskId: task.id, documentIds: ids, taskRevision: data.taskRevision },
    });
    return { id: record.id };
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
}
