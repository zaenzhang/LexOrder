"use client";

import { MatterListBack } from "./matter-list-back";

import { Card as SemiCard, Tag as SemiTag } from "@/components/patterns/semi-surfaces";
import { statusTagColor } from "@/lib/ui/status-tones";
import { Button as SemiButton } from "@douyinfe/semi-ui";
import { deadlineOverdue, deadlineRelative, formatDeadlineDue } from "@/lib/deadline-due";
import Link from "next/link";
import { hasCustomPermission, type RoleGrant } from "@/lib/roles/catalog";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { List, Notification, Toast } from "@douyinfe/semi-ui";
import type { ClientType, Prisma } from "@prisma/client";
import { IconArchive as Archive, IconClock as Clock3, IconEdit as FileSignature, IconVerify as Gavel, IconEdit as Pencil, IconPlus as Plus } from "@douyinfe/semi-icons";
import { CaseSearchPanel } from "./case-search-panel";
import { DocumentReviewDialog } from "./document-review-dialog";
import { DocActionsContext } from "./doc-actions-context";
import { WorkspaceDialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/patterns/workspace-dialog";
import { matterStatusTone } from "@/lib/ui/status-tones";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { ProgressDialog } from "./progress-dialog";
import {
  matterStatusLabel,
  procedureTypeLabel,
  matterCategoryKind,
  matterCategoryLabel,
  feeTypeLabel
} from "@/lib/enums";
import { cn } from "@/lib/utils";
import { MatterArchive, TeamRailCard } from "./matter-archive";
import { MatterBriefSection } from "./matter-brief-section";
import { FinancePanel } from "./finance-panel";
import { ImportantItemDialog } from "./procedure-content";
import { ProcedureWorkflowPanel, MatterPreservationContent } from "./procedure-workflow-panel";
import type { WorkBoardData } from "@/components/matters/work-responsibility-panel";
import { openDossierDeadline, updateDossierLocation, type DossierView } from "@/lib/matters/dossier-location";
import { matterHref } from "@/lib/matters/route";
import { FactsWorkspace } from "./facts-workspace";
import { DeliveryPanel } from "@/components/deliveries/delivery-panel";
import { DocumentDetail } from "@/components/documents/document-detail";
import type { WaitingItem, WorkflowApi, WorkflowNote, WorkflowPreservationCase } from "./procedure-workflow-panel";

import { ApprovalsPanel } from "./approvals-panel";
import type { SealContractItem, ExpressItem } from "./info-extras";
import { AddDeadlineDialog, AddHearingDialog, AddProcedureSheet } from "./procedure-forms";
import { deleteProcedure } from "@/server/procedures/actions";
import { procedureStateLabel } from "@/lib/procedure-status";
import { ProcedureStatusActions } from "./procedure-status-actions";
import { useRouter, useSearchParams } from "next/navigation";
import { LifecycleActions } from "./lifecycle-actions";
import { AddBillingSheet } from "./finance-forms";
import { EvidenceItemDialog, type EvidenceItemRow } from "./evidence-panel";
import { ArchiveStatusBanner } from "./archive-status-banner";
import { ArchiveWizardDialog } from "./archive-wizard";
import { TeamEditorDialog, type MatterEditorSection } from "./team-editor-dialog";
import { loadMatterDetailFinance, loadMatterMaterials } from "@/server/matters/detail-panels";
import { ReviewSummaryCard } from "./review-summary-card";
import { DetailSectionStatus, useDetailSection } from "@/components/patterns/detail-section-loading";
import type { UserOption as PresUserOption } from "@/app/(app)/preservation/_components/preservation-types";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { shDayKey, shDaysFromToday, shMonthDay, shTime } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";
import { MaterialToolsSheet } from "./material-tools-sheet";
import { PendingMaterialUploads } from "./pending-material-uploads";

type MatterPayloadBase = Prisma.MatterGetPayload<{
  include: {
    primaryClient: { include: { contacts: { where: { isPrimary: true }; take: 1 } } };
    clientLinks: { include: { client: { select: { id: true; name: true; type: true; idNumber: true } } } };
    owner: { select: { id: true; name: true; role: true } };
    members: { include: { user: { select: { id: true; name: true; role: true } } } };
    cause: true;
    parties: true;
    relatedEntities: true;
    intake: {
      select: {
        counterclaim: true;
        claimDescription: true;
        description: true;
        contactName: true;
        contactPhone: true;
        receivedAt: true;
        createdBy: { select: { name: true } };
      };
    };
    linksFrom: {
      include: { relatedMatter: { select: { id: true; internalCode: true; firmCaseNo: true; title: true } } };
    };
    linksTo: {
      include: { matter: { select: { id: true; internalCode: true; firmCaseNo: true; title: true } } };
    };
    procedures: {
      include: {
        deadlines: true;
        hearings: true;
        stages: { include: { tasks: { include: { responsibility: { select: { state: true; closedAt: true } } } } } };
        procedureParties: { include: { party: true } };
        memos: true;
      };
    };
    timelineEvents: true;
  };
}>;

type MatterPayload = Omit<MatterPayloadBase, "claimAmount" | "members"> & {
  claimAmount: number | null;
  members: (MatterPayloadBase["members"][number] & { user: MatterPayloadBase["members"][number]["user"] & { roleName?: string } })[];
};

export type FinancePayload = {
  contractDocuments: { id: string; name: string; createdAt: Date; mimeType: string | null }[];
  billings: {
    id: string;
    title: string;
    contractAmount: number;
    schedule: string | null;
    status: "DRAFT" | "ACTIVE" | "CLOSED";
    signedAt: Date | null;
    createdAt: Date;
  }[];
  entries: {
    id: string;
    type: "RECEIVABLE" | "RECEIVED" | "REFUND" | "COST" | "COMMISSION";
    amount: number;
    occurredAt: Date;
    billingId: string | null;
    invoiceNo: string | null;
    payerOrPayee: string | null;
    method: string | null;
    note: string | null;
    parentFeeEntryId: string | null;
    beneficiaryUserId: string | null;
    beneficiaryUser: { id: string; name: string } | null;
    parentFeeEntry: { id: string; type: string } | null;
    confirmState: "PENDING" | "CONFIRMED";
    recordedById: string;
  }[];
  plans: {
    id: string;
    userId: string;
    percent: number;
    label: string | null;
    active: boolean;
    user: { id: string; name: string; role: string; roleName?: string; isTeammate?: boolean; active?: boolean };
  }[];
  stats: {
    outstanding: number;
    allocated: number;
    clientFunds: number;
    contractAmount: number;
    receivable: number;
    received: number;
    /** 已登记、待确认到账的实收，不计入已收 */
    pendingReceived: number;
    refund: number;
    cost: number;
    commission: number;
    invoiced: number;
  };
};

type UserOption = { id: string; name: string; role: string; roleName?: string; isTeammate?: boolean; active?: boolean };

export type NotePayload = {
  id: string;
  channel: "PHONE" | "WECHAT" | "EMAIL" | "MEETING" | "COURT" | "OTHER";
  withWhom: string | null;
  occurredAt: Date;
  content: string;
  tags: string[];
  author: { id: string; name: string };
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
};


export function MatterDetailTabs({
  matter,
  userOptions,
  colleagues,
  currentUserId,
  currentUserRole,
  rolePermissions,
  canAssociateThisMatter,
  canLeadThisMatter,
  canOwnThisMatter,
  sealContracts,
  expresses,
  latestArchive,
  customFieldDefs,
  preservationCases,
  evidenceItems,
  evidenceError,
  materialRefreshKey,
  contextNode,
  notes,
  workBoard, closureNode, conflictNode,
  capabilities = { aiReview: false, caseSearch: false }
}: {
  matter: MatterPayload;
  userOptions: UserOption[];
  colleagues: PresUserOption[];
  currentUserId: string;
  currentUserRole: string | null;
  rolePermissions?: RoleGrant[];
  canAssociateThisMatter: boolean;
  canLeadThisMatter: boolean;
  canOwnThisMatter: boolean;
  sealContracts: SealContractItem[];
  expresses: ExpressItem[];
  latestArchive: {
    id: string;
    archiveNo: string;
    status: "PENDING_REVIEW" | "REJECTED" | "APPROVED";
    reviewedAt: Date | null;
    reviewNote: string | null;
    archivedBy: string;
    missingItems: string[];
  } | null;
  customFieldDefs: {
    id: string;
    key: string;
    label: string;
    fieldType: "TEXT" | "NUMBER" | "DATE" | "SELECT";
    options: string[];
    required: boolean;
  }[];
  preservationCases: WorkflowPreservationCase[];
  evidenceItems: EvidenceItemRow[];
  evidenceError?: string | null;
  materialRefreshKey?: number;
  contextNode?: React.ReactNode;
  notes: WorkflowNote[];
  workBoard: WorkBoardData;
  closureNode?: React.ReactNode;
  conflictNode?: React.ReactNode;
  /** 外部能力是否已配置：AI 文书审查 / 元典类案检索（未配置不显示入口） */
  capabilities?: { aiReview: boolean; caseSearch: boolean; yuandian?: boolean; localJudgments?: boolean };
}) {
  const allowed = (key: import("@/lib/roles/catalog").PermissionKey) => hasCustomPermission({ role: currentUserRole ?? "", rolePermissions }, key);
  const searchParams = useSearchParams();
  const matterReturnTo = matterHref(matter, searchParams.size ? `?${searchParams.toString()}` : "");
  const selectedProcId = searchParams.get("procedure");
  const requestedView = searchParams.get("view");
  const view: DossierView = requestedView === "work" || requestedView === "money" || requestedView === "seal" ? requestedView : "archive";
  const setView = (nextView: DossierView) => updateDossierLocation({ view: nextView });
  const setSelectedProcId = (procedure: string | null) => updateDossierLocation({ procedure, stage: null, task: null, deadline: null });
  const [addProcOpen, setAddProcOpen] = useState(false);
  const [matterEditorOpen, setMatterEditorOpen] = useState(false);
  const [matterEditorSection, setMatterEditorSection] = useState<MatterEditorSection>("matter");
  const matterEditorTrigger = useRef<HTMLElement | null>(null);
  const matterHeading = useRef<HTMLHeadingElement>(null);
  const [ledgerAdd, setLedgerAdd] = useState<"express" | "hearing" | "deadline" | null>(null);
  const [caseSearchOpen, setCaseSearchOpen] = useState(false);
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);
  const exactDocumentId = searchParams.get("document");
  const exactReviewIssue = searchParams.get("reviewIssue");
  const [displayDocumentId, setDisplayDocumentId] = useState(exactDocumentId);
  const [displayReviewIssue, setDisplayReviewIssue] = useState(exactReviewIssue);
  const displayDocumentRef = useRef(exactDocumentId);
  const displayIssueRef = useRef(exactReviewIssue);
  const documentDraftRef = useRef({ dirty: false, busy: false });
  const documentDraft = useCallback((dirty: boolean, busy: boolean) => { documentDraftRef.current = { dirty, busy }; }, []);
  useEffect(() => {
    if (exactDocumentId === displayDocumentRef.current && exactReviewIssue === displayIssueRef.current) return;
    let active = true;
    const requested = exactDocumentId;
    void (async () => {
      const state = documentDraftRef.current;
      const allowed = !state.busy && (!state.dirty || await confirmDialog({
        title: "放弃未保存的文书输入？", confirmText: "放弃并离开", cancelText: "继续编辑", initialFocus: "cancel",
      }));
      if (!active) return;
      if (!allowed) { updateDossierLocation({ document: displayDocumentRef.current, reviewIssue: displayIssueRef.current }, "replace"); return; }
      displayDocumentRef.current = requested;
      displayIssueRef.current = exactReviewIssue;
      setDisplayDocumentId(requested);
      setDisplayReviewIssue(exactReviewIssue);
    })();
    return () => { active = false; };
  }, [exactDocumentId, exactReviewIssue]);
  const leaveDocument = useCallback((document: string | null) => {
    documentDraftRef.current = { dirty: false, busy: false };
    displayDocumentRef.current = document;
    displayIssueRef.current = null;
    setDisplayDocumentId(document);
    setDisplayReviewIssue(null);
    updateDossierLocation({ document, reviewIssue: null });
  }, []);
  const [deliveryPrepareSignal, setDeliveryPrepareSignal] = useState(0);
  const workDrafts = useRef({ research: { dirty: false, busy: false }, delivery: { dirty: false, busy: false }, task: { dirty: false, busy: false } });
  const researchDraft = useCallback((dirty: boolean, busy: boolean) => { workDrafts.current.research = { dirty, busy }; }, []);
  const deliveryDraft = useCallback((dirty: boolean, busy: boolean) => { workDrafts.current.delivery = { dirty, busy }; }, []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (Object.values(workDrafts.current).some(value => value.dirty || value.busy)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect);
  }, []);
  const openDocument = useCallback((document: string) => updateDossierLocation({ document, reviewIssue: null }), []);
  const selectReviewIssue = useCallback((reviewIssue: string | null) => {
    displayIssueRef.current = reviewIssue;
    setDisplayReviewIssue(reviewIssue);
    updateDossierLocation({ reviewIssue });
  }, []);
  const deliveryLocation = useCallback((delivery: string | null, deliveryEvent?: string | null) => updateDossierLocation({ workPane: "records", recordsView: "delivery", delivery, deliveryEvent: deliveryEvent ?? null, deliveryDocument: null }), []);
  async function prepareDocumentDelivery(document: string) {
    if (workDrafts.current.delivery.busy) return;
    if (workDrafts.current.delivery.dirty && !await confirmDialog({ title: "放弃未保存的交付内容？", confirmText: "放弃并重新准备", cancelText: "继续编辑", initialFocus: "cancel" })) return;
    documentDraftRef.current = { dirty: false, busy: false };
    displayDocumentRef.current = null;
    displayIssueRef.current = null;
    setDisplayDocumentId(null);
    setDisplayReviewIssue(null);
    updateDossierLocation({ view: "work", workPane: "records", recordsView: "delivery", document: null, reviewIssue: null, delivery: null, deliveryEvent: null, deliveryDocument: document });
    setDeliveryPrepareSignal(value => value + 1);
  }

  // 证据要点挂在材料行上（2026-09-14 证据链并入材料）
  const [evidenceDocId, setEvidenceDocId] = useState<string | null | undefined>(undefined);
  const evidenceByDoc = useMemo(() => {
    const map = new Map<string, EvidenceItemRow[]>();
    for (const item of evidenceItems) {
      const ids = new Set([item.sourceDocumentId, ...(item.sources ?? []).map(source => source.documentId)].filter((id): id is string => Boolean(id)));
      for (const id of ids) map.set(id, [...(map.get(id) ?? []), item]);
    }
    return map;
  }, [evidenceItems]);
  const canAddEvidence = canAssociateThisMatter && allowed("matters.write") && matter.status !== "ARCHIVED";
  const docActions = useMemo(
    () => ({
      onOpenDocument: openDocument,
      ...(allowed("documents.read") ? { onReview: (id: string) => setReviewDocId(id) } : {}),
      evidenceByDoc,
      unlinkedEvidence: evidenceItems.filter((it) => !it.sourceDocumentId && !(it.sources ?? []).some(source => source.documentId)),
      ...(canAddEvidence ? { onAddEvidence: (docId: string | null) => setEvidenceDocId(docId) } : {})
    }),
    [capabilities.aiReview, currentUserRole, rolePermissions, evidenceByDoc, evidenceItems, canAddEvidence, openDocument] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [progress, setProgress] = useState<{ mode: "record" | "judgment"; stage?: string; stageNames: string[]; note?: WorkflowNote } | null>(null);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [hearingOpen, setHearingOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const workflowApi = useRef<WorkflowApi | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function openMatterEditor(section: MatterEditorSection, returnFocusTarget?: HTMLElement | null) {
    matterEditorTrigger.current = returnFocusTarget ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : null);
    setMatterEditorSection(section);
    setMatterEditorOpen(true);
  }

  function handleDeleteProcedure(id: string) {
    startTransition(async () => {
      try {
        const result = await deleteProcedure(id);
        if (!result.ok) { Toast.error("程序不存在或已变化"); return; }
        Toast.success("程序已删除");
        if (new URLSearchParams(window.location.search).get("procedure") === id) setSelectedProcId(null);
        router.refresh();
      } catch (err) {
        Notification.error({ title: "删除失败", content: actionErrorMessage(err) });
      }
    });
  }

  const engagedProcedures = [...matter.procedures].sort((a, b) => a.order - b.order);

  // A missing selection means the whole matter; viewing does not select a legal state.
  const currentProcedure: ProcedureItem | null = selectedProcId !== null ? engagedProcedures.find((p) => p.id === selectedProcId) ?? null : null;
  const invalidProcedure = selectedProcId !== null && currentProcedure === null;
  const canEditMatterInfo = canLeadThisMatter;
  const canOpenUnifiedEditor =
    canEditMatterInfo ||
    canOwnThisMatter ||
    Boolean(currentProcedure && canAssociateThisMatter);
  const isArchived = matter.status === "ARCHIVED";
  const isAssociated = matter.ownerId === currentUserId || matter.members.some(member => member.userId === currentUserId);
  const canWriteSchedule = isAssociated && allowed("schedule.write") && !isArchived;
  const canWriteMaterials = isAssociated && allowed("documents.write") && !isArchived;
  // 已归档案件只读：不再提供添加记录、上传材料与新增程序入口
  const canWriteRecords = canWriteSchedule;

  useTopbarAction("none");

  const canReadMaterials = allowed("documents.read");
  const canReadFinance = allowed("finance.read");
  const workPane = searchParams.get("workPane") ?? "materials";
  const materialsActive = view === "work" && workPane === "materials";
  const materialsSection = useDetailSection(loadMatterMaterials, matter.id, materialRefreshKey,
    ((canReadMaterials || canWriteMaterials) && materialsActive) || (canReadMaterials && evidenceDocId !== undefined));
  const financeSection = useDetailSection(loadMatterDetailFinance, matter.id, materialRefreshKey, canReadFinance && view === "money");
  const materials = canReadMaterials || canWriteMaterials ? materialsSection.data : undefined;
  const finance = canReadFinance ? financeSection.data : undefined;
  const documents = canReadMaterials ? materials?.documents ?? [] : [];
  const materialStatus = canReadMaterials || canWriteMaterials
    ? materials ? undefined : <DetailSectionStatus label="材料" {...materialsSection} />
    : <p role="status" className="text-sm text-muted-foreground">当前角色无权读取材料。</p>;

  // 当前选中程序的文档
  const procDocs = documents
        .filter((d) => !currentProcedure || d.procedureId === currentProcedure.id)
        .map((d) => ({
          id: d.id,
          name: d.name,
          category: d.category,
          mimeType: d.mimeType,
          size: d.size,
          createdAt: d.createdAt,
          sourceParty: d.sourceParty,
          tags: d.tags ?? [],
          stageId: d.stageId ?? null,
          procedureId: d.procedureId ?? null,
          sourceOrigin: d.sourceOrigin ?? null,
          ocrStatus: d.ocrStatus ?? null,
          textSource: d.textSource ?? null,
          pageCount: d.pageCount ?? null,
          sha256: d.sha256 ?? null,
          templateId: d.templateId ?? null,
          version: d.version ?? null,
          familyId: d.familyId,
          isLatest: d.isLatest
        }));
  const procedureParties = buildProcedurePartyOptions(matter);
  const customValues =
    matter.customValues &&
    typeof matter.customValues === "object" &&
    !Array.isArray(matter.customValues)
      ? (matter.customValues as Record<string, string>)
      : {};
  const restricted = Boolean((matter as { teamAccessRestricted?: boolean }).teamAccessRestricted);
  const procLabel = (p: ProcedureItem) => p.customLabel ?? procedureTypeLabel[p.type] ?? p.type;

  const archiveBadge = matter.status === "ARCHIVED"
    ? { color: "amber", text: "已归档" } as const
    : latestArchive?.status === "PENDING_REVIEW"
      ? { color: "amber", text: "预归档中" } as const
      : latestArchive?.status === "REJECTED"
        ? { color: "red", text: "归档被驳回" } as const
        : null;

  const categoryKind = matterCategoryKind(matter.category);
  const parties = procedureParties;
  const ours = parties.filter((p) => p.role === "CLIENT_PARTY");
  const opposing = parties.filter((p) => p.role === "OPPOSING_PARTY");

  // 案卷头异常标签：当前程序逾期事项、保全临期
  const overdueCount = currentProcedure
    ? currentProcedure.stages.flatMap((s) => (s.status === "HIDDEN" ? [] : s.tasks)).filter((t) => !t.completed && t.dueAt && shDaysFromToday(t.dueAt) < 0).length +
      currentProcedure.deadlines.filter((d) => !d.completed && deadlineOverdue(d.dueAt, d.duePrecision)).length
    : 0;
  const expiringProps = preservationCases
    .flatMap((c) => c.targets.flatMap((t) => t.properties))
    .filter((p) => (p.status === "ACTIVE" || p.status === "RENEWED") && shDaysFromToday(p.expiryDate) <= 30);
  const nearestExpiry = expiringProps.length ? Math.min(...expiringProps.map((p) => shDaysFromToday(p.expiryDate))) : null;

  const waiting: WaitingItem[] = [
    ...sealContracts
      .filter((s) => s.status === "PENDING")
      .map((s) => ({ key: `seal-${s.id}`, title: `用印申请 · ${s.documentTitle}`, meta: `${s.code} · ${formatMonthDay(s.createdAt)} 提交`, onOpen: () => setView("seal") })),
    ...(latestArchive?.status === "PENDING_REVIEW" ? [{ key: "archive", title: `归档申请 · ${latestArchive.archiveNo}`, meta: `提交人 ${latestArchive.archivedBy} · 等待归档审核` }] : [])
  ];
  const money = (n: number | null | undefined) => (n != null && n > 0 ? `¥${n.toLocaleString("zh-CN")}` : null);

  return (
    <DocActionsContext.Provider value={docActions}>
    <div className="mo-matter mo-dossier">
      {/* ① 案卷头 */}
      <div className="mb-2"><MatterListBack listQuery={searchParams.get("list")} /></div>
      <section className="dos-head dossier-identity" aria-label="案卷头">
        <div className="dos-head-top">
          <div className="min-w-0 flex-1">
            <div className="dos-eyebrow">
              <span className="code">{matter.internalCode}</span>
              {matter.firmCaseNo ? <span className="code">所内 {matter.firmCaseNo}</span> : null}
              <span>{[matterCategoryLabel[matter.category], matter.cause?.name ?? matter.causeFreeText].filter(Boolean).join(" · ")}</span>
            </div>
            <h1 ref={matterHeading} tabIndex={-1} className="ctx-title dos-title">{matter.title}</h1>
            <div className="dos-sides">
              {categoryKind === "litigation" ? (
                <>
                  <span className="k">委托方</span>
                  <span className="v">{ours.map((p) => p.name).join("、") || matter.primaryClient?.name || "—"}</span>
                  <span className="k">{matter.category === "CRIMINAL" ? "办案机关" : "对方"}</span>
                  <span className="v">{matter.category === "CRIMINAL" ? engagedProcedures.find(p => p.handlingAgency)?.handlingAgency || "—" : opposing.map((p) => p.name).join("、") || "—"}</span>
                </>
              ) : (
                <>
                  <span className="k">委托人</span>
                  <span className="v">{matter.primaryClient?.name ?? matter.clientLinks[0]?.client.name ?? "—"}</span>
                  <span className="k">{categoryKind === "counsel" ? "顾问期限" : "服务期间"}</span>
                  <span className="v mono">{[matter.serviceStart ? formatShortDate(matter.serviceStart) : null, matter.serviceEnd ? formatShortDate(matter.serviceEnd) : null].filter(Boolean).join(" — ") || "—"}</span>
                </>
              )}
            </div>
            <div className="ctx-badges">
              {overdueCount > 0 ? <SemiTag size="small" color="red">{overdueCount} 项逾期</SemiTag> : null}
              {nearestExpiry !== null ? <SemiTag size="small" color="amber">保全 {nearestExpiry < 0 ? "已过期" : `${nearestExpiry} 天后到期`}</SemiTag> : null}
              {money(matter.claimAmount) ? <SemiTag size="small" color="grey">{categoryKind === "litigation" ? "标的" : "金额"} <span className="mono">{money(matter.claimAmount)}</span></SemiTag> : null}
              {matter.intakeDate ? <SemiTag size="small" color="grey">收案 <span className="mono">{formatShortDate(matter.intakeDate)}</span></SemiTag> : null}
              {archiveBadge && !isArchived ? (
                <SemiTag size="small" color={archiveBadge.color}>
                  <Archive aria-hidden size="small" />
                  {archiveBadge.text}
                </SemiTag>
              ) : null}
              {restricted ? <SemiTag size="small" color="grey"><span title="受限事项不进入团队汇总视图">受限事项</span></SemiTag> : null}
            </div>
          </div>
          <div className="dos-head-aside">
            <div className="ctx-actions" role="group" aria-label="案件操作">
              {canWriteRecords ? (
                <SemiButton htmlType="button" theme="solid" icon={<Plus aria-hidden />} onClick={() => setProgress({
                  mode: "record",
                  stage: workflowApi.current?.currentStageName ?? undefined,
                  stageNames: workflowApi.current?.stageNames ?? []
                })}>记录办案进展</SemiButton>
              ) : null}
              {canOpenUnifiedEditor ? (
                <SemiButton htmlType="button" theme="outline" type="tertiary" icon={<Pencil aria-hidden />}
                  onClick={event => openMatterEditor("matter", event.currentTarget)}>编辑案件与团队</SemiButton>
              ) : null}
              <LifecycleActions
                matterId={matter.id}
                status={matter.status}
                canArchive={canLeadThisMatter && allowed("archive.submit")}
                canChangeStatus={Boolean(currentUserRole && canLeadThisMatter)}
                canExportBundle={currentUserRole !== "FINANCE" && allowed("matters.export") && allowed("matters.read") && allowed("finance.read") && allowed("documents.download")}
              />
            </div>
            <div className="dos-head-status">
              <span>案件状态</span>
              <SemiTag size="large" color={statusTagColor(matterStatusTone(matter.status))}>
                {isArchived ? "已归档（只读）" : matterStatusLabel[matter.status]}
              </SemiTag>
            </div>
          </div>
        </div>
      </section>

      {/* 吸顶摘要：标题滚出视野后常驻案件身份与下一节点 */}
      <MatterStickyBar title={matter.title} procedures={engagedProcedures} />

      {latestArchive && latestArchive.status !== "APPROVED" ? (
        <div style={{ margin: "14px 0 0" }}>
          <ArchiveStatusBanner
            record={latestArchive}
            onReArchive={latestArchive.status === "REJECTED" && canLeadThisMatter ? () => setArchiveOpen(true) : undefined}
          />
        </div>
      ) : null}

      {invalidProcedure && (view === "archive" || view === "work" && (workPane === "materials" || workPane === "tasks")) ? <p role="alert" className="mt-3 text-sm text-destructive">指定程序不可用。<SemiButton theme="borderless" type="primary" size="small" htmlType="button" className="ml-2" onClick={() => updateDossierLocation({ procedure: null, stage: null, task: null, deadline: null })}>重新选择程序</SemiButton></p> : null}

      {/* ③ 页签 */}
      <ProcedureWorkflowPanel
        workBoard={workBoard}
        apiRef={workflowApi}
        matter={{ id: matter.id, internalCode: matter.internalCode, title: matter.title, category: matter.category }}
        procedure={currentProcedure}
        documents={procDocs}
        folders={materials?.folders ?? []}
        templates={materials?.templates ?? []}
        materialStatus={materialStatus}
        users={colleagues}
        canManage={canAssociateThisMatter && !isArchived}
        canWriteRecords={canWriteRecords}
        currentUserId={currentUserId}
        canWriteTasks={canWriteSchedule}
        canWriteMaterials={canWriteMaterials}
        canReadSchedule={allowed("schedule.read")}
        allProcedures={engagedProcedures}
        invalidProcedure={invalidProcedure}
        notes={notes}
        timelineEvents={matter.timelineEvents}
        onWriteNote={({ judgment, stageName }) => setProgress({ mode: judgment ? "judgment" : "record", stage: stageName, stageNames: workflowApi.current?.stageNames ?? [] })}
        onEditNote={note => setProgress({ mode: note.tags.includes("研判笔记") ? "judgment" : "record", note, stageNames: workflowApi.current?.stageNames ?? [] })}
        view={view}
        onViewChange={setView}
        viewCounts={{ seal: sealContracts.filter((sc) => sc.status === "PENDING").length }}
        waiting={waiting}
        archiveNode={<>
          <div className="card dos-facts">
            <MatterBriefSection
              matterId={matter.id}
              refreshKey={materialRefreshKey}
              onOpenTask={task => updateDossierLocation({ view: "work", workPane: "tasks", procedure: null, stage: null, task, deadline: null })}
              getProcedureLabel={id => { const procedure = engagedProcedures.find(item => item.id === id); return procedure ? procLabel(procedure) : undefined; }}
              onOpenDeadline={openDossierDeadline}
              onCreateTask={canWriteSchedule && allowed("schedule.read") ? () => workflowApi.current?.openAddTask() : undefined}
            />
          </div>
          <section className="card dossier-procedure-register" aria-labelledby="dossier-procedure-heading">
            <header className="dossier-section-heading">
              <h2 id="dossier-procedure-heading">程序档案 <span className="dossier-count">{engagedProcedures.length}</span></h2>
              <div className="flex items-center gap-2">
                {engagedProcedures.length > 0 ? <SemiButton htmlType="button" theme="borderless" disabled={!currentProcedure} onClick={() => setSelectedProcId(null)}>查看全案档案</SemiButton> : null}
                {canWriteSchedule ? <SemiButton htmlType="button" theme="outline" icon={<Plus aria-hidden />} onClick={() => setAddProcOpen(true)}>新增程序</SemiButton> : null}
              </div>
            </header>
            {engagedProcedures.length === 0 ? <p className="px-5 py-5 text-sm text-muted-foreground">本事项暂无程序。</p> :
              <List dataSource={engagedProcedures} renderItem={(procedure: ProcedureItem) => {
                const label = procLabel(procedure);
                return <List.Item key={procedure.id}>
                  <div className="flex w-full flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <SemiButton htmlType="button" theme={currentProcedure?.id === procedure.id ? "light" : "borderless"} aria-pressed={currentProcedure?.id === procedure.id}
                          onClick={() => setSelectedProcId(procedure.id)}>{label}</SemiButton>
                        <SemiTag color={procedure.status === "IN_PROGRESS" ? "teal" : "grey"}>{procedureStateLabel(procedure)}</SemiTag>
                        {procedure.engagement === "INFORMATIONAL" ? <SemiTag color="grey">仅信息</SemiTag> : null}
                      </div>
                      {procedure.caseNumber || procedure.handlingAgency ? <p className="break-words text-sm text-muted-foreground">
                        {[procedure.caseNumber, procedure.handlingAgency].filter(Boolean).join(" · ")}
                      </p> : null}
                    </div>
                    {canWriteSchedule ? <div className="flex flex-wrap items-center gap-2">
                      <ProcedureStatusActions procedure={procedure} label={label} />
                      {canLeadThisMatter ? <SemiButton htmlType="button" theme="borderless" type="tertiary" aria-label={`删除程序 ${label}`}
                        onClick={async () => {
                          if (await confirmDialog({ title: `删除程序「${label}」？`, description: deleteProcedureWarning(procedure, label).replace(/^确定删除程序「[^」]*」？\s*/, ""), confirmText: "删除程序", danger: true })) handleDeleteProcedure(procedure.id);
                        }}>删除</SemiButton> : null}
                    </div> : null}
                  </div>
                </List.Item>;
              }} />}
          </section>
          {!invalidProcedure && !currentProcedure && (preservationCases.length > 0 || canAssociateThisMatter) ? <MatterPreservationContent matter={{ id: matter.id, internalCode: matter.internalCode, title: matter.title, category: matter.category }} cases={preservationCases} users={colleagues} canManage={canAssociateThisMatter && !isArchived} /> : null}
          <MatterArchive
            matter={matter}
            contextNode={contextNode}
            currentProcedure={currentProcedure}
            parties={parties}
            canReadFinance={allowed("finance.read")}
            onOpenFinance={() => setView("money")}
            customFieldDefs={customFieldDefs}
            customValues={customValues}
            canEdit={canEditMatterInfo}
            canEditProcedure={canAssociateThisMatter && Boolean(currentProcedure)}
            canEditCustom={canLeadThisMatter}
            canManageRelated={canAssociateThisMatter && !isArchived}
            onEdit={openMatterEditor}
          />
          {closureNode}
        </>}
        archiveRailTop={<><TeamRailCard matter={matter} canManage={canOwnThisMatter} onManage={() => openMatterEditor("team")} />{conflictNode}</>}
        expresses={expresses}
        onAddLedger={canAssociateThisMatter && currentProcedure ? (type) => setLedgerAdd(type) : undefined}
        factsNode={<FactsWorkspace matterId={matter.id} items={evidenceItems} error={evidenceError} canAdd={canAddEvidence}
          onAdd={() => setEvidenceDocId(null)} onRetry={() => router.refresh()} onOpenDocument={openDocument} onDraftStateChange={researchDraft} />}
        deliveryNode={<DeliveryPanel matterId={matter.id} initialDeliveryId={searchParams.get("delivery")} initialEventId={searchParams.get("deliveryEvent")}
          initialDocumentId={searchParams.get("deliveryDocument")} prepareSignal={deliveryPrepareSignal} onLocationChange={deliveryLocation} onDocumentOpen={openDocument} onDraftStateChange={deliveryDraft} />}
        materialsActions={<>
          {evidenceError ? <p role="alert" className="text-sm text-destructive">证据要点读取失败：{evidenceError} <SemiButton theme="borderless" type="primary" size="small" htmlType="button" onClick={() => router.refresh()}>重新加载</SemiButton></p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canReadMaterials && materials ? <MaterialToolsSheet
              key={`${matter.id}:${currentProcedure?.id ?? "unassigned"}`}
              matterId={matter.id}
              documents={procDocs.map(document => ({ id: document.id, name: document.name, version: document.version }))}
              scopeLabel={currentProcedure ? `${procLabel(currentProcedure)} · 全部环节` : "当前事项材料"}
              canManage={canAssociateThisMatter && !isArchived && allowed("documents.write")}
              refreshKey={materialRefreshKey}
            /> : null}
          </div>
          {canAssociateThisMatter && allowed("documents.write") ? <PendingMaterialUploads key={matter.id} matterId={matter.id} /> : null}
        </>}
        materialsExtra={materials?.reviewSummary && canReadMaterials ? <ReviewSummaryCard summary={materials.reviewSummary} matterId={matter.id} /> : null}
        onCaseSearch={capabilities.caseSearch && allowed("matters.write") ? () => setCaseSearchOpen(true) : undefined}
        financeNode={
          <section className="dos-main dossier-finance" aria-label="委托与财务">
            {!canReadFinance ? <p role="status" className="text-sm text-muted-foreground">当前角色无权读取财务。</p>
              : !finance ? <DetailSectionStatus label="财务" {...financeSection} />
              : <>
                <FinanceHero stats={finance.stats} action={
                  <Link href={`/finance/reconciliation?${new URLSearchParams({ matterId: matter.id, returnTo: matterReturnTo })}`} className="workspace-action-link">应收与收款分配</Link>
                } />
                <FinancePanel matterId={matter.id} finance={finance} userOptions={userOptions} canRequestInvoice={canAssociateThisMatter} hideStats />
                {finance.intakeFees ? (
                  <SemiCard title="收案收费约定">
                    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      {([
                        ["收费方式", finance.intakeFees.feeType && feeTypeLabel[finance.intakeFees.feeType]],
                        [finance.intakeFees.feeType === "CONTINGENCY" ? "基础办案费" : "约定收费", money(finance.intakeFees.feeAmount)],
                        ["付款节点", finance.intakeFees.feeSchedule],
                        ["风险收费", finance.intakeFees.contingencyTerms],
                        ["收费说明", finance.intakeFees.feeNote],
                      ] as const).filter(([, value]) => value?.trim()).map(([label, value]) => (
                        <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap">{value}</dd></div>
                      ))}
                    </dl>
                  </SemiCard>
                ) : null}
                <BillingsCard
                  contractTotal={finance.stats.contractAmount}
                  matterId={matter.id}
                  billings={finance.billings}
                  contractDocuments={finance.contractDocuments}
                  canManage={canAssociateThisMatter && !isArchived}
                />
              </>}
          </section>
        }
        sealNode={
          <ApprovalsPanel matterId={matter.id} matterTitle={matter.title} sealContracts={sealContracts} canRequest={canAssociateThisMatter && allowed("seals.request")} returnTo={matterReturnTo} />
        }
      />

      <WorkspaceDialog open={caseSearchOpen} onOpenChange={setCaseSearchOpen}>
        <DrawerContent side="right" className="w-screen overflow-y-auto p-0 sm:max-w-[760px]">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>类案检索 · {matter.title}</DialogTitle>
          </DialogHeader>
          <div className="p-5">
            {caseSearchOpen ? <CaseSearchPanel providers={{ yuandian: capabilities.yuandian ?? false, localJudgments: capabilities.localJudgments ?? false }} matterId={matter.id} matterCategory={matter.category} defaultCauseName={matter.cause?.name ?? matter.causeFreeText ?? null} /> : null}
          </div>
        </DrawerContent>
      </WorkspaceDialog>
      {currentProcedure && ledgerAdd ? (
        <ImportantItemDialog
          open={Boolean(ledgerAdd)}
          onOpenChange={(o) => { if (!o) setLedgerAdd(null); }}
          matterId={matter.id}
          defaultType={ledgerAdd}
          types={ledgerAdd === "express" ? ["express"] : ["hearing", "deadline"]}
          procedures={engagedProcedures.map((p) => ({ id: p.id, label: procLabel(p) }))}
          defaultProcedureId={currentProcedure.id}
          hearingCounts={Object.fromEntries(engagedProcedures.map((p) => [p.id, p.hearings.length]))}
          proceduresDetail={Object.fromEntries(engagedProcedures.map((p) => [p.id, { handlingAgency: p.handlingAgency, panel: p.panel, jurisdiction: p.jurisdiction }]))}
        />
      ) : null}
      {evidenceDocId !== undefined && canReadMaterials && !materials ? (
        <WorkspaceDialog open onOpenChange={open => { if (!open) setEvidenceDocId(undefined); }}>
          <DrawerContent>
            <DialogHeader><DialogTitle>新增证据要点</DialogTitle></DialogHeader>
            <DetailSectionStatus label="材料选项" {...materialsSection} />
          </DrawerContent>
        </WorkspaceDialog>
      ) : evidenceDocId !== undefined ? (
        <EvidenceItemDialog
          open
          onOpenChange={(o) => { if (!o) setEvidenceDocId(undefined); }}
          matterId={matter.id}
          documents={documents.map(({ id, name }) => ({ id, name }))}
          defaultDocumentId={evidenceDocId}
        />
      ) : null}
      {displayDocumentId && <DocumentDetail key={`${matter.id}:${displayDocumentId}`} matterId={matter.id} documentId={displayDocumentId} issueId={displayReviewIssue}
        onClose={() => leaveDocument(null)} onDocumentChange={leaveDocument} onIssueChange={selectReviewIssue} onPrepareDelivery={id => void prepareDocumentDelivery(id)} onDraftStateChange={documentDraft} />}
      <DocumentReviewDialog open={Boolean(reviewDocId)} documentId={reviewDocId} matterId={matter.id}
        canStartReview={Boolean(capabilities.aiReview && canAssociateThisMatter && !isArchived && allowed("documents.write"))}
        canSaveReport={Boolean(canAssociateThisMatter && !isArchived && allowed("documents.write"))}
        onOpenChange={(o) => { if (!o) setReviewDocId(null); }} />

      {progress ? (
        <ProgressDialog
          key={progress.note?.id ?? "new"}
          open={Boolean(progress)}
          onOpenChange={(o) => !o && setProgress(null)}
          matterId={matter.id}
          initialMode={progress.mode}
          initialStage={progress.stage}
          stageNames={progress.stageNames}
          note={progress.note}
          canWrite={canWriteRecords && (!progress.note || progress.note.author.id === currentUserId)}
        />
      ) : null}
      {currentProcedure && deadlineOpen ? (
        <AddDeadlineDialog
          open={deadlineOpen}
          onOpenChange={setDeadlineOpen}
          procedures={engagedProcedures.map((p) => ({ id: p.id, label: procLabel(p) }))}
          defaultProcedureId={currentProcedure.id}
        />
      ) : null}
      {currentProcedure && hearingOpen ? (
        <AddHearingDialog
          open={hearingOpen}
          onOpenChange={setHearingOpen}
          procedures={engagedProcedures.map((p) => ({ id: p.id, label: procLabel(p) }))}
          defaultProcedureId={currentProcedure.id}
          hearingCounts={Object.fromEntries(engagedProcedures.map((p) => [p.id, p.hearings.length]))}
          proceduresDetail={Object.fromEntries(engagedProcedures.map((p) => [p.id, { handlingAgency: p.handlingAgency, panel: p.panel, jurisdiction: p.jurisdiction }]))}
        />
      ) : null}

      {canWriteSchedule && (
        <AddProcedureSheet
          open={addProcOpen}
          onOpenChange={setAddProcOpen}
          matterId={matter.id}
          category={matter.category}
          nextOrder={matter.procedures.length + 1}
          colleagues={colleagues}
          onCreated={id => { updateDossierLocation({ procedure: id, stage: null, task: null, view: "work", workPane: "materials" }); router.refresh(); }}
        />
      )}
      {canOpenUnifiedEditor && (
        <TeamEditorDialog
          open={matterEditorOpen}
          onOpenChange={setMatterEditorOpen}
          initialSection={matterEditorSection}
          onReturnFocus={() => {
            if (matterEditorTrigger.current?.isConnected) matterEditorTrigger.current.focus({ preventScroll: true });
            else matterHeading.current?.focus({ preventScroll: true });
          }}
          matterId={matter.id}
          matterMeta={{
            updatedAt: matter.updatedAt,
            intakeDate: matter.intakeDate ?? null,
            category: matter.category,
            title: matter.title,
            causeId: matter.causeId ?? null,
            causeFreeText: matter.causeFreeText ?? null,
            claimAmount:
              matter.claimAmount === null || matter.claimAmount === undefined
                ? null
                : Number(matter.claimAmount),
            ourStanding: matter.ourStanding ?? null,
            teamAccessRestricted: restricted
          }}
          currentProcedure={currentProcedure}
          parties={procedureParties.map(party => ({ ...party, updatedAt: party.id.startsWith("client:") ? null : party.updatedAt }))}
          currentOwnerId={matter.ownerId}
          currentMembers={matter.members.map((m) => ({
            userId: m.userId,
            role: m.role,
            name: m.user.name
          }))}
          userOptions={userOptions}
          canEditMatterInfo={canEditMatterInfo}
          canManageTeam={canOwnThisMatter}
          canManageProcedure={Boolean(currentProcedure && canAssociateThisMatter)}
        />
      )}
      {canLeadThisMatter && allowed("archive.submit") && (
        <ArchiveWizardDialog
          matterId={matter.id}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
        />
      )}
    </div>
    </DocActionsContext.Provider>
  );
}

type ProcedureItem = MatterPayload["procedures"][number];

/**
 * 删除程序的确认文案。
 *
 * 原文案是「该程序下的所有开庭、期限、备忘和材料记录将被一并删除」——两个问题：
 * 1. 笼统。人对「所有相关记录」会习惯性点确定，对「3 条期限」会停手。
 * 2. 不准确。材料（Document）的外键是 SetNull，只会丢失程序关联，本身不删。
 *
 * 级联硬删的实际范围（schema onDelete: Cascade）：Deadline / Hearing /
 * MatterStage（含其下 Task 的关联）/ ProcedureMemo。
 */
function deleteProcedureWarning(procedure: ProcedureItem, label: string): string {
  const parts: string[] = [];
  if (procedure.deadlines.length > 0) parts.push(`${procedure.deadlines.length} 条期限`);
  if (procedure.hearings.length > 0) parts.push(`${procedure.hearings.length} 场开庭`);
  if (procedure.stages.length > 0) parts.push(`${procedure.stages.length} 个环节`);
  if (procedure.memos.length > 0) parts.push(`${procedure.memos.length} 条备忘`);

  if (parts.length === 0) {
    return `确定删除程序「${label}」？该程序下暂无期限、开庭、环节和备忘记录。`;
  }
  return (
    `确定删除程序「${label}」？\n\n` +
    `该程序下的 ${parts.join("、")} 将被一并删除，此操作不可撤销。\n` +
    `（材料不会被删除，仅解除与本程序的关联。）`
  );
}



/**
 * 合同与补充协议：一案一签（2026-09-16 用户确认取消独立委托模块）。
 * 中途变更收费、增加代理程序＝新增一条补充协议，原合同保留，合同额自动合计。
 */
function BillingsCard({ matterId, billings, contractDocuments, canManage, contractTotal }: { matterId: string; billings: FinancePayload["billings"]; contractDocuments: FinancePayload["contractDocuments"]; canManage: boolean; contractTotal: number }) {
  const [addOpen, setAddOpen] = useState(false);
  const total = contractTotal;
  return (
    <section className="card">
      <div className="panel-head">
        <div className="panel-title">
          <FileSignature aria-hidden className="ic" />
          合同与补充协议
          <SemiTag size="small" color="grey" style={{ marginLeft: 2 }}>{billings.length}</SemiTag>
        </div>
        {canManage ? (
          <SemiButton htmlType="button" theme="outline" type="tertiary" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden />
            合同 / 补充协议
          </SemiButton>
        ) : null}
      </div>
      {billings.length === 0 ? (
        <div className="panel-body t-xs t-mute">尚未登记合同金额</div>
      ) : (
        <>
          {billings.map((b) => (
            <div key={b.id} className="dos-bill row">
              <span className="t">{b.title}</span>
              <SemiTag size="small" color={b.status === "ACTIVE" ? "teal" : b.status === "CLOSED" ? "grey" : "grey"}>
                {b.status === "ACTIVE" ? "执行中" : b.status === "CLOSED" ? "已结束" : "草稿"}
              </SemiTag>
              <span className="v mono">¥{Number(b.contractAmount).toLocaleString("zh-CN")}</span>
              <span className="m">{[b.signedAt ? `${formatShortDate(b.signedAt)} 签署` : null, b.schedule].filter(Boolean).join(" · ")}</span>
            </div>
          ))}
          <div className="panel-foot flex items-center justify-between">
            <span className="t-xs t-mute">已签署律师费合同额</span>
            <span className="font-mono text-[14px] font-semibold">¥{total.toLocaleString("zh-CN")}</span>
          </div>
        </>
      )}
      {contractDocuments.length > 0 ? (
        <div className="panel-body space-y-2">
          <h3 className="text-sm font-medium">合同扫描件</h3>
          <ul className="space-y-1">
            {contractDocuments.map(document => (
              <li key={document.id}><a className="underline" href={`/api/documents/${document.id}/download`} target="_blank" rel="noreferrer">{document.name}</a> <span className="text-muted-foreground">{formatShortDate(document.createdAt)}</span></li>
            ))}
          </ul>
        </div>
      ) : null}
      {canManage ? <AddBillingSheet open={addOpen} onOpenChange={setAddOpen} matterId={matterId} /> : null}
    </section>
  );
}

/** 委托与财务：收费概览（大号数字 + 回款进度） */
function FinanceHero({ stats, action }: { stats: FinancePayload["stats"]; action: React.ReactNode }) {
  const outstanding = stats.outstanding;
  const base = stats.receivable;
  const received = base > 0 ? Math.min(100, Math.round((stats.allocated / base) * 100)) : 0;
  const pending = base > 0 ? Math.min(100 - received, Math.round((outstanding / base) * 100)) : 0;
  const money = (n: number) => (n > 0 ? `¥${n.toLocaleString("zh-CN")}` : "—");
  const cells: [string, number, string][] = [
    ["合同额", stats.contractAmount, ""],
    ["已收", stats.received, "green"],
    ["待收", outstanding, "amber"],
    ["已开票", stats.invoiced, "blue"],
    ...(stats.pendingReceived > 0 ? [["待确认实收", stats.pendingReceived, "amber"] as [string, number, string]] : []),
    ...(stats.cost > 0 ? [["支出", stats.cost, "red"] as [string, number, string]] : [])
  ];
  return (
    <section className="card dos-fin-hero" aria-labelledby="dossier-finance-heading">
      <header className="dossier-section-heading">
        <h2 id="dossier-finance-heading">收费概览</h2>
        {action}
      </header>
      <dl className="dos-fin-cells">
        {cells.map(([k, v, tone]) => (
          <div key={k} className={cn("dos-fin-cell", tone)}>
            <dt className="k">{k}</dt>
            <dd className="v">{money(v)}</dd>
          </div>
        ))}
      </dl>
      {base > 0 ? (
        <div className="dos-fin-bar">
          <div className="track" aria-hidden>
            <i className="got" style={{ width: `${received}%` }} />
            <i className="due" style={{ width: `${pending}%` }} />
          </div>
          <div className="legend">
            <span><b className="dot got" />回款 {received}%</span>
            <span><b className="dot due" />待收 {pending}%</span>
            <span className="t-mute">按有效应收核销计算</span>
          </div>
        </div>
      ) : (
        <p className="t-xs t-mute" style={{ margin: "10px 0 0" }}>尚无有效应收，暂不计算核销进度</p>
      )}
    </section>
  );
}

function nextUncompletedDeadline(procedures: ProcedureItem[]) {
  const all = procedures
    .flatMap((procedure) => procedure.deadlines)
    .filter((deadline) => !deadline.completed)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  return all.find((deadline) => !deadlineOverdue(deadline.dueAt, deadline.duePrecision)) ?? all[0] ?? null;
}

function nextUpcomingHearing(procedures: ProcedureItem[]) {
  return (
    procedures
      .flatMap((procedure) => procedure.hearings)
      .filter((hearing) => new Date(hearing.startsAt).getTime() >= Date.now() - 2 * 3600_000)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null
  );
}

function MatterStickyBar({
  title,
  procedures
}: {
  title: string;
  procedures: ProcedureItem[];
}) {
  // 标题区自带期限/开庭卡片；摘要条只在标题滚出视野后以 fixed 形式出现，
  // 页首不占位也不重复（sticky 放在零高容器里不会生效，故用 fixed + 测宽）
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      setRect({ left: box.left, width: box.width });
    };
    measure();
    window.addEventListener("resize", measure);
    // topbar 高 48px，滚过标题底部（即本容器位置）后出现
    const onScroll = () => {
      setPinned(el.getBoundingClientRect().top < 60);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const deadline = nextUncompletedDeadline(procedures);
  const hearing = nextUpcomingHearing(procedures);
  const days = deadline ? daysFromToday(deadline.dueAt) : null;
  const deadlineTone =
    days === null ? "" : days < 0 || days <= 3 ? "text-[var(--semi-color-danger)]" : days <= 7 ? "text-[var(--semi-color-warning)]" : "text-[var(--semi-color-text-2)]";
  const deadlineText =
    deadline ? deadlineRelative(deadline.dueAt, deadline.duePrecision) : "";

  return (
    <div ref={wrapRef} className="h-0 w-full" aria-hidden={!pinned}>
      {pinned && rect && (
        <div className="fixed top-[58px] z-10" style={{ left: rect.left, width: rect.width }}>
          <div className="flex items-center gap-2.5 rounded-[10px] border border-[var(--semi-color-border)] bg-[var(--bg-glass)] px-3 py-1.5 shadow-[var(--sh-hover)] backdrop-blur-xl">
            <span className="min-w-0 truncate text-sm font-semibold" title={title}>
              {title}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2 text-xs" aria-label="全案节点">
              <SemiTag size="small" color="grey">全案</SemiTag>
              {deadline ? (
                <span className={cn("inline-flex items-center gap-1", deadlineTone)}>
                  <Clock3 aria-hidden size="small" />
                  <span className="max-w-[160px] truncate">{deadline.title}</span>
                  <span className="font-mono tabular">
                    {formatDeadlineDue(deadline.dueAt, deadline.duePrecision)} · {deadlineText}
                  </span>
                </span>
              ) : (
                <span className="hidden text-muted-foreground sm:inline">无未完成期限</span>
              )}
              {hearing && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Gavel aria-hidden size="small" />
                  <span className="font-mono tabular">
                    开庭 {formatMonthDay(hearing.startsAt)}{" "}
                    {shTime(hearing.startsAt)}
                  </span>
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function daysFromToday(date: Date) {
  return shDaysFromToday(date);
}

function formatShortDate(date: Date) {
  return shDayKey(date);
}

function formatMonthDay(date: Date) {
  return shMonthDay(date);
}


function clientTypeToPartyType(type: ClientType) {
  if (type === "INDIVIDUAL") return "NATURAL_PERSON";
  if (type === "COMPANY") return "COMPANY";
  return "OTHER_ORG";
}

function buildProcedurePartyOptions(matter: MatterPayload) {
  const parties = [...matter.parties];
  const seenClientNames = new Set(
    parties.filter((party) => party.role === "CLIENT_PARTY").map((party) => party.name.trim())
  );
  const clients = [
    ...(matter.primaryClient ? [matter.primaryClient] : []),
    ...matter.clientLinks.map((link) => link.client)
  ];
  const seenClientIds = new Set<string>();

  for (const client of clients) {
    if (seenClientIds.has(client.id) || seenClientNames.has(client.name.trim())) continue;
    seenClientIds.add(client.id);
    parties.push({
      id: `client:${client.id}`,
      matterId: matter.id,
      intakeId: null,
      role: "CLIENT_PARTY",
      standing: null,
      ordinal: 0,
      name: client.name,
      partyType: clientTypeToPartyType(client.type),
      idType: null,
      idNumber: client.type === "INDIVIDUAL" ? client.idNumber : null,
      phone: null,
      address: null,
      legalRep: null,
      contactName: null,
      enterpriseId: null,
      enterpriseSocialCode: client.type === "INDIVIDUAL" ? null : client.idNumber,
      enterpriseName: client.type === "INDIVIDUAL" ? null : client.name,
      enterpriseBoundAt: null,
      notes: "案件关联客户",
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  return parties;
}

export type { MatterPayload, UserOption };
