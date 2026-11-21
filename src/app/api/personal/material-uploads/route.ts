import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { requireSession } from "@/lib/auth/session";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { listPendingMaterialUploads } from "@/server/documents/ingest-actions";
import { abandonMaterialIngest, resumeMaterialIngest } from "@/server/documents/material-ingest";

const requestSchema = z.strictObject({ matterId: z.cuid(), uploadId: z.uuid(), action: z.enum(["continue", "close"]) });
const headers = { "Cache-Control": "no-store" };

async function handle(request: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(request.headers, { method: request.method })) return new Response(null, { status: 403, headers });
  try {
    if (request.method === "GET") {
      const matterId = z.cuid().parse(new URL(request.url).searchParams.get("matter"));
      return Response.json(await listPendingMaterialUploads(matterId, true), { headers });
    }
    const { user } = await requireSession("documents.write");
    const form = request.headers.get("content-type")?.startsWith("multipart/form-data;") ? await request.formData() : null;
    const { matterId, uploadId, action } = requestSchema.parse(form
      ? { matterId: form.get("matterId"), uploadId: form.get("uploadId"), action: form.get("action") }
      : await request.json().catch(() => null));
    if (action === "close" && !form) {
      await abandonMaterialIngest(uploadId, user.id, matterId);
      return Response.json({ ok: true }, { headers });
    }
    const file = form?.get("file");
    if (form && (action !== "continue" || !(file instanceof File) || file.size > 20 * 1024 * 1024)) {
      return Response.json({ error: "请选择 20 MB 以内的原文件。" }, { status: 400, headers });
    }
    const result = await resumeMaterialIngest(uploadId, user.id, {
      caseUpload: { matterId, ...(file instanceof File && { file: Buffer.from(await file.arrayBuffer()) }) },
    });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "上传恢复请求无效。" }, { status: 400, headers });
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: 409, headers });
    throw error;
  }
}

export { handle as GET, handle as POST };
