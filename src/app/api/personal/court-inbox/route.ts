import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { listSmsMessages, markSmsProcessed, matchSmsToMatter, parseAndSaveSms, uploadSmsInboundFile } from "@/server/sms/actions";
import { retrySmsSuggestionFiling } from "@/server/sms/confirm-actions";

const headers = { "Cache-Control": "no-store" };
const json = (x: unknown, status = 200) => Response.json(x, { headers, status });
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("paste"), rawText: z.string().trim().min(1).max(8000), batch: z.boolean() }),
  z.object({ action: z.literal("match"), smsId: z.cuid(), matterId: z.cuid() }),
  z.object({ action: z.literal("file"), smsId: z.cuid() }),
  z.object({ action: z.literal("finish"), id: z.cuid(), note: z.string().trim().max(500) }),
]);
async function handle(req: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(req.headers, { method: req.method })) return new Response(null, { status: 403, headers });
  try {
    if (req.method === "GET") {
      const processed = z.enum(["unprocessed","processed"]).parse(new URL(req.url).searchParams.get("state") ?? "unprocessed");
      const rows = await listSmsMessages({ scope: "mine", processed });
      return json({ items: rows.map(r => ({ id: r.id, receivedAt: r.receivedAt, text: r.rawText, note: r.processingNote, processed: r.processed,
        matter: r.matchedMatter && { id: r.matchedMatter.id, title: r.matchedMatter.title, code: r.matchedMatter.internalCode },
        files: r.inboundFiles.map(f => ({ id: f.id, name: f.originalName, state: f.state, documentId: f.documentId })),
      })) });
    }
    if (req.headers.get("content-type")?.startsWith("multipart/form-data;")) {
      if (Number(req.headers.get("content-length")) > 21 * 1024 * 1024) return json({ error: "单次补传限 20 MB。" }, 413);
      return json(await uploadSmsInboundFile(await req.formData()));
    }
    const op = inputSchema.parse(await req.json().catch(() => null));
    if (op.action === "paste") return json(await parseAndSaveSms({ ...op, useAi: false, extractAttachments: false }));
    if (op.action === "match") return json(await matchSmsToMatter({ ...op, expectedMatterId: null }));
    if (op.action === "file") return json(await retrySmsSuggestionFiling(op.smsId));
    return json(await markSmsProcessed(op));
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message || "输入无效。" }, 400);
    if (error instanceof ActionError) return json({ error: error.message }, 409);
    throw error;
  }
}
export { handle as GET, handle as POST };
