import Link from "next/link";
import { Download } from "lucide-react";
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
import { PageHeader } from "@/components/patterns/moan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

      {page.hasArchiveRead && <form action="/archive" method="get" className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5"><Label htmlFor="archive-query">归档号、案号或案件名称</Label>
          <Input id="archive-query" name="q" defaultValue={query} maxLength={200} />
        </div>
        <Button type="submit">查找归档</Button>
      </form>}
      {pageError && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border p-4">
        <p>{pageError}</p><Button variant="outline" asChild><Link href={archiveHref()}>从第一页查找</Link></Button>
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
            <table className="mo-table" style={{ minWidth: 1080, tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ width: 150, paddingLeft: 20 }}>归档号 / 所内案号</th>
                  <th>案件</th>
                  <th style={{ width: 84 }}>类别</th>
                  <th style={{ width: 120 }}>委托方</th>
                  <th style={{ width: 76 }}>结案方式</th>
                  <th style={{ width: 108 }}>结案日期</th>
                  <th style={{ width: 108 }}>归档日期</th>
                  <th style={{ width: 70 }}>归档人</th>
                  <th style={{ width: 92 }}>材料</th>
                  <th style={{ width: 96 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((rec) => (
                  <tr key={rec.id} data-spine="bronze">
                    <td style={{ paddingLeft: 20 }}>
                      <div className="font-mono text-[12px] font-semibold">{rec.archiveNo}</div>
                      <div className="font-mono text-[11px] text-[var(--t-muted)]">{rec.matter.firmCaseNo ?? "—"}</div>
                    </td>
                    <td className="min-w-0">
                      <Link href={matterHref(rec.matter)} className="block truncate font-semibold hover:text-[var(--teal-deep)]" title={rec.matter.title}>
                        {rec.matter.title}
                      </Link>
                    </td>
                    <td className="t-sm">{matterCategoryLabel[rec.matter.category as keyof typeof matterCategoryLabel] ?? "类别待核实"}</td>
                    <td className="t-sm truncate" title={rec.matter.primaryClient?.name ?? undefined}>{rec.matter.primaryClient?.name ?? "—"}</td>
                    <td className="t-sm">{rec.closedReason ? CLOSED_REASON_CN[rec.closedReason] : "—"}</td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-[var(--t-secondary)]">{rec.completedAt ? formatDate(rec.completedAt) : "—"}</td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-[var(--t-secondary)]">{formatDate(rec.archivedAt)}</td>
                    <td className="t-sm">{rec.archivedBy}</td>
                    <td>
                      {!rec.materialSnapshotVerified ? (
                        <span className="badge b-amber" title="历史归档记录没有固定获批材料清单">未固定</span>
                      ) : rec.missingItems.length > 0 ? (
                        <span className="badge b-amber">缺 {rec.missingItems.length} 项</span>
                      ) : (
                        <span className="badge b-green">齐全</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-2 whitespace-nowrap text-[12px]">
                        {canAuditAll || rec.archivedById === session.user.id ? (
                          <Link className="text-[var(--teal-deep)] hover:underline" href={`/approvals?type=ARCHIVE_APPROVE&id=${rec.id}`}>审阅记录</Link>
                        ) : null}
                        {rec.materialSnapshotVerified ? (
                          <a href={`/api/archive/${rec.matter.id}/export?archiveId=${rec.id}`} className="inline-flex items-center gap-1 text-[var(--teal-deep)] hover:underline" title="导出归档 ZIP">
                            <Download className="h-3 w-3" />
                            ZIP
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {result && <nav aria-label="归档记录分页" className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">按归档日期从新到旧排列</span>
        <div className="flex gap-2">
          {params.cursor && <Button variant="outline" asChild><Link href={archiveHref()}>回到第一页</Link></Button>}
          {result.nextCursor && <Button variant="outline" asChild><Link href={archiveHref(result.nextCursor)}>下一页归档记录</Link></Button>}
        </div>
      </nav>}
    </div>
  );
}
