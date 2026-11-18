"use client";

import { Button, Input, Notification } from "@douyinfe/semi-ui";

import { useState, useTransition, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, X } from "lucide-react";
import type { Client, ClientType, Contact } from "@prisma/client";
import { PageHeader, Pager, Segmented } from "@/components/patterns/moan";
import { ClientSheet } from "./client-sheet";
import { ClientsTable } from "./clients-table";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { getClientForEdit } from "@/server/clients/actions";
import { actionErrorMessage } from "@/lib/action-error";
import { clientListHref } from "@/lib/clients/navigation";

const TYPE_TABS: { key: ClientType | "ALL"; label: string }[] = [
  { key: "ALL", label: "全部客户" },
  { key: "COMPANY", label: "公司" },
  { key: "ORGANIZATION", label: "其他组织" },
  { key: "INDIVIDUAL", label: "自然人" }
];

type ClientRow = Client & {
  contacts: Contact[];
  _count: { matters: number; intakes: number };
};

type Props = {
  canCreate: boolean;
  editableClientIds: string[];
  initialData: {
    items: ClientRow[];
    total: number;
    page: number;
    pageSize: number;
  };
  initialFilters: {
    search: string;
    type: ClientType | "ALL";
  };
};

export function ClientsView({ initialData, initialFilters, canCreate, editableClientIds }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(initialFilters.search);
  const searchInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<ClientType | "ALL">(initialFilters.type);

  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetTrigger = useRef<HTMLElement | null>(null);
  const [loadingClientId, setLoadingClientId] = useState<string | null>(null);
  useTopbarAction(canCreate ? { label: "新建客户", onClick: () => handleNew(), disabled: !!loadingClientId } : "none", [canCreate, loadingClientId]);
  const [editingClient, setEditingClient] = useState<(Client & { contacts: Contact[] }) | null>(null);

  const updateUrl = useCallback(
    (next: { search?: string; type?: string }) => {
      const params = new URLSearchParams();
      const s = next.search ?? search;
      const t = next.type ?? type;
      if (s) params.set("search", s);
      if (t && t !== "ALL") params.set("type", t);
      startTransition(() => {
        router.replace(`/clients${params.toString() ? `?${params.toString()}` : ""}`);
      });
    },
    [router, search, type]
  );

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateUrl({ search });
  }

  function handleSearchBlur(event: React.FocusEvent<HTMLInputElement>) {
    if (search === initialFilters.search && type === initialFilters.type) return;
    // The detail link already carries this input; do not race its navigation with a list refresh.
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest("a[data-client-detail-link]")) return;
    updateUrl({ search });
  }

  function clearFilters() {
    setSearch("");
    setType("ALL");
    startTransition(() => router.replace("/clients"));
  }

  function handleNew() {
    if (!canCreate || loadingClientId) return;
    sheetTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditingClient(null);
    setSheetOpen(true);
  }

  function handleEdit(client: ClientRow, trigger: HTMLButtonElement) {
    if (!editableClientIds.includes(client.id) || loadingClientId) return;
    sheetTrigger.current = trigger;
    setLoadingClientId(client.id);
    startTransition(async () => {
      try {
        const fullClient = await getClientForEdit(client.id);
        setEditingClient(fullClient);
        setSheetOpen(true);
      } catch (err) {
        Notification.error({ title: "无法打开客户编辑", content: actionErrorMessage(err), duration: 6 });
      } finally {
        setLoadingClientId(null);
      }
    });
  }

  const totalPages = Math.max(1, Math.ceil(initialData.total / initialData.pageSize));
  const hrefFor = (page: number) => clientListHref({ ...initialFilters, page });
  const filtersChanged = search !== initialFilters.search || type !== initialFilters.type;
  // Displayed rows/pagination still belong to initialFilters. A changed return query starts at page 1.
  const returnTo = clientListHref({ search, type, page: filtersChanged ? 1 : initialData.page });
  const from = initialData.total === 0 ? 0 : (initialData.page - 1) * initialData.pageSize + 1;
  const to = Math.min(initialData.total, initialData.page * initialData.pageSize);

  return (
    <div className="mo-list">
      <PageHeader
        title="客户"
        sub={<>共 <span className="font-mono">{initialData.total}</span> 位客户</>}
      />
      <Link href="/clients/follow-ups" className="mb-3 inline-flex text-sm font-medium text-primary">查看本人待跟进 →</Link>

      <Segmented
        className="mb-3"
        items={TYPE_TABS}
        value={type}
        onChange={(key) => {
          setType(key);
          updateUrl({ type: key });
        }}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form className="w-full min-w-0 sm:w-80" onSubmit={handleSearchSubmit}>
          <Input ref={searchInput} prefix={<Search aria-hidden size={16} className="ml-3" />} value={search} onChange={setSearch} onBlur={handleSearchBlur} placeholder="搜索客户名称 / 证件号 / 电话 / 邮箱" aria-label="搜索客户" />
        </form>
        {search || type !== "ALL" ? (
          <Button htmlType="button" theme="borderless" type="tertiary" size="small" icon={<X size={14} />} onClick={clearFilters}>
            清除筛选
          </Button>
        ) : null}
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <ClientsTable items={initialData.items} onEdit={handleEdit} canCreate={canCreate} editableClientIds={editableClientIds} loadingClientId={loadingClientId} returnTo={returnTo} />
        {initialData.total > 0 ? (
          <div className="border-t border-[var(--bd-hair)]">
            <Pager page={initialData.page} totalPages={totalPages} hrefFor={hrefFor} summary={<>第 {from}–{to} 条，共 {initialData.total} 条</>} />
          </div>
        ) : null}
      </div>

      <ClientSheet open={sheetOpen} onOpenChange={setSheetOpen} editingClient={editingClient} onReturnFocus={() => {
        const trigger = sheetTrigger.current;
        const target = trigger?.isConnected && !trigger.matches(":disabled") ? trigger : searchInput.current;
        target?.focus({ preventScroll: true });
      }} />
    </div>
  );
}
