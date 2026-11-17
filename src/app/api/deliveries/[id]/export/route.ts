import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/action-error";
import { exportDeliverySchema } from "@/server/deliveries/contracts";
import { exportDeliveryForActor } from "@/server/deliveries/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // NextRequest normalizes loopback URLs to localhost; it is not the browser's
  // original origin. Use the configured Server entry, never forwarded host input.
  let applicationOrigin: string;
  try {
    const configured = new URL(process.env.NEXTAUTH_URL ?? "");
    if (!["http:", "https:"].includes(configured.protocol)) throw new Error("Invalid application origin");
    applicationOrigin = configured.origin;
  } catch {
    return NextResponse.json({ error: "服务入口地址未正确配置，请联系管理员" }, { status: 503 });
  }
  if (request.headers.get("origin") !== applicationOrigin) {
    return NextResponse.json({ error: "请从当前工作台发起导出" }, { status: 403 });
  }
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "导出请求无效" }, { status: 400 }); }
  const input = exportDeliverySchema.safeParse(body);
  if (!input.success) return NextResponse.json({ error: input.error.issues[0].message }, { status: 400 });
  try {
    const { id } = await params;
    const result = await exportDeliveryForActor(session.user.id, id, input.data);
    return new NextResponse(new Uint8Array(result.buffer), { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      "Content-Length": String(result.buffer.length), "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "X-Delivery-Event": result.eventId,
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ActionError ? error.message : "导出未完成，请保留清单后重试" }, { status: 400 });
  }
}
