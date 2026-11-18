import { Table, Tag } from "@/components/patterns/semi-surfaces";
import Link from "next/link";
import { IconDownload as Download } from "@douyinfe/semi-icons";
import {
  listArchivedMatters
} from "@/server/archive/actions";
import { listArchivePageData } from "@/server/archive/borrow";
import { BorrowPanel } from "./_components/borrow-panel";
import { CLOSED_REASON_CN } from "@/server/archive/schemas";
import { formatDate } from "@/lib/utils";
import { requireSession } from "@/lib/auth/session";
import { isSystemAdmin } from "@/lib/auth/system-role";
import { matterCategoryLabel } from "@/lib/enums";
import { matterHref } from "@/lib/matters/route";
import { PageHeader } from "@/components/patterns/workspace-surfaces";
import { ArchiveSearchForm } from "./_components/archive-search-form";
import { ActionError } from "@/lib/action-error";
import { archiveListSchema } from "@/server/archive/list-cursor";

export default async function ArchivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // F-6：页面放开为登录可进——archive.read 持有者见全量台账；
  // 其他成员经「案卷借阅」面板检索、申请、审批与限时查阅
  const session = await requireSession();
  const page = await listArchivePageData();
  const canAuditAll = isSystemAdmin(session.user);
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  let result: Awaited<ReturnType<typeof listArchivedMatters>> | null = null;
  let pageError: string | null = null;
  if (page.hasArchiveRead) {
    const parsed = archiveListSchema.safeParse({ query: params.q ?? "", ...(params.cursor !== undefined ? { cursor: params.cursor } : {}) });
    if (!parsed.success) pageError = "归档查找条件或位置无效，请重新查找";
    else {
      try { result = await listArchivedMatters(parsed.data); }
      catch (cause) {
        if (!(cause instanceof ActionError)) throw cause;
        pageError = cause.message;
      }
    }
  }
  const items = result?.items ?? [];
  function archiveHref(cursor?: string) {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (cursor) next.set("cursor", cursor);
    return `/archive${next.size ? `?${next}` : ""}`;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        className="!mb-0"
        title="归档管理"
        sub={result ? <>{query ? "匹配" : "已批准"}归档记录 <b>{result.recordTotal}</b> 条（含补充归档） · 本页 {items.length} 条</> : page.hasArchiveRead ? "归档记录" : "案卷借阅"}
      />

      <BorrowPanel mine={page.borrows.mine} pending={page.borrows.pending} canApply={!page.hasArchiveRead} />

      {page.hasArchiveRead && <ArchiveSearchForm key={query} query={query} />}
      {pageError && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border p-4">
        <p>{pageError}</p><Link className="text-primary underline underline-offset-4" href={archiveHref()}>从第一页查找</Link>
      </div>}

      {result && (items.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="mo-empty-title">{params.cursor ? "当前查找位置没有归档记录" : query ? "没有匹配的归档记录" : "暂无已批准归档记录"}</div>
            {!query && !params.cursor && <div className="mo-empty-desc">在案件详情「···」菜单发起归档申请，审批通过后会出现在这里。</div>}
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="mo-scroll-x">
            <Table
              pagination={false}
              rowKey="id"
              scroll={{ x: 1180 }}
              columns={[
                { title: "归档号 / 所内案号", dataIndex: "archive", width: 156 },
                { title: "案件", dataIndex: "matter" },
                { title: "类别", dataIndex: "category", width: 90 },
                { title: "委托方", dataIndex: "client", width: 130 },
                { title: "结案方式", dataIndex: "closure", width: 90 },
                { title: "结案日期", dataIndex: "completedAt", width: 110 },
                { title: "归档日期", dataIndex: "archivedAt", width: 110 },
                { title: "归档人", dataIndex: "archivedBy", width: 85 },
                { title: "材料", dataIndex: "materials", width: 90 },
                { title: "操作", dataIndex: "actions", width: 125 },
              ]}
              dataSource={items.map(rec => ({
                id: rec.id,
                archive: <> <div className="font-mono text-xs font-semibold">{rec.archiveNo}</div>
                      <div className="font-mono text-xs text-[var(--semi-color-text-2)]">{rec.matter.firmCaseNo ?? "—"}</div></>,
                matter: <Link href={matterHref(rec.matter)} className="block truncate font-semibold hover:text-[var(--semi-color-primary-active)]" title={rec.matter.title}>
                        {rec.matter.title}
                      </Link>,
                category: matterCategoryLabel[rec.matter.category as keyof typeof matterCategoryLabel] ?? "类别待核实",
                client: <span className="block truncate" title={rec.matter.primaryClient?.name ?? undefined}>{rec.matter.primaryClient?.name ?? "—"}</span>,
                closure: rec.closedReason ? CLOSED_REASON_CN[rec.closedReason] : "—",
                completedAt: rec.completedAt ? formatDate(rec.completedAt) : "—",
                archivedAt: formatDate(rec.archivedAt),
                archivedBy: rec.archivedBy,
                materials: !rec.materialSnapshotVerified ? (
                        <Tag color="amber"><span title="历史归档记录没有固定获批材料清单">未固定</span></Tag>
                      ) : rec.missingItems.length > 0 ? (
                        <Tag color="amber">缺 {rec.missingItems.length} 项</Tag>
                      ) : (
                        <Tag color="green">齐全</Tag>
                      ),
                actions: <div className="flex items-center gap-2 whitespace-nowrap text-xs">
                        {canAuditAll || rec.archivedById === session.user.id ? (
                          <Link className="text-[var(--semi-color-primary-active)] hover:underline" href={`/approvals?type=ARCHIVE_APPROVE&id=${rec.id}`}>审阅记录</Link>
                        ) : null}
                        {rec.materialSnapshotVerified ? (
                          <a href={`/api/archive/${rec.matter.id}/export?archiveId=${rec.id}`} className="inline-flex items-center gap-1 text-[var(--semi-color-primary-active)] hover:underline" title="导出归档 ZIP">
                            <Download aria-hidden size="small" />
                            ZIP
                          </a>
                        ) : null}
                      </div>,
              }))}
            />
          </div>
        </div>
      ))}
      {result && <nav aria-label="归档记录分页" className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">按归档日期从新到旧排列</span>
        <div className="flex gap-2">
          {params.cursor && <Link className="text-primary underline underline-offset-4" href={archiveHref()}>回到第一页</Link>}
          {result.nextCursor && <Link className="text-primary underline underline-offset-4" href={archiveHref(result.nextCursor)}>下一页归档记录</Link>}
        </div>
      </nav>}
    </div>
  );
}
