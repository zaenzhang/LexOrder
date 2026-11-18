import { Tag as SemiTag } from "@/components/patterns/semi-surfaces";
import {hasCustomPermission} from "@/lib/roles/catalog";
import {getWorkBoard} from "@/server/reminders/work-actions";
import {WorkResponsibilityPanel} from "@/components/matters/work-responsibility-panel";
import {intakeWorkflowReady} from "@/server/intakes/workflow";
import {readIntakeRounds} from "@/server/intakes/revision-history";
import {RevisionHistory} from "./_components/revision-history";
import {RevisionControls} from "./_components/revision-controls";
import { buildIntakeConflictQueries } from "@/lib/approvals/intake-detail";
import { canApproveItem } from "@/lib/approvals/service";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Users, AlertTriangle } from "lucide-react";
import { getIntakeById } from "@/server/intakes/actions";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { decryptIdNumber } from "@/lib/clients/id-number-crypto";
import { FieldGrid, FieldItem, PageHeader, Panel } from "@/components/patterns/moan";
import {
  matterCategoryLabel,
  intakeStatusLabel,
  clientTypeLabel
} from "@/lib/enums";
import { ConflictSection } from "./_components/conflict-section";
import { IntakeActions } from "./_components/intake-actions";
import { IntakeMaterialContinuationView } from "@/components/intakes/material-continuation";
import { matterHref } from "@/lib/matters/route";
import { formatDate } from "@/lib/utils";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function IntakeDetailPage({ params }: PageProps) {
  const { id } = await params;
  // 无权查看或不存在统一按 404 处理，不把服务端错误暴露为运行时异常
  const [intake, session] = await Promise.all([getIntakeById(id).catch(() => null), getSession()]);
  if (!intake) notFound();
  if (intake.teamReadOnly) return (
    <div className="space-y-4">
      <PageHeader
        className="!mb-0"
        back={{ href: "/matters?tab=intake", label: "返回收案列表" }}
        title={intake.title}
        sub={<>团队查看 · 收案信息 · <SemiTag size="small" color="grey">{intakeStatusLabel[intake.status]}</SemiTag></>}
      />
      {intake.materialContinuation ? <IntakeMaterialContinuationView value={intake.materialContinuation} /> : null}
      <Panel title="收案信息">
        <FieldGrid cols={3}>
          <FieldItem label="主办律师">{intake.ownerUser?.name ?? "尚未指定"}</FieldItem>
          <FieldItem label="客户">{intake.client?.name ?? "未填写"}</FieldItem>
          <FieldItem label="收案时间" mono>{formatDate(new Date(intake.receivedAt))}</FieldItem>
          <FieldItem label="案由">{intake.cause?.name ?? intake.causeFreeText ?? "未填写"}</FieldItem>
          <FieldItem label="办理机构">{intake.firstAgency ?? "未填写"}</FieldItem>
          <FieldItem label="当事人">{intake.parties.map((party) => party.name).join("、") || "未填写"}</FieldItem>
          {intake.description ? <FieldItem label="描述" wide><span className="whitespace-pre-wrap">{intake.description}</span></FieldItem> : null}
        </FieldGrid>
      </Panel>
      <p className="t-xs t-mute">审批、修改、财务和材料下载按原有权限开放。</p>
    </div>
  );

  const workflowEnabled=await intakeWorkflowReady(prisma);
  const rounds=await readIntakeRounds(prisma,id,!!session&&hasCustomPermission(session.user,"finance.read"));
  const isEditor=session?.user.id===intake.createdById||session?.user.id===intake.ownerUserId;
  const opposing = intake.parties.filter((p) => p.role === "OPPOSING_PARTY");
  const thirdParty = intake.parties.filter((p) => p.role === "THIRD_PARTY");
  const latestCheckRaw = intake.conflictChecks[0] ?? null;
  const createdBy = await prisma.user.findUnique({
    where: { id: intake.createdById },
    select: { id: true, name: true }
  });

  // 拉每条 hit 对应的 Matter 详情（编号 / 名 / 案由 / 主办 / 当事人角色）
  let latestCheck: Parameters<typeof ConflictSection>[0]["latestCheck"] = null;
  if (latestCheckRaw) {
    const matterIds = Array.from(
      new Set(
        latestCheckRaw.hits.filter((h) => h.targetType === "Matter").map((h) => h.targetId)
      )
    );
    const matters = matterIds.length
      ? await prisma.matter.findMany({
          where: { id: { in: matterIds }, deletedAt: null },
          select: {
            id: true,
            internalCode: true,
            title: true,
            category: true,
            status: true,
            intakeDate: true,
            ownerId: true,
            cause: { select: { name: true } },
            causeFreeText: true,
            owner: { select: { name: true } },
            members: { select: { userId: true } },
            parties: { select: { name: true, idNumber: true, role: true, standing: true } }
          }
        })
      : [];
    const matterById = new Map(matters.map((m) => [m.id, m]));

    const hitsWithMatter = latestCheckRaw.hits.map((h) => {
      const m = matterById.get(h.targetId);
      const canViewMatter = Boolean(
        session?.user.id &&
          m &&
          (m.ownerId === session.user.id ||
            m.members.some((member) => member.userId === session.user.id))
      );
      const matchedParty = m?.parties.find(
        (p) =>
          (h.matchedField === "name" && p.name === h.matchedValue) ||
          (h.matchedField === "idNumber" && p.idNumber === h.matchedValue)
      );
      return {
        id: h.id,
        hitType: h.hitType,
        targetType: h.targetType,
        targetId: canViewMatter ? h.targetId : "",
        matchedName: h.matchedName,
        matchedField: h.matchedField,
        matchedValue: h.matchedValue,
        matchedRatio: h.matchedRatio,
        severity: h.severity,
        reason: h.reason,
        matter: m
          ? {
              id: canViewMatter ? m.id : "",
              code: m.internalCode,
              title: m.title,
              category: m.category,
              status: m.status,
              intakeDate: m.intakeDate,
              canViewMatter,
              causeText: m.cause?.name ?? m.causeFreeText ?? null,
              ownerName: m.owner?.name ?? null,
              partyRole: matchedParty?.role ?? null,
              partyStanding: matchedParty?.standing ?? null
            }
          : null
      };
    });

    // 兼容 V1 旧数据：queryPayload 没有 sameNameClients / idMatchedClients
    const payload = (latestCheckRaw.queryPayload ?? {}) as {
      sameNameClients?: { clientId: string; name: string }[];
      idMatchedClients?: { clientId: string; name: string; idNumber: string }[];
    };

    latestCheck = {
      id: latestCheckRaw.id,
      conclusion: latestCheckRaw.conclusion,
      hits: hitsWithMatter,
      decidedBy: latestCheckRaw.decidedBy,
      decidedAt: latestCheckRaw.decidedAt,
      note: latestCheckRaw.note,
      checkedAt: latestCheckRaw.checkedAt,
      sameNameClients: payload.sameNameClients ?? [],
      idMatchedClients: payload.idMatchedClients ?? []
    };
  }

  const showApprovalLink = intake.status === "PENDING_CONFIRMATION" || intake.status === "NEEDS_REVISION";
  const statusColor = intake.status === "CONVERTED" ? "teal" : intake.status === "DECLINED" ? "red" : "amber";

  return (
    <div className="space-y-4">
      <PageHeader
        className="!mb-0"
        back={{ href: "/matters?tab=intake", label: "返回收案列表" }}
        title={intake.title}
        sub={
          <span className="flex flex-wrap items-center gap-1.5">
            <SemiTag size="small" color="grey">{matterCategoryLabel[intake.category]}</SemiTag>
            <SemiTag size="small" color={statusColor}>{intakeStatusLabel[intake.status]}</SemiTag>
            {intake.matter ? (
              <Link href={matterHref(intake.matter)} className="text-sm font-medium text-primary">已转为案件 {intake.matter.internalCode} →</Link>
            ) : null}
          </span>
        }
        actions={
          showApprovalLink ? (
            <IntakeActions intakeId={intake.id} status={intake.status} canApprove={intake.status === "PENDING_CONFIRMATION" && !!session?.user && await canApproveItem(session.user.id, "INTAKE_APPROVE", intake.id)} canResubmit={isEditor && intake.status === "NEEDS_REVISION"} />
          ) : null
        }
      />

      {intake.materialContinuation ? <IntakeMaterialContinuationView value={intake.materialContinuation} /> : null}

      {workflowEnabled&&isEditor&&<RevisionControls id={id} status={intake.status}/>}
      <WorkResponsibilityPanel data={await getWorkBoard({intakeId:id})} intakeId={id}/>
      <RevisionHistory rounds={rounds}/>
      {intake.declinedReason ? (
        <div className="flex items-start gap-2 rounded-[10px] border border-[var(--semi-color-danger-light-active)] bg-[var(--semi-color-danger-light-default)] px-3.5 py-3 text-[12.5px]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--semi-color-danger)]" />
          <div><b className="text-[var(--semi-color-danger)]">{intake.status==="DECLINED"?"不接案原因":"补正说明"}</b><div className="mt-0.5 text-[var(--semi-color-text-1)]">{intake.declinedReason}</div></div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Panel title="收案信息">
            <FieldGrid cols={3}>
              <FieldItem label="案由">{intake.cause?.name ?? intake.causeFreeText ?? "—"}</FieldItem>
              <FieldItem label="发起人">{createdBy?.name ?? "—"}</FieldItem>
              <FieldItem label="主办律师">{intake.ownerUser?.name ?? "—"}</FieldItem>
              <FieldItem label="客户">
                {intake.client ? <Link href={`/clients/${intake.client.id}`} className="text-[var(--semi-color-primary-active)] hover:underline">{intake.client.name}</Link> : "—"}
              </FieldItem>
              <FieldItem label="收案日期" mono>{formatDate(new Date(intake.receivedAt))}</FieldItem>
              <FieldItem label="办理机构">{intake.firstAgency ?? "—"}</FieldItem>
              {intake.description ? <FieldItem label="描述" wide><span className="whitespace-pre-wrap">{intake.description}</span></FieldItem> : null}
            </FieldGrid>
          </Panel>

          <ConflictSection
            intakeId={intake.id}
            queries={buildIntakeConflictQueries(intake, decryptIdNumber)}
            latestCheck={latestCheck}
            canRunCheck={isEditor && (!workflowEnabled || ["INTAKE","NEEDS_REVISION"].includes(intake.status))}
            canEditConclusion={isEditor && ["INTAKE","NEEDS_REVISION"].includes(intake.status)}
          />
        </div>

        <Panel title="当事人" icon={Users} count={intake.parties.filter(p=>p.role!=="CLIENT_PARTY").length + (intake.client ? 1 : intake.parties.filter(p=>p.role==="CLIENT_PARTY").length)} className="xl:sticky xl:top-[68px]">
          <div className="space-y-3">
            <PartyGroup title="客户 / 委托方" tone="teal">
              {intake.client ? <PartyCard name={intake.client.name} sub={clientTypeLabel[intake.client.type]} href={`/clients/${intake.client.id}`} /> : intake.parties.some(p=>p.role==="CLIENT_PARTY") ? intake.parties.filter(p=>p.role==="CLIENT_PARTY").map(p=><PartyCard key={p.id} name={p.name} sub={p.idNumber||p.enterpriseSocialCode||undefined}/>) : <Empty />}
            </PartyGroup>
            <PartyGroup title="相对方" tone="amber">
              {opposing.length === 0 ? <Empty /> : opposing.map((p) => <PartyCard key={p.id} name={p.name} sub={p.idNumber || undefined} />)}
            </PartyGroup>
            <PartyGroup title="第三人" tone="violet">
              {thirdParty.length === 0 ? <Empty /> : thirdParty.map((p) => <PartyCard key={p.id} name={p.name} sub={p.idNumber || undefined} />)}
            </PartyGroup>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function PartyGroup({ title, tone, children }: { title: string; tone: "teal" | "amber" | "violet"; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={`dot dot-${tone}`} />
        <span className="t-xs t-mute" style={{ fontWeight: 600 }}>{title}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function PartyCard({ name, sub, href }: { name: string; sub?: string; href?: string }) {
  const inner = (
    <div className="rounded-[9px] border border-[var(--semi-color-border)] bg-[var(--semi-color-bg-0)] px-3 py-2 transition-colors hover:bg-[var(--semi-color-fill-0)]">
      <div className="truncate text-[13px] font-medium">{name}</div>
      {sub ? <div className="mt-0.5 font-mono text-[11px] text-[var(--semi-color-text-2)]">{sub}</div> : null}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

function Empty() {
  return <div className="rounded-[9px] border border-dashed border-[var(--semi-color-border)] py-2 text-center text-[11px] text-[var(--semi-color-text-3)]">—</div>;
}
