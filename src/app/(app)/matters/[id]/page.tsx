import { listPreservationCases } from "@/server/preservations/actions-v2";
import {MatterClosurePanel} from "@/components/matters/closure-panel";
import {getWorkBoard} from "@/server/reminders/work-actions";
import {readMatterReview} from "@/server/conflicts/matter-review";
import {MatterConflictReview} from "./_components/conflict-review";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { TeamMatterOverview } from "./_components/team-matter-overview";
import { notFound, redirect } from "next/navigation";
import { getMatterById } from "@/server/matters/actions";
import { listActiveColleagues } from "@/server/users/actions";
import { getLatestArchiveRecord } from "@/server/archive/actions";
import { getSession } from "@/lib/auth/session";
import { getAiSettings } from "@/lib/ai/settings";
import { isLocalJudgmentConfigured } from "@/lib/cncases/settings";
import { getYuandianSettings } from "@/lib/yuandian/settings";
import { resolveMatterRoute } from "@/server/matters/route";
import { matterHref } from "@/lib/matters/route";
import { prisma } from "@/lib/prisma";
import { nullableDecimalToNumber, serializeDecimals } from "@/lib/decimal";
import { MatterDetailTabs } from "./_components/matter-detail-tabs";
import { listNotes } from "@/server/notes/actions";
import { listEvidenceItems } from "@/server/evidence/actions";
import { getMatterContext } from "@/server/matters/context-actions";
import { MatterContextSection } from "./_components/matter-context-section";
import { MatterBriefSection } from "./_components/matter-brief-section";
import { actionErrorMessage } from "@/lib/action-error";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MatterDetailPage({ params, searchParams }: PageProps) {
  const { id: param } = await params;

  // 路由键是 internalCode（`LL-2026-CC-0001`），但历史书签、通知与审计日志里
  // 存的是 cuid 地址，两者都要认；命中 cuid 时在鉴权通过后再跳规范地址。
  const route = await resolveMatterRoute(param);
  if (!route) notFound();

  const [matterDetail, session] = await Promise.all([
    getMatterById(route.id),
    getSession()
  ]);
  if (!matterDetail) notFound();
  const { businessAccess, ...matterRaw } = matterDetail;

  if (param !== route.internalCode) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams ?? {})) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
    }
    redirect(matterHref(route, query.size ? `?${query}` : ""));
  }

  if (session?.user && !businessAccess) {
    return <TeamMatterOverview matter={matterRaw} />;
  }

  if (!session?.user) redirect("/login");
  const [aiSettings, yuandianSettings] = await Promise.all([
    getAiSettings().catch(() => null), getYuandianSettings().catch(() => null)
  ]);
  const localJudgmentsConfigured = isLocalJudgmentConfigured();
  const allowed = (key: import("@/lib/roles/catalog").PermissionKey) => hasCustomPermission(session.user, key);
  const matter = {
    ...matterRaw,
    claimAmount: nullableDecimalToNumber(matterRaw.claimAmount)
  };

  const [
    userOptions,
    sealContracts,
    expresses,
    latestArchive,
    customFieldDefs,
    preservationCases
  ] = await Promise.all([
    listActiveColleagues(),
    // v0.11: 案件下用印申请关联的合同附件（待盖章稿 + 盖章后扫描件）
    prisma.sealRequest.findMany({
      where: { matterId: matter.id, ...(session.user.role === "CUSTOM" ? { requestedById: session.user.id } : {}) },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        code: true,
        documentTitle: true,
        status: true,
        createdAt: true,
        draftDoc: { select: { id: true, name: true, size: true, createdAt: true } },
        stampedDoc: { select: { id: true, name: true, size: true, createdAt: true } }
      }
    }),
    // v0.11: 案件下快递追踪
    prisma.expressTracking.findMany({
      where: { matterId: matter.id, ...(!allowed("express.manage") ? { id: { in: [] } } : {}) },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        trackingNo: true,
        companyCode: true,
        direction: true,
        purpose: true,
        lastState: true,
        lastUpdateAt: true,
        createdAt: true
      }
    }),
    // v0.18: 最新归档申请状态（用于显示"归档中"/"已驳回" banner）
    allowed("archive.read") ? getLatestArchiveRecord(matter.id) : Promise.resolve(null),
    // v0.28: 案件自定义字段定义（启用项）
    prisma.customFieldDef.findMany({
      where: { entityType: "MATTER", enabled: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, key: true, label: true, fieldType: true, options: true, required: true }
    }),
    listPreservationCases({ matterId: matter.id, status: "ALL" })
  ]);

  // v1.x P2: 委托与证据链（详情页区块；read 已在页面入口校验）
  const [evidenceResult, notes, contextResult] = await Promise.all([
    listEvidenceItems(matter.id).then(items => ({ items, error: null })).catch(error => ({ items: [], error: actionErrorMessage(error) })),
    allowed("schedule.read") ? listNotes(matter.id).catch(() => []) : Promise.resolve([]),
    getMatterContext(matter.id).then(view => ({ view, error: null })).catch(error => ({ view: null, error: actionErrorMessage(error) }))
  ]);
  const currentMatterMember = session?.user.id
    ? matter.members.find((member) => member.userId === session.user.id)
    : null;
  const canAssociateThisMatter = Boolean(
    allowed("matters.write") && session?.user.id &&
      (matter.ownerId === session.user.id ||
        currentMatterMember)
  );
  const canLeadThisMatter = Boolean(
    allowed("matters.write") && session?.user.id &&
      (matter.ownerId === session.user.id ||
        currentMatterMember?.role === "LEAD" ||
        currentMatterMember?.role === "CO_LEAD")
  );
  const canOwnThisMatter = Boolean(allowed("matters.write") && session?.user.id && matter.ownerId === session.user.id);

  const preservationCasesForClient = serializeDecimals(preservationCases);

  const refreshKey = Date.now();
  const [conflictReview, workBoard] = await Promise.all([
    readMatterReview(prisma, matter.id),
    getWorkBoard({ matterId: matter.id }),
  ]);
  return (
    <>
      {/* 墨案 04 页面骨架由 MatterDetailTabs 统一承载：
          上下文头 → 信号条 → 程序链卡 → 三栏工作区（环节导航 / 工作区 / 辅助栏） */}
      <MatterDetailTabs
        workBoard={workBoard}
        closureNode={allowed("archive.read") && (matter.ownerId === session.user.id || currentMatterMember)
          ? <MatterClosurePanel matterId={matter.id} refreshKey={refreshKey} />
          : null}
        conflictNode={<MatterConflictReview matterId={matter.id} data={conflictReview} canWrite={canAssociateThisMatter&&matter.status!=="ARCHIVED"}/>}
        matter={matter}
        userOptions={[
          ...userOptions,
          ...matter.members.filter((m) => !userOptions.some((u) => u.id === m.userId)).map((m) => ({ ...m.user, active: false, isTeammate: false }))
        ]}
        colleagues={userOptions.map(({ id, name }) => ({ id, name }))}
        rolePermissions={session.user.rolePermissions}
        currentUserId={session.user.id}
        currentUserRole={session?.user.role ?? null}
        canAssociateThisMatter={canAssociateThisMatter}
        canLeadThisMatter={canLeadThisMatter}
        canOwnThisMatter={canOwnThisMatter}
        sealContracts={sealContracts}
        expresses={expresses}
        latestArchive={latestArchive}
        customFieldDefs={customFieldDefs}
        preservationCases={preservationCasesForClient}
        evidenceItems={evidenceResult.items}
        evidenceError={evidenceResult.error}
        materialRefreshKey={refreshKey}
        briefNode={<MatterBriefSection matterId={matter.id} refreshKey={refreshKey} />}
        contextNode={contextResult.view
          ? <MatterContextSection key={matter.id} matterId={matter.id} view={contextResult.view} />
          : <section key={matter.id} className="dos-group p-4 text-sm text-destructive" role="alert">事项上下文暂不可读取：{contextResult.error} <a className="underline" href={matterHref(matter)}>重新加载</a></section>}
        notes={notes}
        capabilities={{
          aiReview: aiSettings?.configured ?? false,
          caseSearch: !!yuandianSettings?.configured || localJudgmentsConfigured,
          yuandian: !!yuandianSettings?.configured,
          localJudgments: localJudgmentsConfigured
        }}
      />
    </>
  );
}
