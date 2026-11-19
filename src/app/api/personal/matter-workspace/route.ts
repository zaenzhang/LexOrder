import { NextResponse } from "next/server";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { requireSession } from "@/lib/auth/session";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { procedureTypeLabel } from "@/lib/enums";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { listDeliveryRecords } from "@/server/deliveries/actions";
import { listAllDocuments, uploadDocument } from "@/server/documents/actions";
import { confirmEvidenceItem } from "@/server/evidence/actions";
import { getMatterFinance } from "@/server/finance/actions";
import { getMatterById } from "@/server/matters/actions";
import { createNote, listNotes, updateNote } from "@/server/notes/actions";
import { getResearchList } from "@/server/research/actions";
import { listSealRequests } from "@/server/seals/actions";

const headers = { "Cache-Control": "no-store" };
const idSchema = z.string().cuid();
const sections = z.enum(["overview", "materials", "research", "tasks", "delivery", "records", "finance", "seal"]);
const createSchema = z.object({
  action: z.literal("create-note"), matterId: idSchema, content: z.string().trim().min(1).max(5000),
  channel: z.enum(["PHONE", "WECHAT", "EMAIL", "MEETING", "COURT", "OTHER"]),
});
const mutation = z.discriminatedUnion("action", [
  createSchema,
  createSchema.extend({
    action: z.literal("update-note"), id: idSchema, expectedUpdatedAt: z.coerce.date(),
    occurredAt: z.coerce.date(), withWhom: z.string().max(80).optional(),
    tags: z.array(z.string().max(20)),
  }),
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

export async function GET(request: Request) {
  const blocked = denied(request);
  if (blocked) return blocked;
  const query = new URL(request.url).searchParams;
  try {
    const id = idSchema.parse(query.get("matter"));
    const section = sections.parse(query.get("section"));
    const cursor = query.has("cursor") ? idSchema.parse(query.get("cursor")) : undefined;
    if (section === "materials") {
      const documents = await listAllDocuments({ matterId: id, limit: 500 });
      return json({ documents: documents.map(({ id, name, version, isLatest, mimeType, status }) => ({ id, name, version, isLatest, mimeType, status })) });
    }
    if (section === "research") return json(await getResearchList(id, cursor));
    if (section === "delivery") return json(await listDeliveryRecords(id, cursor));
    if (section === "finance") {
      const { stats, entries } = await getMatterFinance(id);
      return json({ stats, entries: entries.map(({ id, type, amount, occurredAt }) => ({ id, type, amount, occurredAt })) });
    }
    const matter = await getMatterById(id);
    if (!matter) return new Response(null, { status: 404, headers });
    if (!matter.businessAccess && section !== "overview") return new Response(null, { status: 403, headers });
    if (section === "overview") {
      const { title, internalCode, status, category, cause, causeFreeText, claimAmount, owner, primaryClient } = matter;
      return json({ title, internalCode, status, category, cause: cause?.name ?? causeFreeText, claimAmount, owner: owner.name, client: primaryClient?.name });
    }
    if (section === "tasks") return json({
      procedures: matter.procedures.map(({ id, type, customLabel, caseNumber, deadlines, hearings, stages }) => ({
        id, name: [customLabel ?? procedureTypeLabel[type], caseNumber].filter(Boolean).join(" · "),
        deadlines: deadlines.map(({ id, title, dueAt, completed }) => ({ id, title, dueAt, completed })),
        hearings: hearings.map(({ id, startsAt }) => ({ id, startsAt })),
        stages: stages.map(({ id, name, tasks }) => ({
          id, name, tasks: tasks.map(({ id, title, dueAt, completed }) => ({ id, title, dueAt, completed })),
        })),
      })),
    });
    if (section === "records") {
      const [notes, session] = await Promise.all([listNotes(id), requireSession()]);
      const canEditNotes = matter.status !== "ARCHIVED" && hasCustomPermission(session.user, "schedule.write");
      return json({
        notes: notes.map(({ id, channel, content, occurredAt, updatedAt, withWhom, tags, authorId, author }) => ({ id, channel, content, occurredAt, updatedAt, withWhom, tags, author: author.name, editable: canEditNotes && authorId === session.user.id })),
        events: matter.timelineEvents.map(({ id, title, occurredAt }) => ({ id, title, occurredAt })),
      });
    }
    const seals = await listSealRequests();
    return json({ seals: seals.filter(row => row.matterId === id).map(({ id, code, documentTitle, status, requestedAt }) => ({ id, code, documentTitle, status, requestedAt })) });
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
      const file = data?.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "请选择要上传的材料。" }, { status: 400, headers });
      const form = new FormData();
      form.set("file", file);
      form.set("matterId", idSchema.parse(data?.get("matterId")));
      form.set("name", z.string().trim().min(1).max(255).parse(data?.get("name")));
      form.set("category", z.string().parse(data?.get("category")));
      form.set("requestKey", z.string().uuid().parse(data?.get("requestKey")));
      const result = await uploadDocument(form);
      if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400, headers });
      return json({ ok: true });
    }
    const input = mutation.parse(await request.json().catch(() => null));
    if (input.action === "confirm-evidence") return json(await confirmEvidenceItem(input));
    if (input.action === "update-note") return json(await updateNote(input));
    return json(await createNote({ ...input, tags: [], occurredAt: new Date() }));
  } catch (error) {
    return failure(error);
  }
}
