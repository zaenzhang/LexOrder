"use client";

import { Table, Tag } from "@douyinfe/semi-ui";
import type { ColumnProps } from "@douyinfe/semi-ui/lib/es/table";
import type { Matter, PartyRole, LitigationStanding } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InitialAvatar, RiskLadder } from "@/components/patterns/moan";
import { litigationStandingLabel, matterStatusLabel, procedureTypeLabel } from "@/lib/enums";
import { matterListEntryHref } from "@/lib/matters/list-location";
import { procedureStateLabel } from "@/lib/procedure-status";
import { shDaysFromToday } from "@/lib/ui/sh-time";
import { avatarTone, deadlineRisk } from "@/lib/ui/moan-tones";
import { formatDate } from "@/lib/utils";

export type MatterRow = Omit<Matter, "claimAmount"> & {
  primaryClient: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  cause: { id: string; name: string } | null;
  procedures: {
    id: string; type: string; caseNumber: string | null; status: string;
    engagement: string; concludedAt: Date | null; customLabel: string | null;
    stages?: { id: string; name: string; order: number; completedAt: Date | null }[];
    deadlines?: { title: string; dueAt: Date; category?: string }[];
  }[];
  members?: { user: { id: string; name: string } }[];
  parties: { id: string; name: string; role: PartyRole; standing: LitigationStanding | null }[];
  archiveRecords?: { id: string }[];
  _count: { procedures: number };
  claimAmount: number | null;
  firmCaseNo: string | null;
  intakeDate: Date | null;
  latestHearingAt: Date | null;
  canReadSchedule: boolean;
};

export type MatterColumn = "client" | "caseNo" | "stage" | "owner" | "amount" | "deadline" | "status";
export const MATTER_COLUMNS: { key: MatterColumn; label: string }[] = [
  { key: "client", label: "委托方" },
  { key: "caseNo", label: "案号" },
  { key: "stage", label: "程序" },
  { key: "owner", label: "主办 / 协办" },
  { key: "amount", label: "标的额" },
  { key: "deadline", label: "最近期限" },
  { key: "status", label: "状态" }
];

const DEADLINE_SHORT: Record<string, string> = {
  LIMITATION: "时效",
  EVIDENCE: "举证",
  APPEAL: "上诉",
  PERFORMANCE: "履行",
  RESPONSE: "答辩",
  ENFORCEMENT: "执行",
  ARBITRATION_SET_ASIDE: "撤裁",
  PRESERVATION: "保全",
  CUSTOM: "期限"
};

const STATUS_COLORS = {
  PENDING_ACCEPTANCE: "amber",
  IN_PROGRESS: "blue",
  ON_HOLD: "grey",
  CLOSED: "green",
  ARCHIVED: "orange"
} as const satisfies Record<MatterRow["status"], string>;

type MatterTableRow = MatterRow & {
  deadline: { title: string; dueAt: Date; category?: string } | null;
  daysRemaining: number | null;
};

export function MattersTable({ items, columns, listQuery }: {
  items: MatterRow[];
  columns: MatterColumn[];
  listQuery: string;
}) {
  const router = useRouter();
  const rows = items.map((matter): MatterTableRow => {
    const deadline = matter.canReadSchedule
      ? matter.procedures.flatMap(procedure => procedure.deadlines ?? []).sort(
          (left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime()
        )[0] ?? null
      : null;
    return { ...matter, deadline, daysRemaining: deadline ? shDaysFromToday(deadline.dueAt) : null };
  });
  const details: Record<MatterColumn, ColumnProps<MatterTableRow>> = {
    client: {
      width: 120,
      render: (_, matter) => <span className="block truncate" title={matter.primaryClient?.name}>{matter.primaryClient?.name ?? "未关联客户"}</span>
    },
    caseNo: {
      width: 150,
      render: (_, matter) => {
        const caseNumber = matter.procedures[0]?.caseNumber;
        return <span title={caseNumber ?? undefined} className="block truncate font-mono text-xs">{caseNumber ?? "暂无案号"}</span>;
      }
    },
    stage: {
      width: 160,
      render: (_, matter) => <div className="grid gap-1 text-xs">
        {matter.procedures.slice(0, 2).map(procedure => <div key={procedure.id}>
          <span>{procedure.customLabel || procedureTypeLabel[procedure.type as keyof typeof procedureTypeLabel]}</span>
          <span className="ml-2 text-muted-foreground">{procedure.engagement === "INFORMATIONAL" ? "信息记录 · " : ""}{procedureStateLabel(procedure)}</span>
        </div>)}
        {matter.procedures.length === 0 && <span className="text-muted-foreground">暂无程序</span>}
        {matter._count.procedures > 2 && <span className="text-muted-foreground">共 {matter._count.procedures} 个程序</span>}
      </div>
    },
    owner: {
      width: 130,
      render: (_, matter) => {
        if (!matter.owner) return "—";
        return <span className="flex items-center gap-1.5">
          <InitialAvatar name={matter.owner.name} tone={avatarTone(matter.owner.name)} size={22} />
          <span className="truncate">{matter.owner.name}</span>
          {Boolean(matter.members?.length) && <span className="av-stack" title={`协办：${matter.members?.map(member => member.user.name).join("、")}`}>
            {matter.members?.map(member => <InitialAvatar key={member.user.id} name={member.user.name} tone="slate" size={18} />)}
          </span>}
        </span>;
      }
    },
    amount: {
      width: 110,
      align: "right",
      render: (_, matter) => matter.claimAmount == null ? "—" : <span className="font-mono">¥{Math.round(matter.claimAmount).toLocaleString("zh-CN")}</span>
    },
    deadline: {
      width: 160,
      render: (_, matter) => <MatterDeadline matter={matter} />
    },
    status: {
      width: 94,
      render: (_, matter) => <Tag color={STATUS_COLORS[matter.status]}>
        {matter.archiveRecords?.length ? "归档中" : matterStatusLabel[matter.status]}
      </Tag>
    }
  };
  const visibleColumns: ColumnProps<MatterTableRow>[] = [
    {
      key: "name",
      title: "案件 / 案由",
      width: 250,
      render: (_, matter) => <Link href={matterListEntryHref(matter, listQuery)} className="block min-w-0" onClick={event => event.stopPropagation()}>
        <span className="block truncate font-medium" title={matter.title}>{matter.title || "（未命名）"}</span>
        <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
          {matter.deadline && matter.daysRemaining !== null && matter.daysRemaining < 0 ? <>
            <Tag color="red">逾期 {Math.abs(matter.daysRemaining)} 天</Tag>
            <span className="truncate">{matter.deadline.title}</span>
          </> : <span className="truncate">{[matter.cause?.name ?? matter.causeFreeText, matter.ourStanding && litigationStandingLabel[matter.ourStanding]].filter(Boolean).join(" · ") || "—"}</span>}
        </div>
        <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{matter.internalCode}</span>
      </Link>
    },
    ...MATTER_COLUMNS.filter(column => columns.includes(column.key)).map(({ key, label }) => ({
      key,
      title: label,
      ...details[key]
    }))
  ];

  return (
    <Table
      dataSource={rows}
      rowKey="id"
      columns={visibleColumns}
      pagination={false}
      size="small"
      scroll={{ x: visibleColumns.reduce((sum, column) => sum + Number(column.width), 0) }}
      empty={<span role="status">没有匹配的案件</span>}
      onRow={matter => matter ? {
        className: "cursor-pointer",
        onClick: () => router.push(matterListEntryHref(matter, listQuery))
      } : {}}
    />
  );
}

function MatterDeadline({ matter }: { matter: MatterTableRow }) {
  if (!matter.canReadSchedule) return <span className="text-xs text-muted-foreground">无日程查看权限</span>;
  const { daysRemaining, deadline } = matter;
  if (daysRemaining === null || !deadline) return "—";
  if (daysRemaining < 0) return <div title={deadline.title}><Tag color="red">逾期 {Math.abs(daysRemaining)} 天</Tag></div>;
  const risk = deadlineRisk(daysRemaining);
  const label = DEADLINE_SHORT[deadline.category ?? "CUSTOM"] ?? "期限";
  return <div className="flex items-center gap-2 whitespace-nowrap" title={`${deadline.title} · ${formatDate(new Date(deadline.dueAt))}`}>
    <RiskLadder level={risk.level} tone={risk.tone} />
    <Tag color={risk.tone === "red" ? "red" : risk.tone === "amber" ? "amber" : "grey"}>
      {label} {daysRemaining === 0 ? "今天" : `${daysRemaining} 天`}
    </Tag>
  </div>;
}
