import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { getSession } from "@/lib/auth/session";
import { matterAssociationFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isPersonalMode } from "@/lib/runtime/mode";
import { changeMatterFolder, matterFolderState } from "@/lib/runtime/matter-folders";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { getStorageRoot } from "@/lib/storage/local";

const id = z.string().cuid();
const location = z.string().min(1).max(4096);
const changes = z.discriminatedUnion("action", [
  z.object({ matterId: id, action: z.literal("bind"), root: location }),
  z.object({ matterId: id, action: z.literal("relocate"), path: location }),
  z.object({ matterId: id, action: z.literal("cancel-copy"), stagePath: location }),
]);
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

async function retainedOriginals(matterId: string) {
  const documents = await prisma.document.findMany({
    where: { matterId },
    select: { id: true, deletedAt: true, path: true, size: true, sha256: true, encrypted: true, iv: true, authTag: true },
  });
  const withdrawn = documents.filter(doc => doc.deletedAt).map(doc => doc.id);
  if (withdrawn.length === 0) return documents;
  // Withdrawal keeps the file. Only an explicit, completed purge retires its bytes.
  const removed = await prisma.auditLog.findMany({
    where: { action: "DOCUMENT_PURGED", targetType: "Document", targetId: { in: withdrawn } },
    select: { targetId: true },
  });
  const purged = new Set(removed.map(entry => entry.targetId));
  return documents.filter(doc => !purged.has(doc.id));
}

async function handle(request: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(request.headers, { method: request.method })) return new Response(null, { status: 403, headers });
  const session = await getSession();
  if (!session) return new Response(null, { status: 403, headers });
  try {
    const change = request.method === "POST" ? changes.parse(await request.json().catch(() => null)) : null;
    const matterId = change?.matterId ?? id.parse(new URL(request.url).searchParams.get("matter"));
    const matter = await prisma.matter.findFirst({
      where: { id: matterId, deletedAt: null, ...matterAssociationFilter(session.user.id) },
      select: { id: true, title: true, internalCode: true, status: true, intakeId: true },
    });
    if (!matter) return fail("案件不存在或无权处理", 404);
    if (change?.action === "bind" && matter.status === "ARCHIVED") return fail("案件已归档，禁止新增目录绑定", 403);
    // Relocating a previously bound archive only restores access to its
    // original bytes. It cannot create or revise a material version.
    const originals = change?.action === "relocate" ? await retainedOriginals(matterId) : undefined;
    const state = change ? await changeMatterFolder(matter, change, getStorageRoot(), originals) : await matterFolderState(matter);
    return Response.json(state, { headers });
  } catch (error) {
    if (error instanceof z.ZodError) return fail("案件目录请求无效", 400);
    if (error instanceof ActionError) return fail(error.message, 409);
    switch ((error as NodeJS.ErrnoException).code) {
      case "ENOENT": case "ENOTDIR": return fail("所选目录不存在或磁盘未连接", 400);
      case "EPERM": case "EACCES": case "EROFS": return fail("无权访问所选目录，请检查目录权限", 403);
      case "ENOSPC": return fail("磁盘空间不足，未完成目录绑定", 507);
      default: return fail("本机目录读写失败，请检查工作区和磁盘", 500);
    }
  }
}
export { handle as GET, handle as POST };
