import { customOrLegacy } from "@/lib/roles/catalog";
import { isManager as canManage } from "@/lib/permissions";
/**
 * v0.38: 律所文书恢复独立页（v0.37 曾并入 /service-center，现拆回真实页面）
 * v0.44: 分类改为合同/函件/证照/其他
 */
import type { FirmFileCategory } from "@prisma/client";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listFirmFiles } from "@/server/firm-files/actions";
import { FirmFilesView } from "./_components/firm-files-view";

const VALID_CATEGORIES: FirmFileCategory[] = ["CONTRACT", "LETTER", "LICENSE", "OTHER_FIRM"];

export default async function FirmResourcesPage({
  searchParams
}: {
  searchParams: Promise<{ category?: string; q?: string; includeOld?: string }>;
}) {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  const filters = await searchParams;

  const isManager =
    customOrLegacy(session.user, "firm-files.manage", canManage(session.user));

  const category =
    filters.category && (VALID_CATEGORIES as string[]).includes(filters.category)
      ? (filters.category as FirmFileCategory)
      : undefined;

  const files = await listFirmFiles({
    category,
    search: filters.q?.trim(),
    includeSuperseded: filters.includeOld === "1"
  });

  return (
    <FirmFilesView
      files={files}
      canUpload={isManager}
      currentCategory={category}
      currentSearch={filters.q ?? ""}
      includeSuperseded={filters.includeOld === "1"}
      categorySet="firm"
    />
  );
}
