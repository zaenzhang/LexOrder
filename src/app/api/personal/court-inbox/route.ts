import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { listSmsMessages, markSmsProcessed, matchSmsToMatter, parseAndSaveSms, uploadSmsInboundFile } from "@/server/sms/actions";
import { analyzeSmsInboundFiles, decideSmsSuggestions, listSmsEventTargets, retrySmsSuggestionFiling } from "@/server/sms/confirm-actions";
import { requireSession } from "@/lib/auth/session";
import { assertCanAccessMatter } from "@/lib/permissions";
import { procedureTypeLabel } from "@/lib/enums";
import { savedSmsDecision, smsDecisionInput, suggestionPayload } from "@/lib/sms/suggestions";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";

const headers = { "Cache-Control": "no-store" };
const json = (x: unknown, status = 200) => Response.json(x, { headers, status });
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("paste"), rawText: z.string().trim().min(1).max(8000), batch: z.boolean() }),
  z.object({ action: z.literal("match"), smsId: z.cuid(), matterId: z.cuid() }),
  z.object({ action: z.literal("file"), smsId: z.cuid() }),
  z.object({ action: z.literal("analyze"), smsId: z.cuid(), fileIds: z.array(z.cuid()).min(1).max(5) }),
  smsDecisionInput.extend({ action: z.literal("decide") }),
  z.object({ action: z.literal("finish"), id: z.cuid(), note: z.string().trim().max(500) }),
]);
async function previewPendingFile(fileId: string) {
  const { user } = await requireSession("matters.write");
  const file = await prisma.smsInboundFile.findFirst({ where: { id: fileId, state: "PENDING_REVIEW", documentId: null,
    sms: { receivedById: user.id } }, select: { storageKey: true, mimeType: true, originalName: true } });
  if (!file?.storageKey) return json({ error: "暂存原件不可读取，请重新打开来件。" }, 404);
  const mime = file.mimeType;
  const previewable = mime !== null && ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"].includes(mime);
  try {
    const bytes = await storage.readFile(file.storageKey);
    return new Response(new Uint8Array(bytes), { headers: {
      ...headers, "Content-Type": previewable ? mime : "application/octet-stream",
      "Content-Disposition": (previewable ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(file.originalName),
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
    } });
  } catch {
    return json({ error: "暂存原件不可读取，请核对附件或重新补传。" }, 404);
  }
}

async function handle(req: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(req.headers, { method: req.method })) return new Response(null, { status: 403, headers });
  try {
    if (req.method === "GET") {
      const query = new URL(req.url).searchParams;
      if (query.has("file")) return previewPendingFile(z.cuid().parse(query.get("file")));
      if (query.get("view") === "targets") {
        return json(await listSmsEventTargets({
          smsId: z.cuid().parse(query.get("record")), suggestionId: z.cuid().parse(query.get("suggestion")),
          procedureId: z.cuid().parse(query.get("procedure")), query: query.get("q") ?? "",
        }));
      }
      if (query.get("view") === "list") {
        const { user } = await requireSession("matters.write");
        const matterId = z.cuid().optional().parse(query.get("matter") ?? undefined);
        if (matterId) await assertCanAccessMatter(user.id, user.role, matterId, user.rolePermissions);
        const rows = await prisma.smsMessage.findMany({ where: { receivedById: user.id, matchedMatterId: matterId },
          orderBy: [{ processed: "asc" }, { receivedAt: "desc" }, { id: "desc" }],
          select: { id: true, rawText: true, processed: true, receivedAt: true, matchedMatter: { select: { title: true } },
            inboundFiles: { where: { state: { in: ["PENDING_REVIEW", "FILED"] } }, take: 1, select: { originalName: true, displayName: true } } },
        });
        return json({ items: rows.map(r => ({ id: r.id, receivedAt: r.receivedAt, processed: r.processed,
          title: r.inboundFiles[0]?.displayName ?? r.inboundFiles[0]?.originalName ?? r.rawText.replace(/\s+/g, " ").slice(0, 80),
          matterTitle: r.matchedMatter?.title ?? null,
        })) });
      }
      const record = z.cuid().optional().parse(query.get("record") ?? undefined);
      const processed = z.enum(["unprocessed","processed"]).parse(query.get("state") ?? "unprocessed");
      const matterId = z.cuid().optional().parse(query.get("matter") ?? undefined);
      const rows = await listSmsMessages({ scope: "mine", processed: record ? "all" : processed, matterId, id: record });
      return json({ items: rows.map(r => ({
        id: r.id, receivedAt: r.receivedAt, text: r.rawText, note: r.processingNote, processed: r.processed,
        matter: r.matchedMatter && { id: r.matchedMatter.id, title: r.matchedMatter.title, code: r.matchedMatter.internalCode },
        files: r.inboundFiles.map(f => ({ id: f.id, name: f.displayName ?? f.originalName, state: f.state,
          documentId: f.documentId, mime: f.mimeType, analysisState: f.analysisState, analysisError: f.analysisError })),
        ...(record ? {
          procedures: r.matchedMatter?.procedures.map(p => ({ id: p.id, label: p.customLabel ?? procedureTypeLabel[p.type], caseNumber: p.caseNumber })) ?? [],
          suggestions: r.suggestions.filter(s => s.kind !== "DOC_TYPE").map(s => {
            const payload = suggestionPayload(s.payload);
            const receipt = savedSmsDecision(s.payload);
            const event = suggestionPayload(receipt ? suggestionPayload(receipt.request).event : null);
            return { id: s.id, kind: s.kind, status: s.status, updatedAt: s.updatedAt, fileId: s.fileId, page: s.sourcePage,
              excerpt: s.sourceExcerpt, value: s.suggestedValue, currentValue: s.currentValue, fieldKey: s.fieldKey,
              proposal: { procedure: payload.procedureId, title: payload.title, day: payload.dateText, time: payload.timeText },
              result: receipt ? { outcome: receipt.result.outcome, type: receipt.result.targetType, target: receipt.result.targetId,
                program: event.procedureId, day: event.dateText ?? payload.dateText } : null };
          }),
        } : {}),
      })) });
    }
    if (req.headers.get("content-type")?.startsWith("multipart/form-data;")) {
      if (Number(req.headers.get("content-length")) > 21 * 1024 * 1024) return json({ error: "单次补传限 20 MB。" }, 413);
      return json(await uploadSmsInboundFile(await req.formData()));
    }
    const op = inputSchema.parse(await req.json().catch(() => null));
    if (op.action === "paste") return json(await parseAndSaveSms({ ...op, useAi: false, extractAttachments: false }));
    if (op.action === "match") return json(await matchSmsToMatter({ ...op, expectedMatterId: null }));
    if (op.action === "analyze") return json(await analyzeSmsInboundFiles(op));
    if (op.action === "decide") return json(await decideSmsSuggestions(op));
    if (op.action === "file") return json(await retrySmsSuggestionFiling(op.smsId));
    return json(await markSmsProcessed(op));
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message || "输入无效。" }, 400);
    if (error instanceof ActionError) return json({ error: error.message }, 409);
    throw error;
  }
}
export { handle as GET, handle as POST };
