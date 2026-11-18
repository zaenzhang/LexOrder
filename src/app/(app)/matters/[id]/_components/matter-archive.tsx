"use client";

import { Tag as SemiTag } from "@/components/patterns/semi-surfaces";
import { Button as SemiButton, Collapse } from "@douyinfe/semi-ui";

/**
 * 案卷工作台「案件档案」页签（默认首屏，docs/UI-MATTER-DOSSIER-PLAN.md 第二版）：
 * 基本信息 → 当事人完整卡片 → 本程序信息 → 委托与收费 → 承办团队 → 自定义字段。
 */
import Link from "next/link";
import { IconEdit as Pencil, IconUserGroup as Users } from "@douyinfe/semi-icons";
import { FieldGrid, FieldItem, InitialAvatar } from "@/components/patterns/workspace-surfaces";
import { avatarTone } from "@/lib/ui/status-tones";
import { litigationStandingLabel, matterCategoryKind, matterCategoryLabel, partyTypeLabel, procedureTypeLabel } from "@/lib/enums";
import { clientIdTypeLabel } from "@/lib/clients/person-id";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { RelatedMattersField } from "./related-matters-field";
import { ARBITRATION_TYPES, PROCEDURE_OUTCOME_LABEL, contactRoleLabels } from "./info-panel";
import { CustomFieldsPanel } from "./custom-fields-panel";
import type { MatterPayload } from "./matter-detail-tabs";

type Procedure = MatterPayload["procedures"][number];
type PartyRow = Omit<MatterPayload["parties"][number], "updatedAt"> & { updatedAt: Date | null };

const ROLE_LABEL: Record<string, string> = {
  CLIENT_PARTY: "委托方",
  OPPOSING_PARTY: "对方当事人",
  THIRD_PARTY: "第三人",
  CO_LITIGANT: "共同诉讼人",
  AGENT: "代理人",
  WITNESS: "证人",
  OTHER: "其他参与人"
};

const dash = (v: string | null | undefined) => v?.trim() || null;

const CLAIMANT_STANDINGS = ["PLAINTIFF", "JOINT_PLAINTIFF", "APPELLANT", "RETRIAL_APPLICANT", "ENFORCEMENT_APPLICANT", "ARBITRATION_CLAIMANT", "ADMIN_RECONSIDERATION_APPLICANT", "ADMIN_PLAINTIFF"];
const RESPONDENT_STANDINGS = ["DEFENDANT", "JOINT_DEFENDANT", "APPELLEE", "RETRIAL_RESPONDENT", "EXECUTED_PERSON", "ARBITRATION_RESPONDENT", "ADMIN_RECONSIDERATION_RESPONDENT", "ADMIN_DEFENDANT"];

/** 诉讼地位配色（沿用 v1.3.2）：申请方青、被申请方橙、第三人紫、其他绿、未设置灰 */
function standingTone(standing: string | null) {
  if (!standing) return "slate";
  if (CLAIMANT_STANDINGS.includes(standing)) return "teal";
  if (RESPONDENT_STANDINGS.includes(standing)) return "amber";
  if (standing === "THIRD_PARTY") return "violet";
  return "green";
}

/**
 * 当事人紧凑卡片（沿用 v1.3.2 ProcedurePartyBlock 形式，2026-09-14 用户要求）：
 * 头像 + 名称 + 主体类型 / 证件 / 法定代表人标签，第二行联系人、电话、地址，右侧诉讼地位。
 */
function PartyBlock({ party, standings, clientHref }: { party: PartyRow; standings: string[]; clientHref: string | null }) {
  const isOrg = party.partyType !== "NATURAL_PERSON";
  const idValue = isOrg ? party.enterpriseSocialCode : party.idNumber;
  const idLabel = isOrg ? "信用代码" : party.idType && party.idType !== "ID_CARD" ? clientIdTypeLabel[party.idType] : "身份证";
  const primary = standings[0] ?? null;
  const contact = [
    party.contactName ? `联系人：${party.contactName}` : "",
    party.phone ? `电话：${party.phone}` : "",
    party.address ? `地址：${party.address}` : ""
  ].filter(Boolean);
  return (
    <div className={cn("dos-pb", `line-${standingTone(primary)}`)} title={[party.name, ...contact, party.notes ? `备注：${party.notes}` : ""].filter(Boolean).join("\n")}>
      <span className={cn("dos-pb-av", `tone-${standingTone(primary)}`)}>{party.name.trim().charAt(0) || "—"}</span>
      <div className="min-w-0 flex-1">
        <div className="dos-pb-top">
          <span className="dos-pb-name">{party.name || "—"}</span>
          <span className="dos-pb-chip">{partyTypeLabel[party.partyType]}</span>
          {!standings.some((st) => litigationStandingLabel[st as keyof typeof litigationStandingLabel] === ROLE_LABEL[party.role]) ? <span className="dos-pb-chip">{ROLE_LABEL[party.role] ?? "当事人"}</span> : null}
          {idValue ? (
            <span className="dos-pb-chip">
              <span className="k">{idLabel}</span>
              <span className="min-w-0 truncate font-mono tabular-nums">{idValue}</span>
            </span>
          ) : null}
          {isOrg && party.legalRep ? (
            <span className="dos-pb-chip">
              <span className="k">法定代表人</span>
              <span className="min-w-0 truncate">{party.legalRep}</span>
            </span>
          ) : null}
          {!isOrg || !party.enterpriseName || party.enterpriseName === party.name ? null : (
            <span className="dos-pb-chip">
              <span className="k">工商登记</span>
              <span className="min-w-0 truncate">{party.enterpriseName}</span>
            </span>
          )}
          {clientHref ? (
            <Link href={clientHref} className="link-inline text-xs">
              客户档案
            </Link>
          ) : null}
        </div>
        <div className="dos-pb-sub">{contact.length ? contact.join(" · ") : "暂无联系人、电话或地址"}</div>
        {party.notes?.trim() ? <div className="dos-pb-sub">备注：{party.notes}</div> : null}
      </div>
      <div className="dos-pb-standing">
        {standings.length ? (
          standings.map((s) => (
            <span key={s} className={cn("dos-pb-st", `tone-${standingTone(s)}`)}>
              {litigationStandingLabel[s as keyof typeof litigationStandingLabel] ?? s}
            </span>
          ))
        ) : (
          <span className="dos-pb-st tone-slate">未设置地位</span>
        )}
      </div>
    </div>
  );
}

export function MatterArchive({
  matter,
  currentProcedure,
  parties,
  canReadFinance,
  onOpenFinance,
  customFieldDefs,
  customValues,
  canEdit,
  canEditProcedure,
  canEditCustom,
  canManageRelated,
  contextNode,
  onEdit
}: {
  matter: MatterPayload;
  currentProcedure: Procedure | null;
  parties: PartyRow[];
  /** 合同与补充协议（Billing）；一案一签，追加收费＝新增一条补充协议 */
  /** 委托代理合同等合同类材料 */
  canReadFinance: boolean;
  onOpenFinance: () => void;
  customFieldDefs: React.ComponentProps<typeof CustomFieldsPanel>["defs"];
  customValues: Record<string, string>;
  canEdit: boolean;
  canEditProcedure: boolean;
  canEditCustom: boolean;
  canManageRelated: boolean;
  contextNode?: React.ReactNode;
  onEdit: (section: "matter" | "procedure" | "parties") => void;
}) {
  const kind = matterCategoryKind(matter.category);
  const isCriminal = matter.category === "CRIMINAL";
  const isArbitration = Boolean(currentProcedure && ARBITRATION_TYPES.includes(currentProcedure.type));
  const contactLabels = contactRoleLabels(currentProcedure?.type);
  const related = [
    ...matter.linksFrom.map((l) => ({ ...l.relatedMatter, relation: l.relation })),
    ...matter.linksTo.map((l) => ({ ...l.matter, relation: l.relation }))
  ].filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);
  const money = (v: number | null | undefined) => (v != null && v > 0 ? formatCurrency(v) : null);
  const standing = currentProcedure?.ourStanding ?? matter.ourStanding;
  const outcome = currentProcedure?.outcomeNote?.trim() || (currentProcedure?.outcome ? PROCEDURE_OUTCOME_LABEL[currentProcedure.outcome] : "");
  const procLabel = currentProcedure ? currentProcedure.customLabel ?? procedureTypeLabel[currentProcedure.type] : null;
  const editButton = (section: "matter" | "procedure" | "parties", label: string) => (
    <SemiButton htmlType="button" theme="borderless" type="tertiary" onClick={() => onEdit(section)}>
      <Pencil aria-hidden />
      {label}
    </SemiButton>
  );

  // 本程序诉讼地位：一个当事人在同一程序可有多个地位（如被告兼反诉原告）
  const normalize = (st: string) => (st === "JOINT_PLAINTIFF" ? "PLAINTIFF" : st === "JOINT_DEFENDANT" ? "DEFENDANT" : st);
  const standingsOf = (party: PartyRow) => {
    const rows = currentProcedure?.procedureParties.filter((pp) => pp.partyId === party.id).sort((a, b) => a.ordinal - b.ordinal).map((pp) => normalize(pp.standing)) ?? [];
    if (rows.length) return [...new Set(rows)];
    return party.standing ? [normalize(party.standing)] : [];
  };

  const ours = parties.filter((p) => p.role === "CLIENT_PARTY" || p.role === "CO_LITIGANT").sort((a, b) => a.ordinal - b.ordinal);
  const opposing = parties.filter((p) => p.role === "OPPOSING_PARTY").sort((a, b) => a.ordinal - b.ordinal);
  const others = parties.filter((p) => !ours.includes(p) && !opposing.includes(p)).sort((a, b) => a.ordinal - b.ordinal);
  const partyCard = (p: PartyRow) => (
    <PartyBlock key={p.id} party={p} standings={standingsOf(p)} clientHref={p.id.startsWith("client:") ? `/clients/${p.id.slice(7)}` : null} />
  );

  return (
    <>
      {contextNode ? <div className="card dossier-context-card">{contextNode}</div> : null}
      <section className="card dossier-records-card" aria-labelledby="dossier-records-heading">
        <header className="dossier-section-heading">
          <h2 id="dossier-records-heading">案卷资料</h2>
          {canReadFinance ? <SemiButton htmlType="button" theme="borderless" type="tertiary" onClick={onOpenFinance}>查看委托与财务</SemiButton> : null}
        </header>
        <Collapse className="dossier-file-folders" defaultActiveKey={[]} expandIconPosition="right" motion={false}>
          <Collapse.Panel itemKey="parties" header={
            <span className="dossier-folder-label">当事人 <span>{parties.length ? `${parties.length} 方` : "未登记"}</span></span>
          }>
            {currentProcedure && canEditProcedure ? <div className="dossier-folder-actions">{editButton("parties", "编辑当事人")}</div> : null}
        <div className="dos-vs-body">
          <div className="dos-vs-side">
            <div className="dos-vs-h ours">我方</div>
            {ours.length ? ours.map(partyCard) : <p className="t-xs t-mute">未登记</p>}
          </div>
          <div className="dos-vs-side">
            <div className="dos-vs-h">{isCriminal ? "办案机关" : "对方"}</div>
            {opposing.length ? (
              opposing.map(partyCard)
            ) : isCriminal ? (
              <p className="t-xs t-mute">{dash(currentProcedure?.handlingAgency) ?? "未登记"}</p>
            ) : (
              <p className="t-xs t-mute">未登记</p>
            )}
          </div>
        </div>
        {others.length ? (
          <div className="dos-vs-others">
            <div className="dos-vs-h">第三人及其他参与人</div>
            <div className="dos-party-list">{others.map(partyCard)}</div>
          </div>
        ) : null}
          </Collapse.Panel>

          <Collapse.Panel itemKey="request" header={
            <span className="dossier-folder-label">{isCriminal ? "指控与请求" : kind === "litigation" ? "案由与请求" : "服务内容"}
              <span>{matter.cause?.name || matter.causeFreeText || matterCategoryLabel[matter.category]}</span>
            </span>
          }>
            {canEdit ? <div className="dossier-folder-actions">{editButton("matter", "编辑案件信息")}</div> : null}
            <FieldGrid cols={2} className="dossier-property-grid">
              <FieldItem label="案件类别">{matterCategoryLabel[matter.category]}</FieldItem>
              <FieldItem label={isCriminal ? "涉嫌罪名" : kind === "litigation" ? "案由" : kind === "counsel" ? "顾问类型" : "业务类型"}>
                {kind === "litigation" ? dash(matter.cause?.name ?? matter.causeFreeText) : dash(kind === "counsel" ? matter.counselType : matter.businessType)}
              </FieldItem>
              {kind === "litigation" ? (
                <>
                  {!isCriminal ? <FieldItem label="标的额" mono>{money(matter.claimAmount)}</FieldItem> : null}
                  <FieldItem label="我方地位">{standing ? litigationStandingLabel[standing] : null}</FieldItem>
                  {!isCriminal && matter.category !== "ADMINISTRATIVE" ? (
                    <FieldItem label={isArbitration ? "是否提出反请求" : "是否反诉"}>{matter.intake ? (matter.intake.counterclaim ? "是" : "否") : null}</FieldItem>
                  ) : null}
                  <FieldItem label="律协备案">{matter.barFiling && matter.barFiling !== "NONE" ? "已备案" : "未备案"}</FieldItem>
                  {!isCriminal ? (
                    <FieldItem label={isArbitration ? "仲裁请求" : "诉讼请求"} wide>
                      {matter.intake?.claimDescription?.trim() ? <span className="whitespace-pre-wrap">{matter.intake.claimDescription}</span> : null}
                    </FieldItem>
                  ) : null}
                </>
              ) : (
                <>
                  <FieldItem label={kind === "counsel" ? "顾问期限" : "服务期间"} mono>
                    {matter.serviceStart || matter.serviceEnd ? `${matter.serviceStart ? formatDate(matter.serviceStart) : "—"} ~ ${matter.serviceEnd ? formatDate(matter.serviceEnd) : "—"}` : null}
                  </FieldItem>
                  {kind === "project" ? <FieldItem label="项目金额" mono>{money(matter.claimAmount)}</FieldItem> : null}
                  <FieldItem label="服务范围" wide>{matter.serviceScope?.trim() ? <span className="whitespace-pre-wrap">{matter.serviceScope}</span> : null}</FieldItem>
                  {kind === "project" ? <FieldItem label="交付成果" wide>{dash(matter.deliverables)}</FieldItem> : null}
                </>
              )}
            </FieldGrid>
          </Collapse.Panel>

          {kind === "litigation" && currentProcedure ? (
            <Collapse.Panel itemKey="jurisdiction" header={
              <span className="dossier-folder-label">管辖与承办 <span>{currentProcedure.handlingAgency || procLabel}</span></span>
            }>
              {canEditProcedure ? <div className="dossier-folder-actions">{editButton("procedure", "编辑程序信息")}</div> : null}
              <FieldGrid cols={2} className="dossier-property-grid">
                <FieldItem label="案号" mono>{dash(currentProcedure.caseNumber)}</FieldItem>
                <FieldItem label={isArbitration ? "仲裁机构" : isCriminal ? "办案机关" : "受理机构"}>{dash(currentProcedure.handlingAgency)}</FieldItem>
                <FieldItem label="管辖地">{dash(currentProcedure.jurisdiction)}</FieldItem>
                <FieldItem label={isArbitration ? "受理时间" : "立案时间"} mono>{currentProcedure.acceptedAt ? formatDate(currentProcedure.acceptedAt) : null}</FieldItem>
                <FieldItem label={contactLabels.lead}>
                  {currentProcedure.presidingJudge?.trim() ? (
                    <span>
                      {currentProcedure.presidingJudge}
                      {currentProcedure.presidingJudgeContact ? <span className="ml-2 font-mono text-xs font-normal text-[var(--semi-color-text-1)]">{currentProcedure.presidingJudgeContact}</span> : null}
                    </span>
                  ) : null}
                </FieldItem>
                <FieldItem label={contactLabels.assistant}>
                  {currentProcedure.judgeAssistant?.trim() ? (
                    <span>
                      {currentProcedure.judgeAssistant}
                      {currentProcedure.judgeAssistantContact ? <span className="ml-2 font-mono text-xs font-normal text-[var(--semi-color-text-1)]">{currentProcedure.judgeAssistantContact}</span> : null}
                    </span>
                  ) : null}
                </FieldItem>
                {currentProcedure.panel?.trim() ? <FieldItem label={isArbitration ? "仲裁庭" : "合议庭"} wide>{currentProcedure.panel}</FieldItem> : null}
                {currentProcedure.concludedAt || outcome ? (
                  <>
                    <FieldItem label="结案时间" mono>{currentProcedure.concludedAt ? formatDate(currentProcedure.concludedAt) : null}</FieldItem>
                    <FieldItem label={isCriminal ? "处理结果" : "裁判结果"} grow>{outcome || null}</FieldItem>
                  </>
                ) : null}
              </FieldGrid>
            </Collapse.Panel>
          ) : null}

          <Collapse.Panel itemKey="intake" header={
            <span className="dossier-folder-label">收案与登记
              <span>{matter.intakeDate ? formatDate(matter.intakeDate) : "未登记日期"}</span>
            </span>
          }>
            {customFieldDefs.length > 0 && canEditCustom ? <div className="dossier-folder-actions">
              <CustomFieldsPanel matterId={matter.id} defs={customFieldDefs} values={customValues} canEdit editOnly />
            </div> : null}
            <FieldGrid cols={2} className="dossier-property-grid">
              <FieldItem label="收案日期" mono>{matter.intakeDate ? formatDate(matter.intakeDate) : null}</FieldItem>
              <FieldItem label="登记人">{dash([matter.intake?.receivedAt ? formatDate(matter.intake.receivedAt) : null, matter.intake?.createdBy?.name].filter(Boolean).join(" · "))}</FieldItem>
              <FieldItem label="联系人">{dash([matter.intake?.contactName, matter.intake?.contactPhone].filter(Boolean).join(" · "))}</FieldItem>
              {matter.intake?.description?.trim() ? (
                <FieldItem label="事实摘要" wide>
                  <span className="whitespace-pre-wrap">{matter.intake.description}</span>
                </FieldItem>
              ) : null}
              {customFieldDefs.map((def) => (
                <FieldItem key={def.id} label={def.label} mono={def.fieldType === "NUMBER" || def.fieldType === "DATE"}>
                  {customValues[def.key]?.trim() ? customValues[def.key] : null}
                </FieldItem>
              ))}
              <FieldItem label="关联案件" wide>
                <RelatedMattersField matterId={matter.id} related={related} canManage={canManageRelated} />
              </FieldItem>
            </FieldGrid>
          </Collapse.Panel>
        </Collapse>
      </section>
    </>
  );
}

/** 案件档案侧栏：承办团队 */
export function TeamRailCard({ matter, canManage, onManage }: { matter: MatterPayload; canManage: boolean; onManage: () => void }) {
  const order = { LEAD: 0, CO_LEAD: 1, ASSISTANT: 2 } as const;
  const members = [
    ...(matter.owner && !matter.members.some((m) => m.userId === matter.ownerId) ? [{ id: matter.owner.id, name: matter.owner.name, role: "LEAD" as const, roleName: (matter.owner as { roleName?: string }).roleName }] : []),
    ...matter.members.map((m) => ({ id: m.userId, name: m.user.name, role: m.role, roleName: m.user.roleName }))
  ].sort((a, b) => order[a.role] - order[b.role]);
  return (
    <div className="card">
      <div className="rail-sec-head">
        <Users aria-hidden className="h-[15px] w-[15px] text-[var(--semi-color-text-2)]" />
        承办团队
        {canManage ? (
          <SemiButton theme="borderless" type="primary" size="small" htmlType="button" onClick={onManage}>
            管理承办团队
          </SemiButton>
        ) : null}
      </div>
      {members.length === 0 ? (
        <div className="panel-body t-xs t-mute">暂无团队成员</div>
      ) : (
        members.map((m) => (
          <div key={`${m.id}-${m.role}`} className="member">
            <InitialAvatar name={m.name} tone={avatarTone(m.name)} />
            <div className="min-w-0">
              <div className="n truncate">{m.name}</div>
              <div className="r truncate">{m.roleName ?? "—"}</div>
            </div>
            <SemiTag size="small" color={m.role === "LEAD" ? "teal" : "grey"} className="role-tag">
              {m.role === "LEAD" ? "主办" : m.role === "CO_LEAD" ? "协办" : "助理"}
            </SemiTag>
          </div>
        ))
      )}
      {(matter as { teamAccessRestricted?: boolean }).teamAccessRestricted ? (
        <div className="panel-body" style={{ padding: "8px 14px" }}>
          <span className="t-xs t-mute">受限事项：不进入团队汇总视图</span>
        </div>
      ) : null}
    </div>
  );
}
