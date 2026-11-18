"use client";

/** 案件列表的页签、筛选、排序与分页以 URL 为准。 */
import { useCallback, useEffect, useId, useState, useTransition, type RefObject } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Checkbox, Input, Pagination, Popover, Select, Tabs } from "@douyinfe/semi-ui";
import { IconArchive as Archive, IconCalendar as CalendarDays, IconGridView as Columns3, IconDownload as Download, IconSearch as Search } from "@douyinfe/semi-icons";
import { PageHeader } from "@/components/patterns/workspace-surfaces";
import type { MatterCategory } from "@prisma/client";
import { matterCategoryLabel } from "@/lib/enums";
import { MATTER_COLUMNS, MattersTable, type MatterColumn, type MatterRow } from "./matters-table";
import { IntakesTable, type IntakeRow } from "./intakes-table";
import { IntakeWizard } from "@/app/(app)/intakes/_components/intake-wizard";
import { useTopbarAction } from "@/components/layout/topbar-action";

import { defaultSortByForTab, supportsSortBy, type MattersTab as Tab, type MatterSortBy as SortBy } from "@/lib/matters/list-location";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "active", label: "办理中" },
  { key: "intake", label: "收案中" },
  { key: "revision", label: "收案待补正" },
  { key: "archived", label: "已归档" }
];

const CATEGORIES: (MatterCategory | "ALL")[] = ["ALL", "CIVIL_COMMERCIAL", "LABOR_ARBITRATION", "COMMERCIAL_ARBITRATION", "CRIMINAL", "ADMINISTRATIVE", "NON_LITIGATION", "LEGAL_COUNSEL", "SPECIAL_PROJECT"];

const SORTS: { value: SortBy; label: string }[] = [
  { value: "intakeDate", label: "按收案时间" },
  { value: "hearing", label: "按开庭时间" },
  { value: "claimAmount", label: "按标的金额" },
  { value: "archivedAt", label: "按归档时间" }
];


export function MattersViewV4({
  tab,
  matterData,
  intakeData,
  clientOptions,
  colleagues,
  tabCounts,
  readableTeams = [],
  initialFilters,
  canCreateIntake = false,
  canExportMatters = false,
  autoOpenIntake,
  initialClientId
}: {
  tab: Tab;
  matterData?: { items: MatterRow[]; total: number; page: number; pageSize: number };
  intakeData?: { items: IntakeRow[]; total: number; page: number; pageSize: number };
  clientOptions: { id: string; name: string; type: "INDIVIDUAL" | "COMPANY" | "ORGANIZATION" }[];
  colleagues: { id: string; name: string; role?: string; isTeammate?: boolean }[];
  tabCounts?: Partial<Record<Tab, number>>;
  readableTeams?: { id: string; name: string }[];
  initialFilters: {
    scope?: "all" | "mine" | "team";
    teamId?: string;
    ownerId?: string;
    search: string;
    category: MatterCategory | "ALL";
    status?: string;
    from?: string;
    to?: string;
    sortBy?: SortBy;
    sortDir?: "asc" | "desc";
  };
  autoOpenIntake?: boolean;
  canCreateIntake?: boolean;
  canExportMatters?: boolean;
  initialClientId?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [wizardOpen, setWizardOpen] = useState(canCreateIntake && Boolean(autoOpenIntake));
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  useTopbarAction(canCreateIntake ? { label: "新建收案", onClick: () => setWizardOpen(true) } : null, [canCreateIntake]);

  const f = initialFilters;
  const data = tab === "intake" || tab === "revision" ? intakeData : matterData;
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const pageSize = data?.pageSize ?? 12;

  const buildUrl = useCallback((o: Partial<Record<string, string | number | undefined>> & { page?: number }) => {
    const p = new URLSearchParams();
    const t = (o.tab as Tab) ?? tab;
    if (t !== "active") p.set("tab", t);
    if (((o.scope as string) ?? f.scope ?? "all") !== "all") p.set("scope", String((o.scope as string) ?? f.scope));
    if ((o.teamId as string) ?? f.teamId) p.set("teamId", String((o.teamId as string) ?? f.teamId));
    if ((o.ownerId as string) ?? f.ownerId) p.set("ownerId", String((o.ownerId as string) ?? f.ownerId));
    const search = o.search !== undefined ? String(o.search) : f.search;
    if (search) p.set("search", search);
    const cat = o.category !== undefined ? String(o.category) : f.category;
    if (cat && cat !== "ALL") p.set("category", cat);
    const st = o.status !== undefined ? String(o.status) : f.status;
    if (st && st !== "ALL" && t === "all") p.set("status", st);
    const from = o.from !== undefined ? String(o.from) : f.from;
    const to = o.to !== undefined ? String(o.to) : f.to;
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const sort = (o.sortBy as SortBy) ?? f.sortBy;
    p.set("sortBy", sort && supportsSortBy(t, sort) ? sort : defaultSortByForTab(t));
    p.set("sortDir", (o.sortDir as "asc" | "desc") ?? f.sortDir ?? "desc");
    const pg = o.page ?? 1;
    if (pg > 1) p.set("page", String(pg));
    const qs = p.toString();
    return `/matters${qs ? `?${qs}` : ""}`;
  }, [tab, f]);

  function go(o: Parameters<typeof buildUrl>[0]) {
    startTransition(() => router.replace(buildUrl(o)));
  }

  function closeWizard(open: boolean) {
    setWizardOpen(open);
    if (!open && autoOpenIntake) {
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      url.searchParams.delete("clientId");
      window.history.replaceState(null, "", url.toString());
    }
  }

  const appliedListQuery = new URL(buildUrl({ page }), "https://lexorder.invalid").searchParams;
  const exportUrl = (() => {
    const p = new URLSearchParams(appliedListQuery);
    p.delete("page");
    return `/api/matters/export?${p.toString()}`;
  })();

  const showStatus = tab === "all";
  const isIntakeTab = tab === "intake" || tab === "revision";
  const [columns, setColumns] = useState<MatterColumn[]>(() => MATTER_COLUMNS.map((c) => c.key));
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("ll:matters:columns") ?? "null");
      if (Array.isArray(saved)) setColumns(saved.filter((k) => MATTER_COLUMNS.some((c) => c.key === k)));
    } catch {
      /* 本地偏好不可用时使用默认列 */
    }
  }, []);
  function toggleColumn(key: MatterColumn) {
    setColumns((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      try {
        window.localStorage.setItem("ll:matters:columns", JSON.stringify(next));
      } catch {
        /* 忽略 */
      }
      return next;
    });
  }
  const currentSort = f.sortBy ?? defaultSortByForTab(tab);
  const sortOptions = SORTS.filter(o => supportsSortBy(tab, o.value));
  const scopeLabel: Record<string, string> = { all: "全部可见", mine: "我经办", team: "按团队" };
  const lastPage = Math.ceil(total / pageSize);

  return (
    <div className="mo-list">
      <PageHeader
        title="案件"
        sub={<>共 <b>{tabCounts?.all ?? total}</b> 件 · 当前范围「{TABS.find((t) => t.key === tab)?.label}」<b>{total}</b> 件 · 每页 {pageSize} 条</>}
        actions={
          <>
            {tab === "archived" ? (
              <Link href="/archive" className="workspace-action-link" title="归档号、归档日期、结案原因与卷宗目录">
                <Archive aria-hidden />
                归档台账
              </Link>
            ) : null}
            {!isIntakeTab && canExportMatters ? (
              <a href={exportUrl} title="仅导出本人经办或原有管理权限范围内的案件；团队查看权不含导出" className="workspace-action-link">
                <Download aria-hidden />
                导出
              </a>
            ) : null}
          </>
        }
      />

      <Tabs
        type="button"
        tabBarClassName="mb-3"
        activeKey={tab}
        keepDOM
        tabList={TABS.map(({ key, label }) => ({
          itemKey: key,
          tab: <>{label}{typeof tabCounts?.[key] === "number" && <span className="ml-1 tabular-nums">{tabCounts[key]}</span>}</>
        }))}
        onChange={(key) => go({ tab: key, page: 1 })}
      >
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-2.5">
          <form className="w-full sm:w-[17rem]" role="search" onSubmit={(e) => { e.preventDefault(); go({ search: searchInput, page: 1 }); }}>
            <Input
              size="default"
              className="w-full"
              value={searchInput}
              onChange={setSearchInput}
              prefix={<Search size="default" className="mx-2 shrink-0 text-[var(--semi-color-text-2)]" aria-hidden />}
              placeholder="搜索案件名称、案号或当事人"
              aria-label="搜索案件"
            />
          </form>
          <MatterListSelect label="案件类别" value={f.category !== "ALL" ? f.category : undefined} options={CATEGORIES.filter((c) => c !== "ALL").map((c) => ({ value: c, label: matterCategoryLabel[c as MatterCategory] }))} onChange={(v) => go({ category: v || "ALL", page: 1 })} />
          {f.scope === "team" && readableTeams.length > 0 ? (
            <MatterListSelect label="团队" value={f.teamId} allLabel="全部获权团队" options={readableTeams.map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => go({ teamId: v, page: 1 })} />
          ) : null}
          <MatterListSelect label="主办" value={f.ownerId} options={colleagues.map((u) => ({ value: u.id, label: u.name }))} onChange={(v) => go({ ownerId: v, page: 1 })} />
          <MatterListSelect label="范围" required value={f.scope ?? "all"} options={Object.entries(scopeLabel).map(([value, label]) => ({ value, label }))} onChange={(v) => go({ scope: v, teamId: "", page: 1 })} />
          {showStatus ? (
            <MatterListSelect label="状态" value={f.status && f.status !== "ALL" ? f.status : undefined} options={[{ value: "active", label: "办理中" }, { value: "closed", label: "已结案" }, { value: "archived", label: "已归档" }]} onChange={(v) => go({ status: v || "ALL", page: 1 })} />
          ) : null}
          <Popover
            trigger="click"
            position="bottomLeft"
            motion={false}
            visible={dateFilterOpen}
            onVisibleChange={setDateFilterOpen}
            content={({ initialFocusRef }) => (
              <form className="w-64 space-y-2.5 p-3" onSubmit={event => {
                event.preventDefault();
                const dates = new FormData(event.currentTarget);
                go({ from: String(dates.get("from") ?? ""), to: String(dates.get("to") ?? ""), page: 1 });
                setDateFilterOpen(false);
              }}>
                <label className="block text-xs">
                  起
                  <Input ref={initialFocusRef as RefObject<HTMLInputElement> | undefined} type="date" name="from" defaultValue={f.from ?? ""}
                    className="mt-1 w-full" />
                </label>
                <label className="block text-xs">
                  止
                  <Input type="date" name="to" defaultValue={f.to ?? ""}
                    className="mt-1 w-full" />
                </label>
                <div className="flex items-center justify-between gap-2">
                  <Button htmlType="button" theme="borderless" type="tertiary" size="small" onClick={() => {
                    if (f.from || f.to) go({ from: "", to: "", page: 1 });
                    setDateFilterOpen(false);
                  }}>清除日期</Button>
                  <Button htmlType="submit" theme="solid" size="small">应用</Button>
                </div>
              </form>
            )}
          >
            <Button theme="light" type={f.from || f.to ? "primary" : "tertiary"} size="default" icon={<CalendarDays size="default" aria-hidden />}>
              收案日期{f.from || f.to ? <span className="ml-1 font-mono">{f.from ?? "…"} ~ {f.to ?? "…"}</span> : null}
            </Button>
          </Popover>

          <div className="ml-auto flex items-center gap-2">
            <MatterListSelect
              label="排序"
              required
              value={currentSort}
              options={sortOptions.map((o) => ({ value: o.value, label: o.label.replace("按", "") }))}
              onChange={(v) => go({ sortBy: v, page: 1 })}
            />
            <Button theme="light" type="tertiary" size="default" onClick={() => go({ sortDir: f.sortDir === "asc" ? "desc" : "asc", page: 1 })} title="切换升序 / 降序" aria-label="切换排序方向">
              {f.sortDir === "asc" ? "升序" : "降序"}
            </Button>
            {!isIntakeTab ? (
              <Popover
                trigger="click"
                position="bottomRight"
                content={
                  <div className="grid min-w-40 gap-2 p-3">
                    {MATTER_COLUMNS.map((c) => (
                      <Checkbox key={c.key} checked={columns.includes(c.key)} onChange={() => toggleColumn(c.key)}>
                        {c.label}
                      </Checkbox>
                    ))}
                  </div>
                }
              >
                <Button theme="light" type="tertiary" size="default" icon={<Columns3 size="default" aria-hidden />}>
                  列设置
                </Button>
              </Popover>
            ) : null}
          </div>
        </div>

        <div className="card overflow-hidden">
          {isIntakeTab ? (
            <IntakesTable items={intakeData?.items ?? []} kind={tab === "revision" ? "revision" : "intake"} />
          ) : (
            <MattersTable items={matterData?.items ?? []} columns={columns} listQuery={appliedListQuery.toString()} />
          )}
          {total > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--semi-color-border)] px-4 py-2">
              <span className="text-xs text-muted-foreground">
                {page <= lastPage ? <>第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} 条 · 共 {total} 件</> : <>第 {page} 页无结果 · 共 {total} 件</>}
              </span>
              {page > lastPage ? (
                <Button size="small" onClick={() => go({ page: lastPage })}>前往最后一页</Button>
              ) : (
                <Pagination currentPage={page} pageSize={pageSize} total={total} hideOnSinglePage onPageChange={(nextPage) => go({ page: nextPage })} />
              )}
            </div>
          ) : null}
        </div>
      </Tabs>

      {canCreateIntake && <IntakeWizard open={wizardOpen} onOpenChange={closeWizard} onReturnFocus={() => {
        if (document.activeElement === document.body) document.getElementById("workspace-top-action")?.focus({ preventScroll: true });
      }} clientOptions={clientOptions} colleagues={colleagues} initialClientId={autoOpenIntake ? initialClientId : undefined} />}
    </div>
  );
}

function MatterListSelect({ label, value, options, onChange, allLabel = "全部", required = false }: {
  label: string;
  value: string | undefined;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  allLabel?: string;
  required?: boolean;
}) {
  const labelId = useId();
  return (
    <Select<string>
      size="default"
      motion={false}
      insetLabel={label}
      insetLabelId={labelId}
      aria-labelledby={labelId}
      value={value ?? ""}
      optionList={required ? options : [{ label: allLabel, value: "" }, ...options]}
      onChange={(next) => { if (typeof next === "string") onChange(next); }}
      dropdownMatchSelectWidth={false}
      dropdownStyle={{ minWidth: 168 }}
    />
  );
}
