/**
 * M-3c（D 批）：在办案件单案卷宗打包导出（ZIP：manifest + 材料 + 记录）。
 * 权限与案件工作簿导出同口径（matters.export + matters.read/finance.read/documents.download；
 * 财务岗走财务导出），另加本案读取断言；下载经鉴权一次性生成，不留公开直链。
 */
import { hasCustomPermission } from "@/lib/roles/catalog";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { buildMatterBundle } from "@/server/matters/export-bundle";
import { MatterExportAccessError } from "@/server/matters/export-access";
import { actionErrorMessage } from "@/lib/action-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!hasCustomPermission(session.user, "matters.export")) return NextResponse.json({ error: "无导出权限" }, { status: 403 });
  if (session.user.role === "FINANCE") return NextResponse.json({ error: "财务账号请使用财务流水导出，案件卷宗含当事人证件信息" }, { status: 403 });
  if (!hasCustomPermission(session.user, "matters.read") || !hasCustomPermission(session.user, "finance.read") || !hasCustomPermission(session.user, "documents.download")) {
    return NextResponse.json({ error: "导出完整案件需要案件查看、财务查看和材料下载权限" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const bundle = await buildMatterBundle(id, session.user);
    await audit({
      userId: session.user.id,
      action: "MATTER_BUNDLE_EXPORT",
      targetType: "Matter",
      targetId: id,
      detail: { size: bundle.size, checksum: bundle.checksum }
    });
    return new NextResponse(new Uint8Array(bundle.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(bundle.fileName)}`,
        "X-Bundle-Sha256": bundle.checksum
      }
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? actionErrorMessage(err) : "生成失败" }, { status: err instanceof MatterExportAccessError ? 403 : 400 });
  }
}
