import { NextResponse } from "next/server";
import { z } from "zod";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { confirmEvidenceItem, listEvidenceItems, resolveEvidenceSource } from "@/server/evidence/actions";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action-error";
import { requireSession } from "@/lib/auth/session";
import { contextAccess } from "@/server/matters/context-service";
import { getResearchHistory, getResearchSource } from "@/server/research/actions";
import { factReviewRequest, saveFactReview } from "./fact-review";
import { listMatters } from "@/server/matters/actions";

const noCache = { headers: { "Cache-Control": "no-store" } };
const requestSchema = z.discriminatedUnion("action", [z.object({
  action: z.literal("open-evidence-source"),
  matterId: z.string().cuid(),
  evidenceItemId: z.string().cuid(),
  sourceId: z.string().min(1).max(600),
  revision: z.number().int().positive(),
}), factReviewRequest, z.object({
  action: z.literal("confirm-issue"), matterId: z.string().cuid(), evidenceItemId: z.string().cuid(),
  expectedRevision: z.number().int().positive(), confirm: z.literal(true),
}), z.object({
  action: z.literal("open-research-source"), matterId: z.string().cuid(),
  researchId: z.string().cuid(), sourceId: z.string().min(1).max(800),
})]);

function check(request: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404 });
  if (!personalChannelAllowed(request.headers, { method: request.method })) {
    return new Response(null, { status: 403 });
  }
}

export async function GET(request: Request) {
  const denied = check(request);
  if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const matterId = query.get("matter");
  try {
    if (matterId === null) {
      const page = z.coerce.number().int().min(1).parse(query.get("page") ?? "1");
      const result = await listMatters({ page, pageSize: 20, search: query.get("q")?.trim() || undefined });
      return NextResponse.json({
        matters: result.items.map(({ id, title, internalCode }) => ({ id, title, internalCode })),
        hasMore: result.page * result.pageSize < result.total,
      }, noCache);
    }
    if (query.has("research")) {
      const before = query.has("before") ? z.coerce.number().int().positive().parse(query.get("before")) : undefined;
      const history = await getResearchHistory(z.string().cuid().parse(matterId), z.string().cuid().parse(query.get("research")), before);
      return NextResponse.json({ nextVersion: history.nextVersion,
        records: history.records.map(({ id, version, checkedAt, readable }) => ({ id, version, checkedAt, readable })) }, noCache);
    }
    const items = await listEvidenceItems(z.string().cuid().parse(matterId));
    return NextResponse.json({ issues: items.filter(item => item.kind === "ISSUE") }, noCache);
  } catch (error) {
    return NextResponse.json({ error: "无法读取案卷，请核对当前工作区。" }, {
      ...noCache, status: error instanceof z.ZodError ? 400 : 403,
    });
  }
}

export async function POST(request: Request) {
  const denied = check(request);
  if (denied) return denied;
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "出处请求无效。" }, { ...noCache, status: 400 });
  try {
    const input = body.data;
    if (input.action === "save-fact-review") return NextResponse.json(await saveFactReview(input), noCache);
    if (input.action === "open-research-source") {
      return NextResponse.json(await getResearchSource(input.matterId, input.researchId, input.sourceId), noCache);
    }
    const { user } = await requireSession(input.action === "confirm-issue" ? "matters.write" : "matters.read");
    await prisma.$transaction(async tx => {
      await contextAccess(tx, user, input.matterId);
      const item = await tx.evidenceItem.findFirst({
        where: { id: input.evidenceItemId, matterId: input.matterId }, select: { id: true },
      });
      if (!item) throw new ActionError("该出处当前无法读取");
    });
    if (input.action === "confirm-issue") return NextResponse.json(await confirmEvidenceItem(input), noCache);
    return NextResponse.json(await resolveEvidenceSource(input), noCache);
  } catch (error) {
    return NextResponse.json({ error: error instanceof ActionError ? error.message : "事实研究操作失败，请刷新后重试。" }, { ...noCache, status: 403 });
  }
}
