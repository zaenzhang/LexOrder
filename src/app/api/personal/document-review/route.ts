import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { canReadDocument } from "@/lib/approvals/documents";
import { canApproveItem } from "@/lib/approvals/service";
import { requireSession } from "@/lib/auth/session";
import { matterAssociationFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { isInlinePreviewable, officePreviewKind } from "@/lib/storage/mime-ext";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { carriedContextInputs } from "@/lib/matters/context-inputs";
import { readDocumentContextInputs } from "@/server/matters/context-inputs";
import {
  approveDocument,
  rejectDocument,
  submitDocumentForReview,
  uploadNewVersion,
} from "@/server/documents/actions";
import {
  checkReviewIssue,
  createReviewIssue,
  getDocumentReview,
  getPreviousDocumentReviewIssue,
  getDocumentReviewSourcePage,
  respondReviewIssue,
} from "@/server/document-reviews/actions";
import {
  checkReviewIssueSchema,
  createReviewIssueSchema,
  respondReviewIssueSchema,
} from "@/server/document-reviews/contracts";
import { citationDraftFilter } from "@/server/research/draft-citation";
import { fixedReviewSchema } from "@/server/document-reviews/fixed-approval";

const id = z.cuid();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), matterId: id, documentId: id, expected: fixedReviewSchema }),
  z.object({
    action: z.enum(["approve", "reject"]),
    matterId: id,
    documentId: id,
    expected: fixedReviewSchema,
    note: z.string().trim().max(500),
    acknowledged: z.literal(true),
  }),
  z.object({ action: z.literal("issue"), matterId: id, documentId: id, data: createReviewIssueSchema }),
  z.object({ action: z.literal("respond"), matterId: id, documentId: id, data: respondReviewIssueSchema }),
  z.object({ action: z.literal("check"), matterId: id, documentId: id, data: checkReviewIssueSchema }),
]);
const headers = { "Cache-Control": "no-store" };
const json = (v: unknown, status = 200) => Response.json(v, { status, headers });
async function handle(req: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(req.headers, { method: req.method }))
    return new Response(null, { status: 403, headers });
  try {
    const { user } = await requireSession("documents.read");
    const q = new URL(req.url).searchParams;
    const form =
      req.method === "POST" && req.headers.get("content-type")?.startsWith("multipart/form-data;")
        ? await req.formData()
        : null;
    const action = req.method === "POST" && !form ? actionSchema.parse(await req.json().catch(() => null)) : null;
    const matterId = id.parse(action?.matterId ?? form?.get("matterId") ?? q.get("matter"));
    const matter = await prisma.matter.findFirst({
      where: { id: matterId, deletedAt: null, ...matterAssociationFilter(user.id) },
      select: { status: true },
    });
    if (!matter) return json({ error: "案件不存在或不可办理。" }, 404);
    const documentId = action?.documentId ?? form?.get("documentId") ?? q.get("document");
    const candidates = {
      matterId,
      deletedAt: null,
      OR: [{ sourceOrigin: "TEAM_PRODUCED" as const }, { templateId: { not: null } }],
    };
    if (!documentId) {
      const citationDrafts = q.get("citationDrafts") === "1";
      if (citationDrafts && (matter.status === "ARCHIVED" || !hasCustomPermission(user, "documents.write"))) {
        return json({ items: [], next: null });
      }
      const cursor = q.has("before") ? id.parse(q.get("before")) : undefined;
      const rows = await prisma.document.findMany({
        where: { ...candidates, ...(citationDrafts ? citationDraftFilter : {}), ...(cursor ? { id: { lt: cursor } } : {}) },
        orderBy: { id: "desc" },
        take: 41,
      });
      const readable = await Promise.all(
        rows
          .slice(0, 40)
          .map(async (d) =>
            (await canReadDocument(user.id, d))
              ? { id: d.id, name: d.name, version: d.version, isLatest: d.isLatest, status: d.status }
              : null,
          ),
      );
      return json({ items: readable.filter(Boolean), next: rows.length > 40 ? rows[39].id : null });
    }
    const doc = await prisma.document.findFirst({ where: { ...candidates, id: id.parse(documentId) } });
    if (!doc || !(await canReadDocument(user.id, doc)))
      return json({ error: "该版本不存在或不属于本案可读成果。" }, 404);
    const current = matter.status !== "ARCHIVED" && doc.isLatest;
    if ((action || form) && matter.status === "ARCHIVED") return json({ error: "案件已归档，文书不可修改。" }, 409);
    if (form) {
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "请选择新的工作稿文件。" }, 400);
      const context = await readDocumentContextInputs(prisma, user.id, doc.id, matterId);
      const seen = z
        .array(z.object({ recordId: id, expectedCurrentRecordId: id, expectedConfirmedAt: z.string().nullable() }))
        .parse(JSON.parse(String(form.get("contextInputs") ?? "[]")));
      const toMap = (rows: typeof seen) => [...rows].sort((a, b) => a.recordId.localeCompare(b.recordId));
      if (
        context.unavailable ||
        JSON.stringify(toMap(seen)) !== JSON.stringify(toMap(carriedContextInputs(context)))
      )
        throw new ActionError("原稿采用的目标与指示不可读或已变化，请重新核对。");
      return json(
        await uploadNewVersion({
          documentId: doc.id,
          file,
          contextInputs: seen,
          requestKey: z.uuid().parse(form.get("requestKey")),
        }),
      );
    }
    if (action) {
      if (action.action === "issue") {
        if (action.data.documentId !== doc.id) return json({ error: "复核问题不属于此文书版本。" }, 409);
        return json(await createReviewIssue(action.data));
      }
      if (action.action === "respond" || action.action === "check") {
        if (!(await prisma.documentReviewIssue.count({ where: { id: action.data.issueId, documentId: doc.id } })))
          return json({ error: "复核问题不属于此文书版本。" }, 409);
        return json(
          action.action === "respond" ? await respondReviewIssue(action.data) : await checkReviewIssue(action.data),
        );
      }
      if (action.expected.matterId !== matterId) throw new ActionError("文书核对的案件已变化。");
      if (action.action === "submit") return json(await submitDocumentForReview(doc.id, action.expected));
      if (action.action === "reject" && !action.note) return json({ error: "请填写退回原因。" }, 400);
      return json(
        action.action === "approve"
          ? await approveDocument(doc.id, action.note, action.expected)
          : await rejectDocument(doc.id, action.note, action.expected),
      );
    }
    if (q.has("previous"))
      return json(
        await getPreviousDocumentReviewIssue({ documentId: doc.id, issueId: id.parse(q.get("previous")) }),
      );
    if (q.has("sources"))
      return json(
        await getDocumentReviewSourcePage({
          documentId: doc.id,
          query: q.get("q") ?? "",
          cursor: q.get("after") ?? undefined,
        }),
      );
    const review = await getDocumentReview(doc.id);
    const [context, researchInputs] = await Promise.all([
      readDocumentContextInputs(prisma, user.id, doc.id, matterId),
      prisma.documentResearchSource.findMany({
        where: { documentId: doc.id, researchRevision: { matterId } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { researchRevision: { select: { id: true, version: true } } },
      }),
    ]);
    const canReject =
      matter.status !== "ARCHIVED" && doc.status === "PENDING_REVIEW" && (await canApproveItem(user.id, "DOCUMENT_APPROVE", doc.id));
    return json({
      review,
      context,
      researchInputs: researchInputs.map(row => row.researchRevision),
      preview: officePreviewKind(doc.mimeType, doc.name) ? "office" : isInlinePreviewable(doc.mimeType) ? "inline" : null,
      carried: carriedContextInputs(context),
      status: doc.status,
      isLatest: doc.isLatest,
      canReview: doc.isLatest && canReject,
      canReject,
      canSubmit:
        current &&
        doc.status === "DRAFT" &&
        doc.uploadedById === user.id &&
        hasCustomPermission(user, "documents.write"),
      canVersion:
        current &&
        doc.status !== "PENDING_REVIEW" &&
        !context.unavailable &&
        hasCustomPermission(user, "documents.write"),
      expected: {
        matterId,
        version: doc.version,
        status: doc.status,
        reviewedAt: doc.reviewedAt,
        sha256: doc.sha256,
        issues: review.issues.map((i) => ({ id: i.id, version: i.version })),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: "文书核对请求无效。" }, 400);
    if (error instanceof ActionError) return json({ error: error.message }, 409);
    throw error;
  }
}
export { handle as GET, handle as POST };
