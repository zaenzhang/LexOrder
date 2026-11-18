"use client";

import { Tag as SemiTag } from "@/components/patterns/semi-surfaces";
import { Table } from "@douyinfe/semi-ui";

import type { IntakeStatus, ConflictSeverity } from "@prisma/client";
import { matterCategoryLabel, matterCategoryShort, intakeStatusLabel } from "@/lib/enums";
import { formatDate } from "@/lib/utils";

export type IntakeRow = {
  id: string;
  title: string;
  category: keyof typeof matterCategoryLabel;
  status: IntakeStatus;
  receivedAt: Date;
  client: { id: string; name: string } | null;
  cause: { id: string; name: string } | null;
  conflictChecks: { id: string; conclusion: string; hits: { severity: ConflictSeverity }[] }[];
  parties: { name: string }[];
  matter: { id: string; internalCode: string } | null;
  claimAmount?: number | null;
  ownerName?: string | null;
};

/**
 * v0.17: 待审批 / 待补正 收案列表 — 复用 MattersTable 的 CaseListCard 保证视觉一致
 */
export function IntakesTable({
  items,
  kind = "intake"
}: {
  items: IntakeRow[];
  kind?: "intake" | "revision";
}) {
  if (items.length === 0) {
    return (
      <div className="empty">
        <div className="mo-empty-title">
          {kind === "revision" ? "暂无待补正收案" : "暂无待审批收案"}
        </div>
        <div className="mo-empty-desc">
          {kind === "revision"
            ? "在 待审批 中拒绝的收案，可补正材料后重新提交，会出现在这里"
            : (
              <>
                点击右上角 <span className="text-foreground/80">新建收案</span> 开始
              </>
            )}
        </div>
      </div>
    );
  }

  return (
    <div className="mo-scroll-x">
      <Table<(typeof items)[number]>
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={items}
        scroll={{ x: 900 }}
        columns={[
          { title: "收案 / 当事人", width: "30%", key: "column1", render: (_, it) => <a href={`/intakes/${it.id}`} className="block min-w-0 no-underline" onClick={(e) => e.stopPropagation()}>
                    <span className="block truncate text-[13px] font-semibold leading-5 text-foreground">{it.title}</span>
                    {it.parties.length > 0 ? (
                      <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">
                        当事人：{it.parties.map((p) => p.name).join("、")}
                      </span>
                    ) : null}
                    {it.matter ? (
                      <span className="mt-0.5 block font-mono text-[11px] leading-4 text-muted-foreground/70 tabular">
                        已转案件 {it.matter.internalCode}
                      </span>
                    ) : null}
                  </a> },
          { title: "类别", width: "12%", key: "column2", render: (_, it) => <SemiTag size="small" color="grey">{matterCategoryShort[it.category as keyof typeof matterCategoryShort]}</SemiTag> },
          { title: "委托方", width: "13%", key: "column3", render: (_, it) => <span className="truncate">{it.client?.name ?? it.parties[0]?.name ?? "—"}</span> },
          { title: "收案时间", width: "11%", key: "column4", render: (_, it) => <span className="font-mono text-[var(--semi-color-text-1)]">{formatDate(new Date(it.receivedAt))}</span> },
          { title: "标的额", width: "12%", align: "right", key: "column5", render: (_, it) => <span className="font-mono">{it.claimAmount != null ? it.claimAmount.toLocaleString("zh-CN", { maximumFractionDigits: 0 }) : "—"}</span> },
          { title: "冲突核查", width: "22%", key: "column6", render: (_, it) => { const hitSeverities = it.conflictChecks.flatMap((c) => c.hits.map((h) => h.severity)); const hasBlocking = hitSeverities.includes("BLOCKING"); const pendingConclusion = it.conflictChecks.some((c) => c.conclusion === "PENDING"); return (it.conflictChecks.length === 0 ? (
                    <span className="text-[12px] text-muted-foreground/55">未发起</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {hasBlocking ? (
                        <SemiTag size="small" color="red" type="ghost">冲突 BLOCKING</SemiTag>
                      ) : hitSeverities.length > 0 ? (
                        <SemiTag size="small" color="amber">命中 {hitSeverities.length}</SemiTag>
                      ) : (
                        <SemiTag size="small" color="grey">未命中</SemiTag>
                      )}
                      {pendingConclusion ? (
                        <SemiTag size="small" color="amber">结论待出</SemiTag>
                      ) : (
                        <SemiTag size="small" color="green">已出结论</SemiTag>
                      )}
                    </span>
                  )); } },
          { title: "状态", width: "10%", key: "column7", render: (_, it) => { const statusLabel = kind === "revision" ? "待补正" : intakeStatusLabel[it.status] ?? it.status; const hitSeverities = it.conflictChecks.flatMap((c) => c.hits.map((h) => h.severity)); const hasBlocking = hitSeverities.includes("BLOCKING"); return (<SemiTag size="small" color={hasBlocking ? "red" : "amber"}>{statusLabel}</SemiTag>); } },
        ]}
      />
    </div>
  );
}
