import { NextResponse } from "next/server";
import { z } from "zod";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { listEvidenceItems, resolveEvidenceSource } from "@/server/evidence/actions";
import { listMatters } from "@/server/matters/actions";

const noCache = { headers: { "Cache-Control": "no-store" } };
const sourceRequest = z.object({
  evidenceItemId: z.string().cuid(),
  sourceId: z.string().min(1).max(600),
  revision: z.number().int().positive(),
});

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
  const body = sourceRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "出处请求无效。" }, { ...noCache, status: 400 });
  try {
    return NextResponse.json(await resolveEvidenceSource(body.data), noCache);
  } catch {
    return NextResponse.json({ error: "该出处当前无法读取。" }, { ...noCache, status: 403 });
  }
}
