import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { requireSession } from "@/lib/auth/session";
import { matterAssociationFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { getClosureBoard, saveClosure } from "@/server/archive/closure-actions";
import { closureInput } from "@/server/archive/closure";
import { createExpress, listExpress, refreshExpress } from "@/server/express/actions";
import { expressCreateSchema } from "@/server/express/schemas";
import { createPreservationCase, listPreservationCases, renewProperty } from "@/server/preservations/actions-v2";
import { caseCreateSchema, propertyRenewSchema } from "@/server/preservations/schemas-v2";

const headers = { "Cache-Control": "no-store" };
const json = (x: unknown, status = 200) => Response.json(x, { status, headers });
const matterId = z.cuid();
const action = z.discriminatedUnion("action", [
  expressCreateSchema.extend({ action: z.literal("express"), matterId }),
  z.object({ action: z.literal("track"), matterId, id: z.cuid() }),
  caseCreateSchema.omit({ ownerId: true }).extend({ action: z.literal("preserve"), matterId }),
  propertyRenewSchema.extend({ action: z.literal("renew"), matterId }),
  closureInput.omit({ financeOwnerId: true }).extend({ action: z.literal("closure"), personalFinance: z.boolean() }),
]);
async function handle(req: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(req.headers, { method: req.method })) return new Response(null, { status: 403, headers });
  try {
    const { user } = await requireSession("matters.read");
    const params = new URL(req.url).searchParams;
    if (req.method === "GET" && !params.has("matter")) {
      const q = z.string().trim().max(100).parse(params.get("q") || "");
      const matters = await prisma.matter.findMany({ where: { deletedAt: null, AND: [matterAssociationFilter(user.id),
        ...(q ? [{ OR: [{ title: { contains: q } }, { internalCode: { contains: q } }] }] : [])] },
        take: 30, select: { id: true, title: true, internalCode: true }, orderBy: [{ internalCode: "asc" }, { id: "asc" }] });
      return json({ matters });
    }
    const op = req.method === "POST" ? action.parse(await req.json().catch(() => null)) : null;
    const id = op?.matterId ?? matterId.parse(params.get("matter"));
    const matter = await prisma.matter.findFirst({ where: { id, deletedAt: null, ...matterAssociationFilter(user.id) }, select: { id: true, internalCode: true, title: true, status: true } });
    if (!matter) return json({ error: "案件不存在或不可办理。" }, 404);
    if (op) {
      if (op.action === "express") return json(await createExpress(op));
      if (op.action === "track") {
        if (!await prisma.expressTracking.count({ where: { id: op.id, matterId: id } })) throw new ActionError("该快递不属于本案。");
        return json(await refreshExpress({ id: op.id }));
      }
      if (op.action === "preserve") {
        if (op.firstPropertyType && (!op.firstTarget?.trim() || !op.firstStartDate || !op.firstDuration || !op.firstExpiryDate || op.firstExpiryDate <= op.firstStartDate))
          throw new ActionError("请核对被保全人、保全期限和生效、到期日期。");
        return json(await createPreservationCase({ ...op, ownerId: user.id }));
      }
      if (op.action === "renew") {
        if (!await prisma.preservationProperty.count({ where: { id: op.propertyId, target: { case: { matterId: id } } } })) throw new ActionError("该保全财产不属于本案。");
        return json(await renewProperty(op));
      }
      return json(await saveClosure({ ...op, financeOwnerId: op.personalFinance ? user.id : null }));
    }
    const section = z.enum(["express", "preservation", "closure"]).parse(params.get("section"));
    if (section === "express") {
      const items = await listExpress({ matterId: id });
      return json({ matter, writable: matter.status !== "ARCHIVED", items: items.map(r => ({
        id: r.id, trackingNo: r.trackingNo, direction: r.direction, purpose: r.purpose, recipient: r.recipient,
        company: r.companyCode, state: r.lastState, updated: r.lastUpdateAt, traces: r.tracesJson,
      })) });
    }
    if (section === "preservation") {
      const items = await listPreservationCases({ matterId: id, status: "ALL" });
      return json({ matter, writable: matter.status !== "ARCHIVED", items: items.map(r => ({
        id: r.id, type: r.type, status: r.status, court: r.court, rulingNumber: r.rulingNumber, note: r.note,
        targets: r.targets.map(t => ({ name: t.name, id: t.id, properties: t.properties.map(p => ({
          id: p.id, type: p.propertyType, detail: p.propertyDetail, amount: p.amount, expiry: p.expiryDate, status: p.status,
          renewals: p.renewals.map(e => ({ id: e.id, date: e.newExpiryDate, note: e.note })),
        })) })),
      })) });
    }
    const board = await getClosureBoard(id);
    if (!board) return json({ error: "本案归档检查尚不可用。" }, 409);
    return json({ matter, writable: board.status !== "ARCHIVED" && board.canSave, blockers: board.blockers, financeOpen: board.financeOpen,
      plan: board.plan && { reason: board.plan.reason, date: board.plan.serviceCompletedAt, revision: board.plan.revision, current: board.plan.current, personalFinance: board.plan.financeOwnerId === user.id },
      archives: board.archives.map(a => ({ id: a.id, no: a.archiveNo, status: a.status })) });
  } catch (e) {
    if (e instanceof ActionError) return json({ error: e.message }, 409);
    if (e instanceof z.ZodError) return json({ error: e.issues[0]?.message || "请核对登记内容。" }, 400);
    throw e;
  }
}
export { handle as GET, handle as POST };
