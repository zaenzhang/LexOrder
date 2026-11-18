"use client";

import { useId } from "react";
import { Tabs, Select, Button, Input, TextArea } from "@douyinfe/semi-ui";
import { shDayKey } from "@/lib/ui/sh-time";
import { queryAccessLabels, queryOutcomeLabels, sourceRelationLabels, lawKindLabels, researchIssueSelectionKey, type ResearchContent, type ResearchOptions, type ResearchQuery, type ResearchRevisionView, type ResearchSourceInput } from "@/server/research/contracts";
import { ResearchSourceEditor } from "./research-source-editor";
import { ResearchSavedCasePicker } from "./research-saved-case-picker";

export function ResearchEditor({ matterId, value, onChange, options, disabled, readOnly, saved, onOpenSource, onPreviewSource, onRefreshIssues }: {
  matterId: string;
  value: ResearchContent; onChange(value: ResearchContent): void; options: ResearchOptions | null; disabled: boolean;
  readOnly: boolean; saved: ResearchRevisionView | null; onOpenSource(id: string): void; onPreviewSource(source: ResearchSourceInput): void;
  onRefreshIssues(): void;
}) {
  const selectLabelId = useId();
  function update(patch: Partial<ResearchContent>) { onChange({ ...value, ...patch }); }
  const textarea = (key: "purpose" | "scope" | "rule" | "exceptions" | "supportingAnalysis" | "opposingAnalysis" | "conclusion" | "unresolved" | "nextSteps", label: string, rows = 4) =>
    <div className="space-y-1.5"><label htmlFor={`research-${key}`} className="text-sm font-medium text-[var(--semi-color-text-1)]">{label}</label><TextArea id={`research-${key}`} rows={rows} readOnly={readOnly} disabled={disabled} value={value[key]} onChange={inputValue => update({ [key]: inputValue })} /></div>;
  function updateQuery(index: number, patch: Partial<ResearchQuery>) { update({ queryLog: value.queryLog.map((row, i) => i === index ? { ...row, ...patch } : row) }); }
  function querySourceLabel(documentId: string) {
    const fixed = saved?.sources.find(source => source.documentId === documentId);
    if (fixed) return `${fixed.documentName} · V${fixed.version}`;
    const option = options?.documents.find(document => document.id === documentId);
    return option ? `${option.name} · V${option.version}` : "已选具体来源";
  }
  return <Tabs defaultActiveKey="question" className="space-y-4" tabPaneMotion={false}>

    <Tabs.TabPane itemKey="question" tab="问题与范围" className="space-y-4">
      <div className="space-y-1.5"><label htmlFor="research-question" className="text-sm font-medium text-[var(--semi-color-text-1)]">研究问题</label><Input id="research-question" value={value.question} onChange={inputValue => update({ question: inputValue })} maxLength={300} readOnly={readOnly} disabled={disabled} /></div>
      {readOnly ? saved?.issue ? <details className="text-sm space-y-2"><summary className="cursor-pointer">关联争点：{saved.issue.title} · 修订 {saved.issue.revision}{saved.issue.changed ? "（争点已有新修订）" : saved.issue.confirmationChanged ? "（核对状态已有变化）" : ""}</summary>
        <p className="whitespace-pre-wrap break-words">{saved.issue.content}</p><p className="text-xs text-muted-foreground">采用时：{saved.issue.confirmedAt ? `已核对（${shDayKey(saved.issue.confirmedAt)}）` : "尚未核对"} · 输入固定于 {shDayKey(saved.issue.capturedAt)}</p>
        {saved.issue.sources.map(source => <div key={source.id} className="flex items-center justify-between gap-3 rounded-md border p-2"><span>{source.documentName} · V{source.documentVersion} · {source.locationLabel}</span><Button disabled={disabled} onClick={() => onOpenSource(source.id)} htmlType="button" type="tertiary" theme="outline" size="small">查看争点来源</Button></div>)}
      </details> : null : <div className="space-y-1.5"><div className="flex items-center justify-between gap-3"><label className="text-sm font-medium text-[var(--semi-color-text-1)]">关联争点</label><Button disabled={disabled} onClick={onRefreshIssues} htmlType="button" type="tertiary" theme="borderless" size="small">更新争点选项</Button></div>
        <> <span className="sr-only" id={selectLabelId + "-1"}>{"关联争点"}</span><Select
          disabled={disabled || !options}
          value={researchIssueSelectionKey(value.issueSelection)}
          onChange={key => { if (typeof key !== "string") return;
          if (key === "none") { update({ issueSelection: null }); return; }
          const issue = options?.issues.find(item => researchIssueSelectionKey(item.selection) === key);
          if (issue) update({ issueSelection: issue.selection });
        }}
          aria-labelledby={selectLabelId + "-1"}
          placeholder="不关联争点"
          className="w-full"
          motion={false}><Select.Option value="none">不关联争点</Select.Option>{value.issueSelection && !options?.issues.some(issue => researchIssueSelectionKey(issue.selection) === researchIssueSelectionKey(value.issueSelection)) ? <Select.Option value={researchIssueSelectionKey(value.issueSelection)} disabled={value.issueSelection.kind === "CURRENT"}>{value.issueSelection.kind === "CURRENT" ? "所选争点已变化，请重新选择" : "保留原研究的争点输入"}</Select.Option> : null}{options?.issues.map(issue => <Select.Option key={researchIssueSelectionKey(issue.selection)} value={researchIssueSelectionKey(issue.selection)}>{issue.title} · 修订 {issue.revision} · {issue.selection.confirmedAt ? "已核对" : "待核对"}</Select.Option>)}</Select></>
      </div>}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5"><label htmlFor="research-jurisdiction" className="text-sm font-medium text-[var(--semi-color-text-1)]">法域</label><Input id="research-jurisdiction" placeholder={readOnly ? "待核实" : "未知可留空"} value={value.jurisdiction} readOnly={readOnly} disabled={disabled} onChange={inputValue => update({ jurisdiction: inputValue })} /></div>
        <div className="space-y-1.5"><label htmlFor="research-relevant-date" className="text-sm font-medium text-[var(--semi-color-text-1)]">事实相关日期</label><Input id="research-relevant-date" type="date" value={value.relevantDate} readOnly={readOnly} disabled={disabled} onChange={inputValue => update({ relevantDate: inputValue })} /></div>
        <div className="space-y-1.5"><label htmlFor="research-date" className="text-sm font-medium text-[var(--semi-color-text-1)]">研究日期</label><Input id="research-date" type="date" value={shDayKey(value.researchedAt)} readOnly={readOnly} disabled={disabled} onChange={inputValue => { if (inputValue) update({ researchedAt: new Date(`${inputValue}T00:00:00+08:00`).toISOString() }); }} /></div>
      </div>
      {textarea("purpose", "用途与受众", 2)}
      {textarea("scope", "范围、时限与资料限制", 3)}
    </Tabs.TabPane>
    <Tabs.TabPane itemKey="sources" tab="依据与阅读" className="space-y-6">
      <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h3 className="font-medium text-sm">选入原文</h3>
        {!readOnly && options ? <ResearchSavedCasePicker key={matterId} matterId={matterId} options={options} value={value} onChange={onChange} disabled={disabled} /> : null}
      </div>
        {readOnly ? saved?.sources.length ? saved.sources.map(source => <div key={source.id} className="rounded-md border p-3 space-y-1.5">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium break-words">{source.documentName} · V{source.version}</p><p className="text-xs text-muted-foreground">{sourceRelationLabels[source.relation]} · {source.locationLabel}{source.changed ? " · 已有新版本，当前研究仍采用此版" : ""}</p></div>
            <Button onClick={() => onOpenSource(source.id)} disabled={disabled} type="tertiary" theme="outline" size="small">查看原文</Button></div>
          {source.lawMetadata.kind !== "MATERIAL" ? <p className="text-sm">{lawKindLabels[source.lawMetadata.kind]} · {source.lawMetadata.jurisdiction || "法域待核实"} · {source.lawMetadata.title || "法源名称未记录"} · {source.lawMetadata.verification === "CHECKED" ? "身份及时点已核实" : "待核实"}</p> : null}
          <details><summary className="text-xs cursor-pointer text-muted-foreground">来源详情</summary><dl className="mt-2 text-sm grid grid-cols-[8rem_1fr] gap-2">
            <dt>机关 / 编号</dt><dd>{source.lawMetadata.authority || "未记录"} / {source.lawMetadata.number || "未记录"}</dd>
            <dt>效力期间</dt><dd>{source.lawMetadata.effectiveFrom || "起日未知"} 至 {source.lawMetadata.effectiveTo || "结束日未知"}</dd>
            <dt>取得时间 / 途径</dt><dd>{source.lawMetadata.acquiredOn || "未记录"} / {source.lawMetadata.acquiredVia || "未记录"}</dd>
            <dt>使用范围</dt><dd className="whitespace-pre-wrap break-words">{source.lawMetadata.usageScope || "待核实"}</dd>
          </dl></details>
        </div>) : <p className="text-sm text-muted-foreground">尚未选入原文。链接与摘要见下方查询记录。</p> : <ResearchSourceEditor matterId={matterId} value={value.sources} documents={options?.documents ?? []} disabled={disabled || !options} onChange={sources => update({ sources })} onPreview={onPreviewSource} />}
      </section>
      <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium text-sm">查询与阅读记录</h3>{!readOnly ? <Button disabled={disabled || value.queryLog.length >= 40} onClick={() => update({ queryLog: [...value.queryLog, { query: "", location: "", access: "NONE", outcome: "NOT_OBTAINED", notes: "" }] })} type="tertiary" theme="outline" size="small">添加记录</Button> : null}</div>
        {value.queryLog.map((query, index) => <div key={index} className="rounded-md border p-3 space-y-3">
          {query.sourceDocumentId ? <p className={`text-xs ${value.sources.some(source => source.documentId === query.sourceDocumentId) ? "text-muted-foreground" : "text-destructive"}`}>
            {value.sources.some(source => source.documentId === query.sourceDocumentId)
              ? `采用的固定材料：${querySourceLabel(query.sourceDocumentId)}`
              : "此查询采用的材料已移出来源，请保留对应来源或移除此查询记录"}
          </p> : null}
          <div className="space-y-1.5"><label htmlFor={`query-${index}`} className="text-sm font-medium text-[var(--semi-color-text-1)]">查询词或阅读范围</label><Input id={`query-${index}`} value={query.query} disabled={disabled} readOnly={readOnly} onChange={inputValue => updateQuery(index, { query: inputValue })} /></div>
          <div className="grid grid-cols-[1fr_9rem_11rem] gap-3">
            <div className="space-y-1.5"><label htmlFor={`query-location-${index}`} className="text-sm font-medium text-[var(--semi-color-text-1)]">来源位置或链接</label><Input id={`query-location-${index}`} value={query.location} disabled={disabled} readOnly={readOnly} onChange={inputValue => updateQuery(index, { location: inputValue })} /></div>
            <div className="space-y-1.5"><label id={selectLabelId + "-2" + "-" + index} className="text-sm font-medium text-[var(--semi-color-text-1)]">取得范围</label><Select value={query.access} disabled={disabled || readOnly} onChange={access => { if (typeof access === "string") updateQuery(index, { access: access as ResearchQuery["access"] }); }} aria-labelledby={selectLabelId + "-2" + "-" + index} className="w-full" motion={false}>{Object.entries(queryAccessLabels).map(([key, label]) => <Select.Option key={key} value={key}>{label}</Select.Option>)}</Select></div>
            <div className="space-y-1.5"><label id={selectLabelId + "-3" + "-" + index} className="text-sm font-medium text-[var(--semi-color-text-1)]">实际结果</label><Select value={query.outcome} disabled={disabled || readOnly} onChange={outcome => { if (typeof outcome === "string") updateQuery(index, { outcome: outcome as ResearchQuery["outcome"] }); }} aria-labelledby={selectLabelId + "-3" + "-" + index} className="w-full" motion={false}>{Object.entries(queryOutcomeLabels).map(([key, label]) => <Select.Option key={key} value={key}>{label}</Select.Option>)}</Select></div>
          </div>
          <div className="space-y-1.5"><label htmlFor={`query-notes-${index}`} className="text-sm font-medium text-[var(--semi-color-text-1)]">发现、限制或失败原因</label><TextArea id={`query-notes-${index}`} rows={2} value={query.notes} readOnly={readOnly} disabled={disabled} onChange={inputValue => updateQuery(index, { notes: inputValue })} /></div>
          {!readOnly ? <Button disabled={disabled} onClick={() => update({ queryLog: value.queryLog.filter((_, i) => i !== index) })} type="tertiary" theme="borderless" size="small">移除此记录</Button> : null}
        </div>)}
      </section>
    </Tabs.TabPane>
    <Tabs.TabPane itemKey="analysis" tab="论证与结论" className="space-y-4">
      {textarea("rule", "规则与法律前提")}{textarea("exceptions", "例外与适用条件", 3)}
      <div className="grid grid-cols-2 gap-4">{textarea("supportingAnalysis", "支持论证", 6)}{textarea("opposingAnalysis", "反向论证与可能反驳", 6)}</div>
      {textarea("conclusion", "结论与成立条件")}{textarea("unresolved", "未决与材料缺口", 3)}{textarea("nextSteps", "下一步", 3)}
    </Tabs.TabPane>
  </Tabs>;
}
