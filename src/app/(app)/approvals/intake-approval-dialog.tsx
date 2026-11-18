"use client";

import { Tag as SemiTag } from "@/components/patterns/semi-surfaces";
import { Button, Checkbox, TextArea } from "@douyinfe/semi-ui";
import { useEffect, useState, type ReactNode } from "react";
import { IconTick as Check, IconPaperclip as Paperclip } from "@douyinfe/semi-icons";
import { APPROVAL_STATUS_LABELS } from "@/lib/approvals/workspace";
import type { getApprovalDetail } from "@/server/approval-permissions/inbox";
import {
  ReviewAlert,
  ReviewDialogContent,
  ReviewEmpty,
  ReviewFileRow,
  ReviewHistory,
  ReviewStatusLine,
  ReviewSummaryItem
} from "@/components/patterns/review-dialog";
import { IntakeApprovalContent } from "./intake-approval-content";
import { formatDateTime } from "@/lib/utils";

type Detail = Awaited<ReturnType<typeof getApprovalDetail>>;
type Props = {
  detail: Detail;
  intakeDetail: NonNullable<Detail["intakeDetail"]>;
  note: string;
  onNoteChange: (value: string) => void;
  pending: boolean;
  onDecision: (decision: "approve" | "reject" | "revision") => void;
  onResubmit: () => void;
  returnControl?: ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
};
const dateText = (date: Date | string | null) => date ? formatDateTime(date) : "未记录";

/** 墨案 07：收案审批宽幅审阅 */
export function IntakeApprovalDialog({ detail, intakeDetail, note, onNoteChange, pending, onDecision, onResubmit, returnControl, onDirtyChange }: Props) {
  const [tab, setTab] = useState("overview");
  const [checkedMaterials, setCheckedMaterials] = useState(false);
  const [checkedConvert, setCheckedConvert] = useState(false);
  useEffect(() => { onDirtyChange?.(checkedMaterials || checkedConvert); return () => onDirtyChange?.(false); }, [checkedMaterials, checkedConvert, onDirtyChange]);
  const fields = intakeDetail.sections.flatMap(section => section.fields);
  const value = (label: string) => fields.find(field => field.label === label)?.value ?? "未填写";
  const latest = intakeDetail.checks[0];
  const hitCount = latest?.hits.length ?? 0;
  const blocking = latest?.hits.filter(h => h.severity === "BLOCKING").length ?? 0;
  const riskTitle = !latest ? "尚未检索，请核查利益冲突" : !latest.coversCurrentParties ? "检索范围待补充，请核查当前当事人" : blocking ? `冲突命中 BLOCKING × ${blocking} 待结论` : hitCount ? `检索命中 ${hitCount} 条，待人工核查` : null;
  const feeLabel = fields.some(field => field.label === "基础办案费（元）") ? "基础办案费（元）" : "收费金额（元）";
  const waited = detail.submittedAt ? Math.max(0, Math.floor((Date.now() - new Date(detail.submittedAt).getTime()) / 86_400_000)) : null;
  const coLead = value("共同承办律师");

  return (
    <ReviewDialogContent
      title={detail.title}
      eyebrow="收案审批"
      status={<SemiTag size="small" color={detail.task ? "amber" : detail.status === "REJECTED" ? "red" : "green"}>{APPROVAL_STATUS_LABELS[detail.status] ?? "状态待核实"}</SemiTag>}
      description={<><span>申请人 {detail.requester}</span><span>· {detail.submittedAt ? `提交于 ${dateText(detail.submittedAt)}` : "提交时间未记录"}</span>{detail.task && waited !== null ? <span>· 已等待 {waited} 天</span> : null}{returnControl}</>}
      summary={<>
        <ReviewSummaryItem k="案件类别" v={[value("案件类别"), value("首个程序 / 审级")].filter(v => v !== "未填写").join(" · ") || "未填写"} />
        <ReviewSummaryItem k="委托方" v={value("委托方") !== "未填写" ? value("委托方") : value("姓名 / 名称")} />
        <ReviewSummaryItem k="标的额" v={value("标的金额（元）")} mono />
        <ReviewSummaryItem k={feeLabel.replace("（元）", "")} v={value(feeLabel)} mono />
        <ReviewSummaryItem k="承办" v={`${value("主办律师")}（主办）${coLead !== "未填写" ? ` · ${coLead}（协办）` : ""}`} />
      </>}
      alert={riskTitle ? <ReviewAlert>首屏风险：{riskTitle}</ReviewAlert> : null}
      onAlertClick={() => setTab("conflicts")}
      tab={tab}
      onTabChange={setTab}
      tabs={[
        { id: "overview", label: "申请资料", content: <IntakeApprovalContent detail={intakeDetail} view="overview" onOpenConflicts={() => setTab("conflicts")} /> },
        { id: "conflicts", label: "冲突核查", count: hitCount, countTone: "red", content: <IntakeApprovalContent detail={intakeDetail} view="conflicts" /> },
        { id: "attachments", label: "附件", count: detail.attachments.length, content: detail.attachments.length ? <div className="rv-section"><div className="rv-sec-head"><Paperclip aria-hidden className="h-[14px] w-[14px] text-[var(--semi-color-primary)]" />申请附件</div>{detail.attachments.map(file => <ReviewFileRow key={file.id} id={file.id} name={file.name} readable={file.readable} />)}</div> : <ReviewEmpty icon={<Paperclip aria-hidden />} title="申请人尚未上传附件" desc="可结合申请资料判断是否需要退回补充。" /> },
        { id: "history", label: "处理记录", count: detail.history.length, content: <ReviewHistory items={detail.history} emptyText={detail.status === "PENDING" ? "尚无处理记录" : "此记录未保存逐次处理历史"} emptyDesc={detail.status === "PENDING" ? "处理后将在这里显示审批意见与结果。" : "当前结果见申请状态。"} /> }
      ]}
      sidebarTitle={detail.task ? "审批" : "申请进度"}
      sidebar={detail.task ? <>
        <ReviewStatusLine tone="amber" title="等待你的审批" desc={`你有本事项的收案审批授权${waited !== null ? ` · 已等待 ${waited} 天` : ""}`} />
        <label htmlFor="intake-approval-note" className="op-label">审批意见</label>
        <TextArea id="intake-approval-note" aria-label="审批意见或驳回原因" placeholder="请记录核查意见；驳回或退回补正时必填" value={note} onChange={event => onNoteChange(event)} maxLength={500} disabled={pending} />
        <div className="t-xs t-faint mt-1 text-right font-mono">{note.length} / 500</div>
        <Checkbox checked={checkedMaterials} onChange={e => setCheckedMaterials(e.target.checked === true)} disabled={pending} className="my-3">

          <span>已核对申请资料与附件（{detail.attachments.length} 件），冲突检索结论为<b>「{latest?.conclusion ?? "尚未核查"}」</b>。</span>
        </Checkbox>
        <Checkbox checked={checkedConvert} onChange={e => setCheckedConvert(e.target.checked === true)} disabled={pending} className="my-3">

          <span>同意按申请登记当事人、收费与承办团队转入正式案件。</span>
        </Checkbox>
        <div className="side-note" style={{ marginTop: 16 }}><span>系统检索供核查参考，最终判断及理由由审批人确认。审批结果与意见同事务写入审计日志，处理后不可重复审批。</span></div>
      </> : <>
        <ReviewStatusLine tone={detail.status === "REJECTED" ? "red" : "slate"} title={APPROVAL_STATUS_LABELS[detail.status] ?? "状态待核实"} desc={detail.canResubmit ? "补充完善申请资料后，可重新提交审批。" : "当前为只读查阅；后续进度会继续记录在此申请中。"} />
      </>}
      footer={detail.task ? <>
        <Button htmlType="button"  disabled={pending} onClick={() => onDecision("reject")} theme="solid" type="danger">驳回</Button>
        <Button htmlType="button"  disabled={pending} onClick={() => onDecision("revision")} theme="outline" type="tertiary">退回补正</Button>
        <Button htmlType="button"  disabled={pending || !checkedMaterials || !checkedConvert} title={!checkedMaterials || !checkedConvert ? "请先勾选核对确认项" : undefined} onClick={() => onDecision("approve")} theme="solid" type="primary"><Check aria-hidden />{pending ? "处理中…" : "审批通过"}</Button>
      </> : detail.canResubmit ? <Button htmlType="button"  disabled={pending} onClick={onResubmit} theme="solid" type="primary">重新提交审批</Button> : undefined}
    />
  );
}
