"use client";

import { Button, Card, Empty, Notification, Table, Tabs, Tag } from "@douyinfe/semi-ui";
import { useState } from "react";
import Link from "next/link";
import { IconPlus as Plus } from "@douyinfe/semi-icons";
import { formatDate } from "@/lib/utils";
import { actionErrorMessage } from "@/lib/action-error";
import { SealRequestSheet } from "@/app/(app)/approvals/seals/_components/seal-request-sheet";
import type { SealTypeConfigRow } from "@/app/(app)/approvals/seals/_components/seal-types";
import { listSealTypeConfigs } from "@/server/seals/actions";
import type { SealContractItem } from "./info-extras";

type Filter = "all" | "pending" | "done";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "审批中" },
  { value: "done", label: "已审批" }
];

export function ApprovalsPanel({
  matterId,
  matterTitle,
  sealContracts,
  canRequest,
  returnTo
}: {
  matterId: string;
  matterTitle: string;
  sealContracts: SealContractItem[];
  canRequest: boolean;
  returnTo: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [configs, setConfigs] = useState<SealTypeConfigRow[] | null>(null);
  const [loadingConfigs, setLoadingConfigs] = useState(false);

  const pending = sealContracts.filter(request => request.status === "PENDING");
  const completed = sealContracts.filter(request => ["APPROVED", "STAMPED", "REJECTED", "CANCELLED"].includes(request.status));
  const records = { all: sealContracts, pending, done: completed };
  const filtered = records[filter];

  async function handleOpenSheet() {
    if (configs) {
      setSheetOpen(true);
      return;
    }
    setLoadingConfigs(true);
    try {
      const list = await listSealTypeConfigs();
      setConfigs(list);
      setSheetOpen(true);
    } catch (error) {
      Notification.error({ title: "无法打开用印申请", content: actionErrorMessage(error) });
    } finally {
      setLoadingConfigs(false);
    }
  }

  return (
    <section aria-labelledby="dossier-seals-heading">
      <Card bodyStyle={{ padding: 0 }}>
        <header className="dossier-section-heading">
          <h2 id="dossier-seals-heading">用印申请</h2>
          {canRequest ? <Button
            onClick={handleOpenSheet}
            loading={loadingConfigs}
            htmlType="button"
            theme="solid"
            icon={<Plus aria-hidden />}
          >发起用印申请</Button> : null}
        </header>
        <div className="dossier-register-tabs">
          <Tabs
            type="button"
            activeKey={filter}
            onChange={value => setFilter(value as Filter)}
            tabList={FILTERS.map(({ value, label }) => ({
              itemKey: value,
              tab: <span className="inline-flex items-center gap-2">{label}
                <span className="dossier-count">{records[value].length}</span>
              </span>
            }))}
          />
        </div>
        {filtered.length ? <div className="min-w-0 overflow-x-auto">
          <Table<SealContractItem>
            rowKey="id"
            dataSource={filtered}
            pagination={false}
            scroll={{ x: 560 }}
            columns={[
              {
                title: "申请文书",
                key: "document",
                render: (_, request) => <div className="space-y-1">
                  <Link href={`/approvals?${new URLSearchParams({ type: "SEAL_APPROVE", id: request.id, returnTo })}`}
                    className="workspace-action-link font-medium">{request.documentTitle}</Link>
                  <div className="font-mono text-xs text-muted-foreground">{request.code}</div>
                </div>
              },
              { title: "当前状态", key: "status", width: 124, render: (_, request) => <SealStatusBadge status={request.status} /> },
              { title: "发起日期", key: "date", width: 136, render: (_, request) => formatDate(new Date(request.createdAt)) }
            ]}
          />
        </div> : <Empty className="dossier-register-empty" description={
          filter === "all" ? "本案暂无用印申请" : filter === "pending" ? "没有审批中的用印申请" : "没有已审批的用印申请"
        } />}
      </Card>

      {configs && canRequest && (
        <SealRequestSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          configs={configs}
          matters={[{ id: matterId, internalCode: "", title: matterTitle }]}
          preset={{ matterId, documentTitle: matterTitle }}
        />
      )}
    </section>
  );
}

const SEAL_STATUS_LABEL: Record<string, string> = {
  PENDING: "待审批",
  APPROVED: "已批准",
  STAMPED: "已盖章",
  REJECTED: "驳回",
  CANCELLED: "撤销"
};

function SealStatusBadge({ status }: { status: string }) {
  const color = status === "APPROVED" || status === "STAMPED" ? "green"
    : status === "REJECTED" ? "red"
    : status === "PENDING" ? "amber" : "grey";
  return <Tag color={color}>{SEAL_STATUS_LABEL[status] ?? "状态待核实"}</Tag>;
}
