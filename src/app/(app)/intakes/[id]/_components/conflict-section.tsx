"use client";
import { Button, Tag, TextArea, Notification, Toast } from "@douyinfe/semi-ui";

import { useState, useTransition } from "react";
import Link from "next/link";
import { IconAlertTriangle as AlertTriangle, IconShieldStroked as ShieldCheck, IconLoading as Loader2, IconSearch as Search, IconExternalOpen as ExternalLink, IconTickCircle as CheckCircle2, IconHelpCircle as HelpCircle, IconInfoCircle as Info, IconBriefcase as Briefcase } from "@douyinfe/semi-icons";
import type {
  ConflictSeverity,
  ConflictConclusion,
  MatterCategory,
  MatterStatus,
  PartyRole,
  LitigationStanding
} from "@prisma/client";

import { runCheckAndSave, setConflictConclusion } from "@/server/conflicts/actions";
import { conflictConclusionLabel, litigationStandingLabel, matterCategoryLabel, matterStatusLabel } from "@/lib/enums";
import type { buildIntakeConflictQueries } from "@/lib/approvals/intake-detail";
import { cn, formatDate as fmtDate, formatDateTime } from "@/lib/utils";
import { matterHref } from "@/lib/matters/route";
import { actionErrorMessage } from "@/lib/action-error";

type Hit = {
  id: string;
  hitType: string;
  targetType: string;
  targetId: string;
  matchedName: string;
  matchedField: string;
  matchedValue: string;
  matchedRatio: number | null;
  severity: ConflictSeverity;
  reason: string;
  matter: {
    id: string;
    code: string;
    title: string;
    category: MatterCategory;
    status: MatterStatus;
    intakeDate: Date | null;
    canViewMatter: boolean;
    causeText: string | null;
    ownerName: string | null;
    partyRole: PartyRole | null;
    partyStanding: LitigationStanding | null;
  } | null;
};

type SameNameClient = { clientId: string; name: string };
type IdMatchedClient = { clientId: string; name: string; idNumber: string };

type LatestCheck = {
  id: string;
  conclusion: ConflictConclusion;
  hits: Hit[];
  decidedBy: { id: string; name: string } | null;
  decidedAt: Date | null;
  note: string | null;
  checkedAt: Date;
  sameNameClients: SameNameClient[];
  idMatchedClients: IdMatchedClient[];
};

type Props = {
  intakeId: string;
  queries: ReturnType<typeof buildIntakeConflictQueries>;
  latestCheck: LatestCheck | null;
  canEditConclusion: boolean;
  canRunCheck?: boolean;
};

const severityStyle: Record<ConflictSeverity, { color: string; bg: string; label: string }> = {
  BLOCKING: { color: "#B42318", bg: "rgba(220,38,38,0.10)", label: "阻塞" },
  HIGH: { color: "var(--semi-color-warning)", bg: "var(--semi-color-warning-light-default)", label: "高" },
  MEDIUM: { color: "#96650B", bg: "rgba(217,119,6,0.10)", label: "中" },
  LOW: { color: "#1A7F45", bg: "rgba(101,163,13,0.10)", label: "低" }
};

const partyRoleLabel: Record<PartyRole, string> = {
  CLIENT_PARTY: "委托方",
  OPPOSING_PARTY: "对方",
  THIRD_PARTY: "第三人",
  CO_LITIGANT: "共同诉讼人",
  AGENT: "代理人",
  WITNESS: "证人",
  OTHER: "其他"
};

export function ConflictSection({
  intakeId,
  queries,
  latestCheck,
  canEditConclusion,
  canRunCheck=true
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [conclusionNote, setConclusionNote] = useState(latestCheck?.note ?? "");
  const needsHighRiskNote =
    latestCheck?.hits.some((h) => h.severity === "HIGH" || h.severity === "BLOCKING") ?? false;

  function handleRunCheck() {
    if (queries.length === 0) {
      Notification.warning({ title: "没有可检索的当事人", content: "请先在收案中添加委托方或对方", duration: 6 });
      return;
    }

    startTransition(async () => {
      try {
        const res = await runCheckAndSave({ intakeId, queries });
        Notification.success({ title: "冲突检索完成", content: `命中 ${res.hits.length} 条，请逐条核查`, duration: 6 });
      } catch (err) {
        Notification.error({ title: "检索失败", content: actionErrorMessage(err), duration: 6 });
      }
    });
  }

  function handleSetConclusion(conclusion: ConflictConclusion) {
    if (!latestCheck) return;
    if (conclusion === "DIFFERENT" && needsHighRiskNote && !conclusionNote.trim()) {
      Notification.warning({ title: "请先补充承接理由", content: "存在高风险或阻塞命中时，需要写明排除理由或书面同意留痕", duration: 6 });
      return;
    }
    startTransition(async () => {
      try {
        await setConflictConclusion({
          checkId: latestCheck.id,
          conclusion,
          note: conclusionNote
        });
        Toast.success("结论已保存");
      } catch (err) {
        Notification.error({ title: "保存失败", content: actionErrorMessage(err), duration: 6 });
      }
    });
  }

  return (
    <section className="card">
      <div className="panel-head flex-wrap gap-2">
        <div className="min-w-0">
          <div className="panel-title">
            <ShieldCheck aria-hidden className="ic" />
            利益冲突检索
          </div>
          <p className="t-xs t-mute" style={{ marginTop: 2 }}>
            匹配历史案件当事人；客户库同名仅作提示，不计为冲突
          </p>
        </div>

        <Button htmlType="button"
          onClick={handleRunCheck} hidden={!canRunCheck}
          disabled={isPending}
          size="small"
          theme={latestCheck ? "light" : "solid"}
        >
          {isPending ? <Loader2 aria-hidden spin /> : <Search aria-hidden />}
          {latestCheck ? "重新检索" : "运行冲突检索"}
        </Button>
      </div>
      <div className="panel-body">
      {!latestCheck ? (
        <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          还未运行冲突检索
        </div>
      ) : (
        <div className="space-y-3">
          {/* 概览 */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-2.5 text-xs">
            <span className="font-mono text-xs text-muted-foreground">
              {formatDateTime(new Date(latestCheck.checkedAt))}
            </span>
            <span className="text-muted-foreground">·</span>
            <span>
              冲突命中{" "}
              <span className="font-mono text-foreground">{latestCheck.hits.length}</span>
            </span>
            <Tag
              type="light"
              className="ml-1"
              color={latestCheck.conclusion === "SAME_SUBJECT" ? "red" : latestCheck.conclusion === "DIFFERENT" ? "green" : latestCheck.conclusion === "NEED_INFO" ? "amber" : "grey"}
            >
              {latestCheck.note?.startsWith("系统自动标记：")?"未命中（系统自动提示）":conflictConclusionLabel[latestCheck.conclusion]}
            </Tag>
            {latestCheck.decidedBy && !latestCheck.note?.startsWith("系统自动标记：") && (
              <span className="ml-auto text-xs text-muted-foreground">
                {latestCheck.decidedBy.name} ·{" "}
                {latestCheck.decidedAt
                  ? formatDate(new Date(latestCheck.decidedAt))
                  : ""}
              </span>
            )}
          </div>

          {/* 客户库同名提示（非冲突） */}
          {latestCheck.sameNameClients.length > 0 && (
            <InfoBar
              icon={<Info aria-hidden size="small" />}
              tone="info"
              text={`客户库已有 ${latestCheck.sameNameClients.length} 个同名记录（仅提示，非冲突）`}
            >
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {latestCheck.sameNameClients.map((c) => (
                  <Link
                    key={c.clientId}
                    href={`/clients/${c.clientId}`}
                    className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-xs hover:border-primary/40 hover:text-primary"
                  >
                    {c.name}
                    <ExternalLink aria-hidden className="h-2.5 w-2.5" />
                  </Link>
                ))}
              </div>
            </InfoBar>
          )}

          {/* 身份证号一致客户提示（强提示） */}
          {latestCheck.idMatchedClients.length > 0 && (
            <InfoBar
              icon={<AlertTriangle aria-hidden size="small" />}
              tone="warn"
              text={`身份证 / 信用代码与客户库 ${latestCheck.idMatchedClients.length} 条记录精确匹配，请人工核对是否为同一主体`}
            >
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {latestCheck.idMatchedClients.map((c) => (
                  <Link
                    key={c.clientId}
                    href={`/clients/${c.clientId}`}
                    className="inline-flex items-center gap-1 rounded border border-[var(--semi-color-warning-light-active)] bg-[var(--semi-color-warning-light-default)] px-2 py-0.5 text-xs text-[var(--semi-color-warning)] hover:bg-[var(--semi-color-warning-light-default)]"
                  >
                    {c.name} <span className="font-mono opacity-60">{c.idNumber}</span>
                    <ExternalLink aria-hidden className="h-2.5 w-2.5" />
                  </Link>
                ))}
              </div>
            </InfoBar>
          )}

          {/* 冲突命中列表 */}
          {latestCheck.hits.length === 0 ? (
            <div className="rounded-md border border-[#1A7F45]/30 bg-[#1A7F45]/10 p-3 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 aria-hidden size="default" className="text-[#1A7F45]" />
                <span className="text-foreground">本次检索未命中，仍须结合实际主体关系核查</span>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {latestCheck.hits.map((h) => (
                <HitCard key={h.id} hit={h} />
              ))}
            </ul>
          )}

          {/* 结论 */}
          {canEditConclusion ? (
            <div className="rounded-md border border-border bg-background p-3">
              <div className="mb-2 flex items-center gap-2">
                <HelpCircle aria-hidden size="small" className="text-muted-foreground" />
                <h3 className="text-sm font-medium">标记结论</h3>
              </div>
              <TextArea
                value={conclusionNote}
                onChange={(value) => setConclusionNote(value)}
                placeholder="补充说明（如：经核对确认非同一主体；或已披露风险并取得书面同意）"
                rows={2}
                className="mb-2"
              />
              <div className="flex flex-wrap gap-2">
                <Button htmlType="button"
                  theme="outline"
                  type="danger"
                  size="small"
                  onClick={() => handleSetConclusion("SAME_SUBJECT")}
                  disabled={isPending}
                >
                  有冲突（不承接）
                </Button>
                <Button htmlType="button"
                  theme="outline"
                  size="small"
                  onClick={() => handleSetConclusion("DIFFERENT")}
                  disabled={isPending}
                >
                  可承接
                </Button>
                <Button htmlType="button"
                  theme="outline"
                  size="small"
                  onClick={() => handleSetConclusion("NEED_INFO")}
                  disabled={isPending}
                >
                  信息不足，待补充
                </Button>
              </div>
            </div>
          ) : latestCheck.note ? (
            <div className="rounded-md border border-border bg-background p-3">
              <h3 className="mb-1 text-sm font-medium">结论说明</h3>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">{latestCheck.note}</p>
            </div>
          ) : null}
        </div>
      )}
      </div>
    </section>
  );
}

function InfoBar({
  icon,
  tone,
  text,
  children
}: {
  icon: React.ReactNode;
  tone: "info" | "warn";
  text: string;
  children?: React.ReactNode;
}) {
  const colors =
    tone === "warn"
      ? { border: "border-[var(--semi-color-warning-light-active)]", bg: "bg-[var(--semi-color-warning-light-default)]", text: "text-[var(--semi-color-warning)]" }
      : { border: "border-[var(--semi-color-info-light-active)]", bg: "bg-[var(--semi-color-info-light-default)]", text: "text-[var(--semi-color-info)]" };
  return (
    <div className={cn("rounded-md border p-2.5 text-xs", colors.border, colors.bg)}>
      <div className={cn("flex items-center gap-1.5 font-medium", colors.text)}>
        {icon}
        {text}
      </div>
      {children}
    </div>
  );
}

function HitCard({ hit }: { hit: Hit }) {
  const style = severityStyle[hit.severity];
  const m = hit.matter;
  const causeOrCategory = m ? (m.causeText ?? matterCategoryLabel[m.category]) : "—";
  const matterContent = m ? (
    <>
      <div className="flex items-center gap-2 text-xs">
        <Briefcase aria-hidden size="small" className="text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">{m.code}</span>
        <span className="truncate font-medium">{m.title}</span>
        {m.canViewMatter && (
          <ExternalLink aria-hidden size="small" className="ml-auto text-muted-foreground transition-colors group-hover:text-primary" />
        )}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Field label="系统收案">{formatDate(m.intakeDate)}</Field>
        <Field label="当前状态">{matterStatusLabel[m.status]}</Field>
        <Field label="案由/类型">{causeOrCategory}</Field>
        <Field label="主办律师">{m.ownerName ?? "—"}</Field>
        <Field label="命中当事人">
          {hit.matchedName}{" "}
          <span className="text-foreground/70">
            ({m.partyRole ? partyRoleLabel[m.partyRole] : "—"}
            {m.partyStanding ? ` · ${litigationStandingLabel[m.partyStanding]}` : ""})
          </span>
        </Field>
        <Field label="证件号">
          {hit.matchedField === "idNumber" ? (
            <span className="font-mono">{hit.matchedValue}</span>
          ) : (
            "—"
          )}
        </Field>
      </div>
    </>
  ) : null;
  return (
    <li
      className="rounded-md border p-3"
      style={{
        borderColor: `${style.color}40`,
        backgroundColor: style.bg
      }}
    >
      {/* 头：严重度 + 命中字段 */}
      <div className="flex items-center gap-2 text-xs">
        <span
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium"
          style={{ color: style.color, background: `${style.color}1A` }}
        >
          <AlertTriangle aria-hidden size="small" />
          {style.label}
        </span>
        <span className="text-muted-foreground">
          {hit.matchedField === "idNumber" ? "证件号一致" : hit.matchedRatio === 1 ? "姓名一致" : "姓名相似"}
        </span>
        {hit.matchedRatio !== null && hit.matchedRatio < 1 && (
          <span className="font-mono text-xs text-muted-foreground">
            {(hit.matchedRatio * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {/* 主：案件信息 */}
      {m ? (
        m.canViewMatter ? (
          <Link
            href={matterHref({ internalCode: m.code })}
            className="group mt-2 block rounded border border-border bg-background p-2.5 hover:border-primary/40"
          >
            {matterContent}
          </Link>
        ) : (
          <div className="mt-2 rounded border border-border bg-background p-2.5">
            {matterContent}
          </div>
        )
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{hit.reason}</p>
      )}
    </li>
  );
}

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return fmtDate(date);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0 text-muted-foreground/70">{label}：</span>
      <span className="truncate text-foreground/85">{children}</span>
    </div>
  );
}

