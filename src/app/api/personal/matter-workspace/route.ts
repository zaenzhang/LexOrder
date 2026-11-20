import { DocumentCategory, DocumentSourceOrigin } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { timelineEventKey, type TimelineEventKind } from "@/lib/matters/timeline-levels";
import { setTimelineGrade, setTimelineGradeSchema, timelineGrades } from "@/server/matters/timeline-grades";
import { ActionError } from "@/lib/action-error";
import { requireSession } from "@/lib/auth/session";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { deadlineOverdue, formatDeadlineDue } from "@/lib/deadline-due";
import { procedureTypeLabel, litigationStandingLabel, matterCategoryLabel, matterStatusLabel } from "@/lib/enums";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { prisma } from "@/lib/prisma";
import { assertCanReadMatter } from "@/lib/permissions";
import { prepareDeliverySchema, registerDeliveryEventSchema } from "@/server/deliveries/contracts";
import { exportDeliveryForActor } from "@/server/deliveries/export";
import { getDeliveryDetail, getDeliveryOptions, prepareDelivery, registerDeliveryEvent, listDeliveryRecords } from "@/server/deliveries/actions";
import { canReadDocument } from "@/lib/approvals/documents";
import { listFoldersByMatter, createFolder, renameFolder, moveDocumentToFolder, reorderFolders } from "@/server/document-folders/actions";
import { folderReorderSchema } from "@/server/document-folders/schemas";
import { changeMaterialCategory, changeMaterialCategorySchema } from "@/server/documents/catalog-actions";
import { getDocumentDetail } from "@/server/documents/detail-actions";
import { officePreviewKind } from "@/lib/storage/mime-ext";
import { listDocumentPage, uploadDocument } from "@/server/documents/actions";
import { matterInputCoverageSchema } from "@/lib/ai/input-coverage";
import { getMatterInputCoverage } from "@/server/ai/input-coverage-actions";
import { changeSignoff, readSignoff, readSignoffExcerpt, readSignoffList, signoffActions } from "@/server/skills/signoff-service";
import { caseGroupingIdSchema, caseGroupingPreviewSchema, startCaseGroupingSchema } from "@/lib/evidence/case-grouping";
import { previewCaseGrouping, queueCaseGrouping, readCaseGrouping } from "@/server/evidence/case-grouping-runs";
import { adoptMatterObservationsSchema } from "@/lib/evidence/case-adoption";
import { chronologyAssessmentInput, chronologyExportInput } from "@/lib/evidence/chronology-assessment";
import { evidenceTextSchema, revisionInputSchema } from "@/lib/evidence/item-input";
import { recordObservationSchema, sourceInputSchema } from "@/server/evidence/contracts";
import { createEvidenceItem, updateEvidenceItem, changeChronologyAssessment, listChronologyChanges, exportChronology, addEvidenceSource, removeEvidenceSource, getEvidenceWorkspace, listEvidenceItems, listEvidenceRevisions, getEvidenceFormOptions, confirmEvidenceItem, recordEvidenceObservation, adoptEvidenceObservationRun, adoptMatterObservations } from "@/server/evidence/actions";
import { adoptObservationRunSchema, observationRunIdSchema, startObservationRunSchema, startMatterObservationRunSchema } from "@/server/evidence/analysis-run-contract";
import { queueObservationRun, queueMatterObservationRun, readMatterObservationExcerpt, readObservationRuns } from "@/server/evidence/analysis-runs";
import { getMatterFinance } from "@/server/finance/actions";
import { getMatterById, updateMatterBasicInfo } from "@/server/matters/actions";
import { createNote, listNotes, updateNote } from "@/server/notes/actions";
import { getResearchList, getResearch, saveResearchRevision, checkResearchRevision, formResearchDraft } from "@/server/research/actions";
import { acceptResearchIssueSupplements } from "@/server/research/service";
import { readDraftCitation, saveDraftCitation } from "@/server/research/draft-citation";
import { acceptIssueSupplementsSchema, emptyResearchContent, researchAnalysisSchema, researchCheckSchema, researchDraftSchema, researchIssueSelectionSchema, saveParagraphCitationSchema } from "@/server/research/contracts";
import { getMatterBrief, getMatterContext, getMatterContextInputOptions, getMatterContextSourceOptions, recordMatterContext, confirmMatterContextRecord, getMatterContextHistory } from "@/server/matters/context-actions";
import { getTaskWorkspace } from "@/server/tasks/workflow-actions";
import { assertTaskMatterAccess } from "@/server/tasks/workflow-service";
import { getTaskMaterialReview, listTaskMaterialReviews, saveTaskMaterialReview, taskMaterialReviewOptions } from "@/server/tasks/material-review";
import { saveTaskMaterialReviewSchema, taskReviewSourceIds, taskReviewSourceLimit } from "@/server/tasks/material-review-contract";
import { createTask, toggleTaskCompleted, updateTask } from "@/server/tasks/actions";
import { listActiveSealPurposes } from "@/server/approval-permissions/actions";
import { listTemplates, prepareTemplate, renderTemplate, uploadDocumentTemplate } from "@/server/document-templates/actions";
import { templatePrepareSchema, templateRenderSchema } from "@/server/document-templates/schemas";
import { sealApproveSchema, sealRejectSchema } from "@/server/seals/schemas";
import { listSealTypeConfigs, createSealRequest, stampSealRequest, cancelSealRequest, approveSealRequest, rejectSealRequest, listSealRequests } from "@/server/seals/actions";

import { matterUpdateBasicSchema } from "@/server/matters/schemas";
import { contextRecordSchema, contextConfirmSchema, contextSourcePageSchema } from "@/lib/matters/context";
import { addProcedure, updateProcedure, createProcedureStage, addDeadline, addHearing } from "@/server/procedures/actions";
import { procedureCreateSchema, procedureUpdateSchema, procedureStageCreateSchema, deadlineCreateSchema, hearingCreateSchema } from "@/server/procedures/schemas";

const headers = { "Cache-Control": "no-store" };
const idSchema = z.string().cuid();

const sections = z.enum(["identity", "overview", "context", "materials", "material-versions", "material-pair", "task-material-reviews", "templates", "claim-registration", "evidence-items", "research", "draft-citation", "skill-commissions", "tasks", "delivery", "records", "finance", "seal"]);
const createSchema = z.object({
  action: z.literal("create-note"), matterId: idSchema, content: z.string().trim().min(1).max(5000),
  channel: z.enum(["PHONE", "WECHAT", "EMAIL", "MEETING", "COURT", "OTHER"]),
});
const taskFields = z.object({
  matterId: idSchema, title: z.string(), description: z.string(), stageId: idSchema.or(z.literal("")),
  priority: z.number().int().min(0).max(2),
});
const explicitContextRecord = z.preprocess((value, ctx) => {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "contextInputs")) {
    ctx.addIssue({ code: "custom", message: "请明确沿用或调整原方案采用的目标和指示。" });
    return z.NEVER;
  }
  return value;
}, contextRecordSchema);
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create-volume"), matterId: idSchema, name: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("rename-volume"), matterId: idSchema, folderId: idSchema, name: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("file-in-volume"), matterId: idSchema, documentId: idSchema, folderId: idSchema.nullable() }),
  folderReorderSchema.safeExtend({ action: z.literal("reorder-volumes") }),
  changeMaterialCategorySchema,
  createSchema,
  ...signoffActions,
  z.object({ action: z.literal("preview-skill-input"), data: matterInputCoverageSchema }),
  z.object({ action: z.literal("edit-matter"), data: matterUpdateBasicSchema.omit({ teamAccessRestricted: true }).required({ causeId: true, causeFreeText: true, claimAmount: true, ourStanding: true }).extend({ expectedUpdatedAt: z.coerce.date() }) }),
  z.object({ action: z.literal("add-procedure"), data: procedureCreateSchema.pick({ matterId: true, type: true, engagement: true, customLabel: true, caseNumber: true, handlingAgency: true }).extend({ isExternalLead: z.literal(false).default(false) }) }),
  z.object({ action: z.literal("edit-procedure"), matterId: idSchema, data: procedureUpdateSchema.pick({ id: true, expectedUpdatedAt: true, type: true, customLabel: true, caseNumber: true, handlingAgency: true, changeReason: true }) }),
  z.object({ action: z.literal("add-stage"), matterId: idSchema, data: procedureStageCreateSchema }),
  z.object({ action: z.literal("add-hearing"), matterId: idSchema, data: hearingCreateSchema }),
  z.object({ action: z.literal("add-deadline"), matterId: idSchema, data: deadlineCreateSchema }),
  z.object({ action: z.literal("save-context"), data: explicitContextRecord }),
  z.object({ action: z.literal("confirm-context"), data: contextConfirmSchema }),
  z.object({ action: z.literal("prepare-template"), data: templatePrepareSchema }),
  z.object({ action: z.literal("render-template"), data: templateRenderSchema }),
  z.object({ action: z.literal("approve-seal"), matterId: idSchema, data: sealApproveSchema }),
  z.object({ action: z.literal("reject-seal"), matterId: idSchema, data: sealRejectSchema }),
  z.object({ action: z.literal("cancel-seal"), matterId: idSchema, data: z.object({ id: idSchema }) }),
  z.object({ action: z.literal("create-evidence"), data: evidenceTextSchema.extend({ matterId: idSchema, requestKey: z.string().uuid(),
    sourceDocumentId: idSchema.nullable(), sourcePage: z.number().int().positive().nullable(), sourceRelation: z.enum(["SUPPORTS", "REBUTS", "CONTEXT"]) }) }),
  z.object({ action: z.literal("export-chronology"), matterId: idSchema, data: chronologyExportInput }),
  z.object({ action: z.literal("assess-chronology"), matterId: idSchema, data: chronologyAssessmentInput }),
  z.object({ action: z.literal("revise-evidence"), matterId: idSchema, data: revisionInputSchema.and(evidenceTextSchema) }),
  z.object({ action: z.literal("link-evidence"), matterId: idSchema, data: revisionInputSchema.and(sourceInputSchema) }),
  z.object({ action: z.literal("unlink-evidence"), matterId: idSchema, data: revisionInputSchema.extend({ sourceId: idSchema }) }),
  z.object({ action: z.literal("record-evidence-observation"), matterId: idSchema, data: recordObservationSchema }),
  z.object({ action: z.literal("start-evidence-observation-run"), data: startObservationRunSchema }),
  z.object({ action: z.literal("start-matter-observation-run"), data: startMatterObservationRunSchema }),
  z.object({ action: z.literal("preview-case-grouping"), data: caseGroupingPreviewSchema }),
  z.object({ action: z.literal("start-case-grouping"), data: startCaseGroupingSchema }),
  z.object({ action: z.literal("adopt-matter-observations"), data: adoptMatterObservationsSchema }),
  z.object({ action: z.literal("adopt-evidence-observation-run"), data: adoptObservationRunSchema }),
  z.object({ action: z.literal("prepare-delivery"), data: prepareDeliverySchema }),
  z.object({ action: z.literal("record-delivery-event"), matterId: idSchema, data: registerDeliveryEventSchema }),
  z.object({ action: z.literal("export-delivery"), matterId: idSchema, deliveryId: idSchema, requestKey: z.string().uuid() }),
  taskFields.extend({ action: z.literal("create-task"), requestKey: z.string().uuid(), dueAt: z.iso.datetime({ offset: true }).pipe(z.coerce.date()).optional() }),
  taskFields.extend({ action: z.literal("update-task"), id: idSchema, revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal("complete-task"), matterId: idSchema, id: idSchema, revision: z.number().int().nonnegative() }),
  saveTaskMaterialReviewSchema.extend({ action: z.literal("save-task-material-review") }),
  z.object({ action: z.literal("create-research"), matterId: idSchema, requestKey: z.string().uuid(), researchedAt: z.iso.datetime({ offset: true }),
    question: z.string(), scope: z.string(), conclusion: z.string(), unresolved: z.string(), issueSelection: researchIssueSelectionSchema.optional() }),
  z.object({
    action: z.literal("revise-research"), matterId: idSchema, supersedesId: idSchema,
    expectedVersion: z.number().int().positive(), requestKey: z.string().uuid(),
    analysis: researchAnalysisSchema,
  }),
  acceptIssueSupplementsSchema.extend({ action: z.literal("accept-issue-supplements") }),
  researchCheckSchema.extend({ action: z.literal("check-research") }),
  researchDraftSchema.extend({ action: z.literal("draft-research") }),
  z.object({ action: z.literal("save-draft-citation"), data: saveParagraphCitationSchema }),
  createSchema.extend({
    action: z.literal("update-note"), id: idSchema, expectedUpdatedAt: z.coerce.date(),
    occurredAt: z.coerce.date(), withWhom: z.string().max(80).optional(),
    tags: z.array(z.string().max(20)),
  }),
  setTimelineGradeSchema,
  z.object({ action: z.literal("confirm-evidence"), evidenceItemId: idSchema, expectedRevision: z.number().int().positive(), confirm: z.literal(true) }),
]);
const json = (value: unknown) => NextResponse.json(value, { headers });
function denied(request: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(request.headers, { method: request.method })) return new Response(null, { status: 403, headers });
}

function failure(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: "案件请求无效。" }, { status: 400, headers });
  if (error instanceof ActionError) return NextResponse.json({ error: error.message }, { status: 403, headers });
  throw error;
}

async function requireSealInMatter(matterId: string, id: string) {
  if (!await prisma.sealRequest.count({ where: { id, matterId } })) throw new ActionError("用印申请不存在或不属于当前案件");
}

async function requireDeliveryInMatter(matterId: string, deliveryId: string) {
  const match = await prisma.deliveryRecord.count({ where: { id: deliveryId, matterId } });
  if (!match) throw new ActionError("交付清单不存在或不属于当前案件");
}

function materialPreviewProjection(item: { id: string; name: string; version: number; isLatest: boolean; mimeType: string | null }) {
  const { id, name, version, isLatest, mimeType } = item;
  return { id, name, version, isLatest, isPdf: mimeType === "application/pdf", preview: officePreviewKind(mimeType, name) ? "office"
    : mimeType === "application/pdf" || mimeType === "text/plain" ? "inline" : null };
}

export async function GET(request: Request) {
  const blocked = denied(request);
  if (blocked) return blocked;
  const query = new URL(request.url).searchParams;
  try {
    const id = idSchema.parse(query.get("matter"));
    const section = sections.parse(query.get("section"));
    const cursor = query.has("cursor") ? idSchema.parse(query.get("cursor")) : undefined;
    if (section === "identity") {
      const { user } = await requireSession("matters.read");
      await assertCanReadMatter(user.id, user.role, id, user.rolePermissions);
      const matter = await prisma.matter.findFirst({ where: { id, deletedAt: null }, select: { id: true, title: true, internalCode: true } });
      return matter ? json(matter) : new Response(null, { status: 404, headers });
    }
    if (section === "material-versions") {
      const selected = idSchema.parse(query.get("document"));
      const { versions } = await getDocumentDetail(id, selected);
      return json({ versions: versions.map(materialPreviewProjection) });
    }
    if (section === "material-pair") {
      const pair = z.tuple([idSchema, idSchema]).refine(([left, right]) => left !== right).parse(query.getAll("document"));
      const { user } = await requireSession("documents.read");
      const rows = await prisma.document.findMany({
        where: { id: { in: pair }, matterId: id, deletedAt: null, matter: { deletedAt: null } },
        select: { id: true, name: true, version: true, isLatest: true, mimeType: true, matterId: true, intakeId: true, uploadedById: true },
      });
      if (rows.length !== 2 || !(await Promise.all(rows.map(row => canReadDocument(user.id, row)))).every(Boolean))
        throw new ActionError("选中的材料已撤回、无权读取或不属于本案");
      const byId = new Map(rows.map(row => [row.id, row]));
      return json({ versions: pair.map(documentId => materialPreviewProjection(byId.get(documentId)!)) });
    }
    if (section === "task-material-reviews") {
      const taskId = idSchema.parse(query.get("task"));
      const record = query.get("record");
      if (record) return json(await getTaskMaterialReview(id, taskId, idSchema.parse(record)));
      if (query.has("document")) return json(await taskMaterialReviewOptions(id, taskId, taskReviewSourceIds.parse(query.getAll("document"))));
      return json(await listTaskMaterialReviews(id, taskId, cursor));
    }
    if (section === "materials") {
      const version = z.enum(["all", "latest", "historical"]).parse(query.get("version") ?? "all");
      const folder = query.get("folder") ?? "*";
      const stageId = query.has("stage") ? idSchema.parse(query.get("stage")) : undefined;
      const programId = query.has("program") ? idSchema.parse(query.get("program")) : undefined;
      const taskId = query.has("task") ? idSchema.parse(query.get("task")) : undefined;
      let canWriteTask = false;
      if (taskId || programId) {
        const { user } = await requireSession("schedule.read");
        const { canWrite } = await assertTaskMatterAccess(prisma, user.id, id, "read");
        canWriteTask = canWrite && hasCustomPermission(user, "documents.read");
      }
      const [materialStage, materialTask, validProgram] = await Promise.all([
        stageId ? prisma.matterStage.findFirst({
          where: { id: stageId, procedure: { matterId: id, id: programId } }, select: { id: true, name: true, procedureId: true },
        }) : null,
        taskId ? prisma.task.findFirst({
          where: { id: taskId, matterId: id, stageId, ...(programId ? { stage: { procedureId: programId } } : {}) },
          select: { id: true, title: true, description: true, stageId: true, responsibility: { select: { state: true, revision: true } } },
        }) : null,
        programId && !stageId && !taskId ? prisma.matterProcedure.findFirst({
          where: { id: programId, matterId: id }, select: { id: true },
        }) : true,
      ]);
      if (stageId && !materialStage) throw new ActionError("办理环节不存在或不属于当前范围");
      if (taskId && !materialTask) throw new ActionError("任务不存在或不属于当前范围");
      if (!validProgram) throw new ActionError("程序不存在或不属于本案");
      const { user } = await requireSession("documents.read");
      const [documents, folders, editableMatter] = await Promise.all([listDocumentPage({
        matterId: id, stageId, procedureId: stageId ? undefined : programId, tag: query.get("tag") ?? undefined,
        limit: z.coerce.number().int().min(1).max(100).parse(query.get("limit") ?? 100),
        category: z.enum(DocumentCategory).optional().parse(query.get("category") || undefined),
        sourceOrigin: z.enum(DocumentSourceOrigin).optional().parse(query.get("origin") || undefined), search: z.string().trim().max(200).parse(query.get("q") ?? ""),
        folderId: folder === "*" ? undefined : folder === "" ? null : idSchema.parse(folder),
        isLatest: version === "all" ? undefined : version === "latest",
      }, cursor), listFoldersByMatter(id), hasCustomPermission(user, "documents.write") ? prisma.matter.findFirst({
        where: { id, deletedAt: null, status: { not: "ARCHIVED" },
          OR: [{ ownerId: user.id }, { members: { some: { userId: user.id, role: { in: ["LEAD", "CO_LEAD"] } } } }] },
        select: { id: true },
      }) : null]);
      return json({ canOrganizeMaterials: Boolean(editableMatter), materialStage, materialTask: materialTask ? {
        id: materialTask.id, title: materialTask.title, description: materialTask.description, stageId: materialTask.stageId,
        state: materialTask.responsibility?.state ?? null, reviewSourceLimit: taskReviewSourceLimit,
        reviewRevision: canWriteTask && materialTask.responsibility?.state === "OPEN" ? materialTask.responsibility.revision : null,
      } : null, nextCursor: documents.nextCursor, folders: folders.map(({ id, name }) => ({ id, name })), documents: documents.items });
    }
    if (section === "context") {
      if (query.get("inputs") === "1") return json(await getMatterContextInputOptions(id, query.get("after") ?? undefined));
      if (query.get("sources") === "1") {
        const page = query.has("after") ? contextSourcePageSchema.parse({ type: query.get("type"), cursor: query.get("after") }) : undefined;
        return json(await getMatterContextSourceOptions(id, page));
      }
      const record = query.get("history");
      if (record) return json(await getMatterContextHistory(id, idSchema.parse(record), query.has("before") ? z.coerce.number().int().positive().parse(query.get("before")) : undefined));
      return json(await getMatterContext(id, query.get("after") ?? undefined));
    }
    if (section === "evidence-items") {
      if (query.get("programs") === "1") {
        const { user } = await requireSession("matters.read");
        await assertCanReadMatter(user.id, user.role, id, user.rolePermissions);
        if (!hasCustomPermission(user, "schedule.read")) return json({ programs: [] });
        const [procedures, grades] = await Promise.all([prisma.matterProcedure.findMany({
          where: { matterId: id }, orderBy: [{ order: "asc" }, { id: "asc" }],
          select: { id: true, type: true, customLabel: true, acceptedAt: true, concludedAt: true,
            hearings: { select: { id: true, title: true, startsAt: true } },
            deadlines: { where: { confirmStatus: { not: "PENDING" } },
              select: { id: true, title: true, dueAt: true, duePrecision: true, completed: true } },
          },
        }), timelineGrades(user.id, id, false)]);
        const grade = (kind: TimelineEventKind, eventId: string) => ({
          event: { kind, id: eventId }, level: grades.get(timelineEventKey(kind, eventId)) ?? null,
        });
        return json({ programs: procedures.map(procedure => {
          const { id, type, customLabel, acceptedAt, concludedAt, hearings, deadlines } = procedure;
          return {
            id, title: customLabel || procedureTypeLabel[type],
            events: [
              ...(acceptedAt ? [{ ...grade("accepted", id), id: id + ":accepted", kind: "程序节点", title: "实际受理", day: shDayKey(acceptedAt), detail: shDayKey(acceptedAt) }] : []),
              ...hearings.map(hearing => ({ ...grade("hearing", hearing.id), id: hearing.id, kind: "庭期", title: hearing.title, day: shDayKey(hearing.startsAt),
                detail: shDayKey(hearing.startsAt) + " " + shTime(hearing.startsAt) })),
              ...deadlines.map(deadline => ({ ...grade("deadline", deadline.id), id: deadline.id, kind: "法律期限", title: deadline.title, day: shDayKey(deadline.dueAt),
                detail: formatDeadlineDue(deadline.dueAt, deadline.duePrecision) + (deadline.completed ? " · 已办理" : "") })),
              ...(concludedAt ? [{ ...grade("concluded", id), id: id + ":concluded", kind: "程序节点", title: "实际终结", day: shDayKey(concludedAt), detail: shDayKey(concludedAt) }] : []),
            ],
          };
        }) });
      }
      if (query.get("options") === "1") return json(await getEvidenceFormOptions(id));
      if (query.has("analysis")) {
        const { user } = await requireSession("matters.read");
        const analysis = query.get("analysis");
        if (analysis === "grouping") {
          const groupingId = query.has("groupingRun") ? caseGroupingIdSchema.parse(query.get("groupingRun")) : undefined;
          const groupingCursor = query.has("groupingCursor") ? caseGroupingIdSchema.parse(query.get("groupingCursor")) : undefined;
          return json(await readCaseGrouping(user, id, groupingId, groupingCursor));
        }
        const evidenceItemId = analysis === "case" ? null : idSchema.parse(analysis);
        const runId = query.has("run") ? observationRunIdSchema.parse(query.get("run")) : undefined;
        if (analysis === "case" && runId && query.has("fragment")) {
          const fragment = z.coerce.number().int().min(1).max(8).parse(query.get("fragment"));
          return json(await readMatterObservationExcerpt(user, id, runId, fragment));
        }
        const runCursor = analysis === "case" && query.has("runCursor") ? observationRunIdSchema.parse(query.get("runCursor")) : undefined;
        return json(await readObservationRuns(user, id, evidenceItemId, runId, runCursor));
      }
      if (query.has("changes")) {
        const evidenceItemId = idSchema.parse(query.get("changes"));
        if (!await prisma.evidenceItem.count({ where: { id: evidenceItemId, matterId: id } })) throw new ActionError("要点不存在或不属于本案");
        return json(await listChronologyChanges(evidenceItemId));
      }
      if (query.has("history")) {
        const evidenceItemId = idSchema.parse(query.get("history"));
        if (!await prisma.evidenceItem.count({ where: { id: evidenceItemId, matterId: id } })) throw new ActionError("要点不存在或不属于本案");
        const beforeRevision = query.has("before") ? z.coerce.number().int().positive().parse(query.get("before")) : undefined;
        return json(await listEvidenceRevisions({ evidenceItemId, beforeRevision }));
      }
      return json(await getEvidenceWorkspace(id, undefined, query.get("timeline") === "1"));
    }
    if (section === "skill-commissions") {
      const { user } = await requireSession("matters.read");
      const key = query.get("record");
      if (key) {
        const commissionId = z.uuid().parse(key);
        const fragment = query.get("fragment");
        return json(fragment === null ? await readSignoff(user, id, commissionId)
          : await readSignoffExcerpt(user, id, commissionId, z.coerce.number().int().min(1).max(80).parse(fragment)));
      }
      const scope = query.has("issue") ? { issueId: idSchema.parse(query.get("issue")) } : { researchId: idSchema.parse(query.get("research")) };
      const before = query.has("before") ? z.uuid().parse(query.get("before")) : undefined;
      return json(await readSignoffList(user, id, scope, before));
    }
    if (section === "draft-citation") {
      const { user } = await requireSession("documents.write");
      return json(await readDraftCitation(user, id, idSchema.parse(query.get("document")), idSchema.parse(query.get("research"))));
    }
    if (section === "research") {
      const record = query.get("record");
      return json(record === null ? await getResearchList(id, cursor) : await getResearch(id, idSchema.parse(record)));
    }
    if (section === "delivery") {
      if (query.get("options") === "1") return json(await getDeliveryOptions(id));
      const record = query.get("record");
      if (!record) return json(await listDeliveryRecords(id, cursor, query.get("sent") === "1"));
      const deliveryId = idSchema.parse(record);
      await requireDeliveryInMatter(id, deliveryId);
      return json(await getDeliveryDetail(deliveryId));
    }
    if (section === "finance") {
      const { stats, entries } = await getMatterFinance(id);
      return json({ stats, entries: entries.map(({ id, type, amount, occurredAt }) => ({ id, type, amount, occurredAt })) });
    }
    const matter = await getMatterById(id);
    if (!matter) return new Response(null, { status: 404, headers });
    if (!matter.businessAccess && section !== "overview") return new Response(null, { status: 403, headers });
    if (section === "claim-registration") {
      return json({ request: matter.intake?.claimDescription ?? null,
        counterclaim: matter.intake?.counterclaim ?? null, amount: matter.claimAmount, cause: matter.cause?.name ?? matter.causeFreeText });
    }
    if (section === "overview") {
      const { title, internalCode, status, category, cause, causeFreeText, claimAmount, owner, primaryClient } = matter;
      const [brief, evidence] = matter.businessAccess
        ? await Promise.all([getMatterBrief(id), listEvidenceItems(id, 20)])
        : [null, []] as const;
      const session = await requireSession();
      const canEdit = matter.businessAccess && status !== "ARCHIVED" && hasCustomPermission(session.user, "matters.write")
        && (matter.ownerId === session.user.id || matter.members.some(m => m.userId === session.user.id && (m.role === "LEAD" || m.role === "CO_LEAD")));
      const editor = canEdit ? { id, updatedAt: matter.updatedAt, title, causeId: matter.causeId, causeFreeText, causeName: cause?.name,
        claimAmount, ourStanding: matter.ourStanding, standings: litigationStandingLabel } : null;
      const procedures = matter.businessAccess ? matter.procedures.map(proc => ({
        id: proc.id, label: proc.customLabel || procedureTypeLabel[proc.type],
      })) : [];
      const confirmed = brief?.deadlines.filter(item => item.confirmationStatus === "CONFIRMED") ?? [];
      const next = confirmed.find(item => !deadlineOverdue(item.dueAt, item.duePrecision)) ?? confirmed[0];
      const deadline = next && { title: next.title, date: formatDeadlineDue(next.dueAt, next.duePrecision),
        procedureId: next.procedureId, overdue: deadlineOverdue(next.dueAt, next.duePrecision) };
      const roleLabel = { CLIENT_PARTY: "我方", OPPOSING_PARTY: "对方", THIRD_PARTY: "第三人", CO_LITIGANT: "共同当事人",
        AGENT: "代理人", WITNESS: "证人", OTHER: "其他关系人" };
      const parties = matter.businessAccess ? matter.parties.map(party => ({ id: party.id, name: party.name,
        label: party.standing ? litigationStandingLabel[party.standing] : roleLabel[party.role] })) : [];
      return json({ title, internalCode, status, statusLabel: matterStatusLabel[status], category, categoryLabel: matterCategoryLabel[category],
        brief, editor, cause: cause?.name ?? causeFreeText, claimAmount, owner: owner.name, client: primaryClient?.name,
        procedures, parties, deadline, evidence, canUpload: Boolean(matter.businessAccess && status !== "ARCHIVED" && hasCustomPermission(session.user, "documents.write")),
      });
    }
    if (section === "tasks") {
      const workspace = await getTaskWorkspace({ matterId: id, includeClosed: true });
      return json({ schedule: {
        canWrite: workspace.canWrite, procedureTypes: procedureTypeLabel,
        tasks: workspace.tasks.map(({ id, title, description, dueAt, priority, stageId, stageName, procedureTitle, responsibility, activeWaiting, prerequisites }) => ({
          id, title, description, dueAt, priority, stageId, stageName, procedureTitle, state: responsibility.state,
          assignee: responsibility.name, revision: responsibility.revision, waitingFor: activeWaiting?.waitingFor,
          blockingCount: prerequisites.filter(item => item.state !== "DONE").length,
        })),
        untracked: workspace.untrackedTasks,
        procedures: matter.procedures.map(({ id, type, customLabel, caseNumber, handlingAgency, updatedAt, engagement, status,
          jurisdiction, leadLawyer, acceptedAt, concludedAt, deadlines, hearings, stages }) => ({
          id, type, customLabel, caseNumber, handlingAgency, updatedAt, engagement, name: customLabel || procedureTypeLabel[type],
          typeLabel: procedureTypeLabel[type], statusLabel: { PENDING: "待办理", IN_PROGRESS: "办理中", CONCLUDED: "已终结" }[status],
          jurisdiction, lead: leadLawyer?.name ?? null, acceptedAt, concludedAt,
          deadlines: deadlines.map(({ id, title, dueAt, duePrecision, completed, confirmStatus }) => ({ id, title, dueLabel: formatDeadlineDue(dueAt, duePrecision), completed, confirmStatus })),
          hearings: hearings.map(({ id, title, startsAt }) => ({ id, title, startsAt })),
          stages: stages.filter(stage => stage.status === "ACTIVE").map(({ id, name }) => ({ id, name })),
        })),
      } });
    }
    if (section === "records") {
      const [notes, session] = await Promise.all([listNotes(id), requireSession()]);
      const canEditNotes = matter.status !== "ARCHIVED" && hasCustomPermission(session.user, "schedule.write");
      const reviewIds = matter.timelineEvents.flatMap(event => event.refType === "TaskMaterialReview" && event.refId ? [event.refId] : []);
      const reviews = reviewIds.length && hasCustomPermission(session.user, "documents.read")
        ? await prisma.taskMaterialReview.findMany({ where: { id: { in: reviewIds }, task: { matterId: id } }, select: { id: true, taskId: true } })
        : [];
      const taskByReview = new Map(reviews.map(review => [review.id, review.taskId]));
      return json({
        title: matter.title, canWrite: canEditNotes, canViewDelivery: hasCustomPermission(session.user, "documents.download"),
        notes: notes.map(({ id, channel, content, occurredAt, updatedAt, withWhom, tags, authorId, author }) => ({ id, channel, content, occurredAt, updatedAt, withWhom, tags, author: author.name, editable: canEditNotes && authorId === session.user.id })),
        events: matter.timelineEvents.map(({ id, title, occurredAt, refId, refType }) => {
          const taskId = refId && refType === "TaskMaterialReview" ? taskByReview.get(refId) : undefined;
          return { id, title, occurredAt, ...(taskId ? { taskReview: { taskId, id: refId } } : {}) };
        }),
      });
    }
    if (section === "templates") {
      const templates = await listTemplates();
      return json({ templates: templates.filter(t => !t.applicableCategories.length || t.applicableCategories.includes(matter.category))
        .map(({ id, name }) => ({ id, name })) });
    }
    const [seals, types, purposes, session] = await Promise.all([
      listSealRequests({ matterId: id, scope: "all" }), listSealTypeConfigs(), listActiveSealPurposes(), requireSession(),
    ]);
    return json({ sealWorkspace: {
      canRequest: matter.status !== "ARCHIVED" && hasCustomPermission(session.user, "seals.request"),
      types: types.filter(t => t.enabled).map(({ type, label }) => ({ type, label })), purposes,
      seals: seals.map(row => ({ id: row.id, code: row.code, documentTitle: row.documentTitle, status: row.status, requestedAt: row.requestedAt,
        sealType: row.sealType, purpose: row.purpose, requestedBy: row.requestedBy.name, approvedAt: row.approvedAt, stampedAt: row.stampedAt,
        approveNote: row.approveNote, draftDoc: row.draftDoc, stampedDoc: row.stampedDoc, canApprove: row.canApprove, canStamp: row.canStamp,
        canCancel: row.status === "PENDING" && row.requestedById === session.user.id })),
    } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const blocked = denied(request);
  if (blocked) return blocked;
  try {
    if (request.headers.get("content-type")?.startsWith("multipart/form-data;")) {
      const data = await request.formData().catch(() => null);
      if (data?.get("action") === "create-seal" || data?.get("action") === "stamp-seal") {
        const matterId = idSchema.parse(data.get("matterId"));
        if (data.get("action") === "stamp-seal") {
          await requireSealInMatter(matterId, idSchema.parse(data.get("id")));
          return json(await stampSealRequest(data));
        }
        // This desktop form explicitly selects a local PDF for this case.
        const fields = new FormData();
        for (const field of ["matterId", "draftDoc", "documentTitle", "sealType", "purposeConfigId", "purpose", "copies", "pageCount", "requireCrossPageSeal", "requestNote"]) {
          const value = data.get(field);
          if (value !== null) fields.set(field, value);
        }
        return json(await createSealRequest(fields));
      }
      if (data?.get("action") === "add-template") return json(await uploadDocumentTemplate(data));
      const file = data?.get("file");
      if (!data || !(file instanceof File)) return NextResponse.json({ error: "请选择要上传的材料。" }, { status: 400, headers });
      const form = new FormData();
      form.set("file", file);
      form.set("matterId", idSchema.parse(data?.get("matterId")));
      form.set("name", z.string().trim().min(1).max(255).parse(data?.get("name")));
      form.set("category", z.enum(DocumentCategory).parse(data?.get("category")));
      for (const tag of data.getAll("tags")) form.append("tags", tag);
      const sourceParty = data.get("sourceParty");
      if (sourceParty != null) form.set("sourceParty", sourceParty);
      const stageId = data?.get("stageId");
      if (stageId != null) {
        form.set("stageId", idSchema.parse(stageId));
        form.set("procedureId", idSchema.parse(data?.get("procedureId")));
      }
      const sourceOrigin = data?.get("sourceOrigin");
      if (sourceOrigin != null) form.set("sourceOrigin", z.literal("TEAM_PRODUCED").parse(sourceOrigin));
      form.set("requestKey", z.string().uuid().parse(data?.get("requestKey")));
      const result = await uploadDocument(form);
      if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400, headers });
      return json({ ok: true });
    }
    const input = mutation.parse(await request.json().catch(() => null));
    if (input.action === "create-signoff" || input.action === "create-issue-signoff" || input.action === "export-signoff" || input.action === "submit-signoff" || input.action === "adopt-signoff" || input.action === "grant-signoff-host" || input.action === "revoke-signoff-host" || input.action === "run-signoff-ai") {
      const { user } = await requireSession("matters.write");
      return json(await changeSignoff(user, input));
    }
    if (input.action === "set-timeline-grade") return json(await setTimelineGrade(input));
    if (input.action === "preview-skill-input") return json(await getMatterInputCoverage(input.data));
    if (input.action === "change-material-category") return json(await changeMaterialCategory(input));
    if (input.action === "reorder-volumes") return json(await reorderFolders(input));
    if (input.action === "create-volume") return json(await createFolder(input));
    if (input.action === "rename-volume") {
      const owned = await prisma.documentFolder.findFirst({ where: { id: input.folderId, matterId: input.matterId }, select: { id: true } });
      if (!owned) throw new ActionError("卷宗不属于当前案件");
      return json(await renameFolder({ id: owned.id, name: input.name }));
    }
    if (input.action === "file-in-volume") {
      const { user } = await requireSession("documents.write");
      const doc = await prisma.document.findFirst({
        where: { id: input.documentId, matterId: input.matterId, deletedAt: null },
        select: { id: true, matterId: true, intakeId: true, uploadedById: true },
      });
      if (!doc || !await canReadDocument(user.id, doc)) throw new ActionError("材料不存在或不属于当前案件");
      return json(await moveDocumentToFolder({ documentId: doc.id, folderId: input.folderId }));
    }
    if (input.action === "edit-matter") return json(await updateMatterBasicInfo(input.data));
    if (input.action === "save-context") return json(await recordMatterContext(input.data));
    if (input.action === "confirm-context") return json(await confirmMatterContextRecord(input.data));
    if (input.action === "add-procedure") return json(await addProcedure(input.data));
    if (input.action === "edit-procedure" || input.action === "add-stage" || input.action === "add-deadline" || input.action === "add-hearing") {
      const procedureId = input.action === "edit-procedure" ? input.data.id : input.data.procedureId;
      if (!await prisma.matterProcedure.count({ where: { id: procedureId, matterId: input.matterId } })) throw new ActionError("程序不存在或不属于当前案件");
      if (input.action === "edit-procedure") return json(await updateProcedure(input.data));
      if (input.action === "add-stage") return json(await createProcedureStage(input.data));
      if (input.action === "add-hearing") return json(await addHearing(input.data));
      return json(await addDeadline(input.data));
    }
    if (input.action === "prepare-template") return json(await prepareTemplate(input.data));
    if (input.action === "render-template") return json(await renderTemplate(input.data));
    if (input.action === "approve-seal" || input.action === "reject-seal" || input.action === "cancel-seal") {
      await requireSealInMatter(input.matterId, input.data.id);
      if (input.action === "approve-seal") return json(await approveSealRequest(input.data));
      if (input.action === "reject-seal") return json(await rejectSealRequest(input.data));
      return json(await cancelSealRequest(input.data));
    }
    if (input.action === "create-evidence") return json(await createEvidenceItem(input.data));
    if (input.action === "start-evidence-observation-run") {
      const { user } = await requireSession("matters.write");
      return json(await queueObservationRun(user, input.data));
    }
    if (input.action === "start-matter-observation-run") {
      const { user } = await requireSession("matters.write");
      return json(await queueMatterObservationRun(user, input.data));
    }
    if (input.action === "preview-case-grouping" || input.action === "start-case-grouping") {
      const { user } = await requireSession("matters.write");
      return json(await (input.action === "preview-case-grouping" ? previewCaseGrouping(user, input.data) : queueCaseGrouping(user, input.data)));
    }
    if (input.action === "adopt-matter-observations") return json(await adoptMatterObservations(input.data));
    if (input.action === "adopt-evidence-observation-run") return json(await adoptEvidenceObservationRun(input.data));
    if (input.action === "export-chronology") return json(await exportChronology(input.matterId, input.data));
    if (input.action === "assess-chronology" || input.action === "revise-evidence" || input.action === "link-evidence" || input.action === "unlink-evidence" || input.action === "record-evidence-observation") {
      const exists = await prisma.evidenceItem.count({ where: { id: input.data.evidenceItemId, matterId: input.matterId } });
      if (!exists) throw new ActionError("要点不存在或不属于本案");
      if (input.action === "assess-chronology") return json(await changeChronologyAssessment(input.data));
      if (input.action === "revise-evidence") return json(await updateEvidenceItem(input.data));
      if (input.action === "link-evidence") return json(await addEvidenceSource(input.data));
      if (input.action === "record-evidence-observation") return json(await recordEvidenceObservation(input.data));
      return json(await removeEvidenceSource(input.data));
    }
    if (input.action === "prepare-delivery") return json(await prepareDelivery(input.data));
    if (input.action === "record-delivery-event") {
      await requireDeliveryInMatter(input.matterId, input.data.deliveryId);
      return json(await registerDeliveryEvent(input.data));
    }
    if (input.action === "export-delivery") {
      const { user } = await requireSession("matters.export");
      await requireDeliveryInMatter(input.matterId, input.deliveryId);
      const result = await exportDeliveryForActor(user.id, input.deliveryId, { requestKey: input.requestKey });
      return new Response(new Uint8Array(result.buffer), { headers: { ...headers, "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`, "X-Content-Type-Options": "nosniff" } });
    }
    if (input.action === "create-task") return json(await createTask(input));
    if (input.action === "save-task-material-review") return json(await saveTaskMaterialReview(input));
    if (input.action === "update-task") return json(await updateTask(input));
    if (input.action === "complete-task") return json(await toggleTaskCompleted(input.id, { matterId: input.matterId, revision: input.revision }));
    if (input.action === "create-research") return json(await saveResearchRevision({
      ...emptyResearchContent(), ...input, supersedesId: null, expectedVersion: null,
    }));
    if (input.action === "revise-research") {
      const { matterId, supersedesId, expectedVersion, requestKey, analysis } = input;
      const previous = await getResearch(matterId, supersedesId);
      if (!previous.readable || !previous.content) throw new ActionError("当前无法读取原研究及其来源");
      return json(await saveResearchRevision({
        ...previous.content, ...analysis, matterId, supersedesId, expectedVersion, requestKey,
      }));
    }
    if (input.action === "accept-issue-supplements") {
      const { user } = await requireSession("matters.write");
      const { matterId, researchId, expectedVersion, requestKey, issue } = input;
      return json(await acceptResearchIssueSupplements(prisma, user, { matterId, researchId, expectedVersion, requestKey, issue }));
    }
    if (input.action === "check-research") return json(await checkResearchRevision(input));
    if (input.action === "draft-research") return json(await formResearchDraft(input));
    if (input.action === "save-draft-citation") {
      const { user } = await requireSession("documents.write");
      return json(await saveDraftCitation(user, input.data));
    }
    if (input.action === "confirm-evidence") return json(await confirmEvidenceItem(input));
    if (input.action === "update-note") return json(await updateNote(input));
    return json(await createNote({ ...input, tags: [], occurredAt: new Date() }));
  } catch (error) {
    return failure(error);
  }
}
