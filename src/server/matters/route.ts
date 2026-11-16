import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { matterHref } from "@/lib/matters/route";

/**
 * Next 已解码动态路由参数；只精确匹配实际编号，不再解码或规范化。
 * 这里只解析身份，调用页面仍须通过现有案件读取服务校验访问资格。
 */
export async function resolveMatterRoute(
  param: string
): Promise<{ id: string; internalCode: string } | null> {
  const matter = await prisma.matter.findUnique({
    where: { internalCode: param },
    select: { id: true, internalCode: true, deletedAt: true }
  });
  return !matter || matter.deletedAt ? null : { id: matter.id, internalCode: matter.internalCode };
}

/**
 * 只拿得到 matterId 时的详情页地址（通知 href 会落库，必须用稳定的编号）。
 */
export async function matterHrefById(matterId: string): Promise<string> {
  const matter = await prisma.matter.findUniqueOrThrow({
    where: { id: matterId },
    select: { internalCode: true }
  });
  return matterHref(matter);
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

  revalidatePath(matterHref(matter));
}
