import path from "node:path";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { requireSession } from "@/lib/auth/session";
import { assertDocumentWritable } from "@/lib/archive/guard";
import { assertCanHandleMatter } from "@/lib/permissions";
import { issueCheckoutToken, verifyCheckoutToken } from "@/lib/desktop/checkout-token";
import { draftExtension } from "@/lib/desktop/working-format";
import { prisma } from "@/lib/prisma";
import { isPersonalMode } from "@/lib/runtime/mode";
import { matterSubdirectory } from "@/lib/runtime/matter-folders";
import { PERSONAL_CHANNEL_COOKIE, personalChannelAllowed, personalRuntime } from "@/lib/runtime/personal-channel";
import { watchWorkingFile, unwatchWorkingFile } from "@/server/desktop/working-watch";
import { openDefaultEditor } from "@/server/desktop/default-editor";
import { ClosedDraftIntent, WorkingCopies } from "@/server/desktop/working-copies";
import { uploadNewVersion } from "@/server/documents/actions";
import { assertDocumentDerivationAccess } from "@/server/documents/derivation-access";
import { abandonMaterialIngest, resumeMaterialIngest } from "@/server/documents/material-ingest";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), matterId: z.cuid(), documentId: z.cuid() }),
  z.object({ action: z.literal("sync"), sessionId: z.uuid().optional() }),
  z.object({ action: z.literal("reopen"), matterId: z.cuid(), sessionId: z.uuid() }),
  z.object({ action: z.literal("finish"), matterId: z.cuid(), sessionId: z.uuid(), keepLocal: z.boolean() }),
]);
const headers = { "Cache-Control": "no-store" };
// The personal runtime is single-writer. Serialize requests from every window,
// including duplicate focus/save notifications and opening the same draft twice.
let previous: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>) {
  const current = previous.then(work, work);
  previous = current.catch(() => {});
  return current;
}

async function workingCopies() {
  const runtime = personalRuntime();
  const { user } = await requireSession("documents.write");
  const cookie = { Cookie: PERSONAL_CHANNEL_COOKIE + "=" + runtime.token, Origin: runtime.origin };

  async function document(matterId: string, id: string) {
    await assertCanHandleMatter(user, matterId);
    await assertDocumentWritable(matterId, { kind: "modify" });
    const doc = await prisma.document.findFirst({ where: { id, matterId, deletedAt: null },
      include: { contextInputs: true, reviewReportFor: { select: { id: true } } } });
    if (!doc) throw new ActionError("找不到该案件的工作稿。");
    if (!doc.isLatest) throw new ActionError("版本冲突，本机稿已保留。请从材料列表打开当前版本核对。");
    const extension = draftExtension(doc);
    if (!extension || doc.reviewReportFor || doc.tags.includes("AI审查")) throw new ActionError("当前材料状态只能查看。");
    await assertDocumentDerivationAccess(user.id, doc.id, { purpose: "SUBMIT" });
    return { doc, extension };
  }

  return new WorkingCopies(path.join(path.dirname(runtime.manifestPath), "working-copies", runtime.workspaceId, user.id), {
    drafts: id => matterSubdirectory(id, "工作稿"),
    launch: openDefaultEditor,
    watch: (file, id, directory) => watchWorkingFile(runtime.workspaceId, id, file, directory, async () => {
      // Start a fresh authenticated request for each return. Detached native
      // events never reuse Next's request-scoped session or database authority.
      await fetch(runtime.origin + "/api/personal/working-copies", { method: "POST", headers: { ...cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", sessionId: id }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
    }),
    unwatch: id => unwatchWorkingFile(runtime.workspaceId, id),
    read: async (matterId, id) => {
      await assertCanHandleMatter(user, matterId);
      if (!await prisma.document.count({ where: { id, matterId, deletedAt: null } })) throw new ActionError("原材料已撤回。");
      await assertDocumentDerivationAccess(user.id, id, { purpose: "READ" });
    },
    checkout: async (matterId, id) => {
      const { doc, extension } = await document(matterId, id);
      const checkout = await fetch(runtime.origin + "/api/desktop/checkout", { method: "POST", cache: "no-store", redirect: "error",
        headers: { ...cookie, "Content-Type": "application/json" }, body: JSON.stringify({ documentId: id }) });
      if (!checkout.ok) throw new ActionError("无法签出当前版本，请刷新案件材料。");
      const ticket = await checkout.json() as { token: string; documentId: string; baselineVersion: number };
      const binding = verifyCheckoutToken(ticket.token);
      if (!binding || binding.docId !== id || binding.userId !== user.id || ticket.documentId !== id || ticket.baselineVersion !== doc.version) throw new ActionError("签出版本已变化，请刷新材料。");
      const response = await fetch(runtime.origin + "/api/desktop/file?token=" + encodeURIComponent(ticket.token),
        { headers: cookie, redirect: "error", cache: "no-store" });
      if (!response.ok) throw new ActionError("工作稿原件暂不可读。");
      return { doc: { id, matterId, name: doc.name, version: doc.version, familyId: doc.familyId ?? id, extension, checkoutJti: binding.jti },
        bytes: Buffer.from(await response.arrayBuffer()) };
    },
    save: async (copy, bytes, requestKey) => {
      // Recover the original receipt before comparing heads. A previous request
      // may already have created V2 and lost its response during a restart.
      const intent = await prisma.materialIngestIntent.findUnique({ where: { id: requestKey } });
      if (intent) {
        if (intent.requestedById !== user.id || intent.matterId !== copy.matterId || intent.priorDocumentId !== copy.id)
          throw new ActionError("保存回执与本案工作稿不符，请保留本机稿。");
        if (intent.errorCode === "ORIGINAL_UNAVAILABLE" || intent.errorCode === "UPLOAD_ABANDONED") {
          if (intent.errorCode !== "UPLOAD_ABANDONED") await abandonMaterialIngest(requestKey, user.id);
          throw new ClosedDraftIntent("旧回执已关闭，正在使用保留的工作稿重新保存。");
        }
        return resumeMaterialIngest(requestKey, user.id);
      }
      const { doc, extension } = await document(copy.matterId, copy.id);
      if ((doc.familyId ?? doc.id) !== copy.familyId || doc.version !== copy.version || extension !== copy.extension)
        throw new ActionError("工作稿基线已变化，请从材料列表核对。");
      const ticket = issueCheckoutToken({ docId: doc.id, userId: user.id, baselineVersion: copy.version, fileName: doc.name }, copy.checkoutJti);
      const name = doc.name.toLowerCase().endsWith(extension) ? doc.name : doc.name + extension;
      return uploadNewVersion({ documentId: doc.id, file: new File([new Uint8Array(bytes)], name, { type: doc.mimeType! }),
        requestKey, checkoutToken: ticket.token, draftOnly: true,
        contextInputs: doc.contextInputs.map(row => ({ recordId: row.contextRecordId,
          expectedCurrentRecordId: row.currentRecordIdAtAdoption, expectedConfirmedAt: row.adoptedConfirmedAt?.toISOString() ?? null })) });
    },
  });
}

export async function POST(request: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(request.headers, { method: "POST" })) return new Response(null, { status: 403, headers });
  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "工作稿请求无效。" }, { status: 400, headers });
  try {
    const input = parsed.data;
    const result = await serialize(async () => {
      const copies = await workingCopies();
      if (input.action === "open") return copies.open(input.matterId, input.documentId);
      if (input.action === "reopen") { await copies.reopen(input.matterId, input.sessionId); return { ok: true }; }
      if (input.action === "finish") { await copies.finish(input.matterId, input.sessionId, input.keepLocal); return { ok: true }; }
      return copies.sync(input.sessionId);
    });
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof ActionError ? error.message : "工作稿操作未完成，请检查案件目录或稍后重试。" },
      { status: error instanceof ActionError ? 409 : 503, headers });
  }
}
