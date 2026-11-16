import { hasCustomPermission } from "@/lib/roles/catalog";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { auditTx } from "@/server/audit";
import { approvalTransaction } from "@/lib/approvals/service";
import { Prisma } from "@prisma/client";
import { buildArchiveZip, assertArchiveExportAccess } from "@/server/archive/export";
import { storage } from "@/lib/storage";
import { ActionError, actionErrorMessage } from "@/lib/action-error";
import { parseArchiveSnapshot } from "@/lib/archive/snapshot";
import { assertMatterExportAccess, assertExportDocumentAccess, exportDocumentAccessSelect, MatterExportAccessError } from "@/server/matters/export-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ matterId: string }> }
) {
  const { matterId } = await params;
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!hasCustomPermission(session.user, "matters.export")) return NextResponse.json({ error: "无导出权限" }, { status: 403 });
  if (!hasCustomPermission(session.user, "matters.read") || !hasCustomPermission(session.user, "archive.read") || !hasCustomPermission(session.user, "documents.download")) return NextResponse.json({ error: "导出归档材料需要案件查看、归档查看和材料下载权限" }, { status: 403 });

  try {
    await assertMatterExportAccess(session.user, matterId, "ARCHIVE");
  } catch (error) {
    if (error instanceof MatterExportAccessError) return NextResponse.json({ error: actionErrorMessage(error) }, { status: 403 });
    throw error;
  }

  // 完整归档包仍需当前经办关联，概况可见或业务管理权不能替代。
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true, status: true, internalCode: true }
  });
  if (!matter) return NextResponse.json({ error: "案件不存在" }, { status: 404 });
  if (matter.status !== "ARCHIVED") {
    return NextResponse.json({ error: "案件尚未归档" }, { status: 400 });
  }

  const requestedArchiveId = new URL(req.url).searchParams.get("archiveId");
  const archive = await prisma.archiveRecord.findFirst({
    where: {
      matterId: matter.id,
      status: "APPROVED",
      ...(requestedArchiveId ? { id: requestedArchiveId } : {})
    },
    orderBy: { reviewedAt: "desc" },
    select: { id: true, archiveNo: true, checklistJson: true }
  });
  if (!archive) return NextResponse.json({ error: "指定归档记录不存在或尚未批准" }, { status: 404 });

  let result;
  try {
    const snapshot = parseArchiveSnapshot(archive.checklistJson);
    if (!snapshot) throw new ActionError("该历史归档记录未固定批准材料，不能生成可核验归档包");
    const ids = [...new Set(snapshot.documents.map(document => document.id))];
    const documents = await prisma.document.findMany({ where: { id: { in: ids }, deletedAt: null }, select: exportDocumentAccessSelect });
    if (documents.length !== ids.length) throw new MatterExportAccessError("部分归档材料已不可读取，无法导出完整案卷");
    await assertExportDocumentAccess(session.user.id, documents);
    result = await buildArchiveZip(archive.id, session.user);
  } catch (err) {
    if (err instanceof MatterExportAccessError) return NextResponse.json({ error: actionErrorMessage(err) }, { status: 403 });
    console.error("[archive export] 构建失败：", err);
    return NextResponse.json(
      { error: err instanceof Error ? actionErrorMessage(err) : "导出失败" },
      { status: 500 }
    );
  }

  let storagePath: string | undefined;
  try {
    storagePath = await storage.writeFile(`archive_${matter.id}`, result.buffer);
  } catch (err) {
    console.error("[archive export] 落盘失败（不阻断下载）：", err);
  }

  let updateStarted = false;
  try {
    await approvalTransaction(async db => {
      await assertArchiveExportAccess(archive.id, session.user, db);
      if (storagePath) {
        updateStarted = true;
        await db.archiveRecord.update({ where: { id: archive.id }, data: { exportPath: storagePath, checksum: result.checksum } });
      }
      await auditTx(db, { userId: session.user.id, action: "ARCHIVE_EXPORT", targetType: "ArchiveRecord", targetId: archive.id,
        detail: { matterId: matter.id, archiveNo: archive.archiveNo, size: result.size, checksum: result.checksum } });
    }, Prisma.TransactionIsolationLevel.ReadCommitted);
  }
  catch (error) {
    // Once a write starts, commit outcome may be unknown: retain the original for recovery.
    if (storagePath && !updateStarted) await storage.deleteFile(storagePath).catch(() => undefined);
    return NextResponse.json({ error: actionErrorMessage(error) }, { status: error instanceof MatterExportAccessError ? 403 : 400 });
  }

  const ab = result.buffer.buffer.slice(
    result.buffer.byteOffset,
    result.buffer.byteOffset + result.buffer.byteLength
  ) as ArrayBuffer;

  return new NextResponse(ab, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(result.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
    }
  });
}
