import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { decodeMatterParam, matterHref } from "@/lib/matters/route";

/**
 * 把详情页路由参数解析成案件主键。
 *
 * 先精确匹配原编号或旧 ID，再尝试解码值，避免字面 `%xx` 被二次解码。
 * 只有唯一的大小写不敏感编号才允许回退；ID 不做大小写模糊匹配。
 * 精确命中已删除事项或存在歧义时直接拒绝，不跳到另一个相似编号。
 *
 * 返回 `internalCode` 供调用方判断是否需要重定向到规范地址。
 */
export async function resolveMatterRoute(
  param: string
): Promise<{ id: string; internalCode: string } | null> {
  const decoded = decodeMatterParam(param);
  const exactKeys = [...new Set([param.trim(), decoded])].filter(Boolean);
  for (const key of exactKeys) {
    const matches = await prisma.matter.findMany({
      where: { OR: [{ id: key }, { internalCode: key }] },
      select: { id: true, internalCode: true, deletedAt: true },
      take: 2
    });
    if (matches.length > 1) return null;
    if (matches.length === 1) {
      const matter = matches[0];
      return matter.deletedAt ? null : { id: matter.id, internalCode: matter.internalCode };
    }
  }
  if (!decoded) return null;

  const matches = await prisma.matter.findMany({
    where: {
      deletedAt: null,
      internalCode: { equals: decoded, mode: "insensitive" }
    },
    select: { id: true, internalCode: true },
    take: 2
  });
  if (matches.length !== 1) return null;
  const matter = matches[0];
  // 只接受字面编号的大小写差异，查询层返回的其他相似候选不得成为路由。
  return matter.internalCode.toLowerCase() === decoded.toLowerCase() ? matter : null;
}

/**
 * 只拿得到 matterId 时的详情页地址（通知 href 会落库，必须用稳定的编号）。
 */
export async function matterHrefById(matterId: string): Promise<string> {
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { internalCode: true }
  });
  return matterHref({ id: matterId, internalCode: matter?.internalCode ?? null });
}

/**
 * 让案件详情页的缓存失效。
 *
 * 详情页路由键是 `internalCode`，而各 server action 手里只有 matterId，
 * 直接 `revalidatePath(`/matters/${matterId}`)` 会打到一个不存在的路径、
 * 静默失效（表现为改完数据后回退仍看到旧内容，不报错）。
 * 统一走这里换算，避免每个 action 各自拼路径。
 */
export async function revalidateMatter(matterId: string | null | undefined): Promise<void> {
  if (!matterId) return;

  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { internalCode: true }
  });
  if (!matter) return;

  revalidatePath(`/matters/${encodeURIComponent(matter.internalCode)}`);
}
