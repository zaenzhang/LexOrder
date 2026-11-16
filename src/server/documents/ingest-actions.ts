"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { assertCanHandleMatter } from "@/lib/permissions";
import { revalidateMatter } from "@/server/matters/route";
import { abandonMaterialIngest, resumeMaterialIngest } from "./material-ingest";

export async function listPendingMaterialUploads(matterId: string) {
  const user = (await requireSession("documents.write")).user;
  const id = z.string().min(1).max(512).parse(matterId);
  await assertCanHandleMatter(user, id);
  const rows = await prisma.materialIngestIntent.findMany({
    where: { matterId: id, requestedById: user.id, state: { not: "COMMITTED" },
      OR: [{ errorCode: null }, { errorCode: { not: "UPLOAD_ABANDONED" } }] },
    orderBy: { createdAt: "desc" }, take: 21,
    select: { id: true, metadata: true, state: true, errorCode: true, createdAt: true },
  });
  return { hasMore: rows.length > 20, items: rows.slice(0, 20).map(row => {
    const metadata = z.object({ document: z.object({ name: z.string() }) }).safeParse(row.metadata);
    const waiting = row.state === "PENDING" && Date.now() - row.createdAt.getTime() < 120_000;
    return { id: row.id, name: metadata.success ? metadata.data.document.name : "未完成材料", waiting,
      description: waiting ? "原件正在保存，请稍后查看" : row.errorCode === "ORIGINAL_UNAVAILABLE" || row.errorCode === "STORAGE_WRITE_FAILED"
        ? "原件保存未完成；可再次尝试恢复，或关闭记录后重新选择文件上传" : "原件尚未登记为材料，可继续处理", };
  }) };
}

export async function continueMaterialUpload(intentId: string) {
  const user = (await requireSession("documents.write")).user;
  const id = z.uuid().parse(intentId);
  const result = await resumeMaterialIngest(id, user.id);
  const intent = await prisma.materialIngestIntent.findUniqueOrThrow({ where: { id }, select: { matterId: true } });
  if (intent.matterId) await revalidateMatter(intent.matterId);
  return result;
}

export async function closeMaterialUpload(intentId: string) {
  const user = (await requireSession("documents.write")).user;
  const result = await abandonMaterialIngest(z.uuid().parse(intentId), user.id);
  if (result.matterId) await revalidateMatter(result.matterId);
}
