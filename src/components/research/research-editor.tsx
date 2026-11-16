"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { shDayKey } from "@/lib/ui/sh-time";
import { queryAccessLabels, queryOutcomeLabels, sourceRelationLabels, lawKindLabels, researchIssueSelectionKey, type ResearchContent, type ResearchOptions, type ResearchQuery, type ResearchRevisionView, type ResearchSourceInput } from "@/server/research/contracts";
import { ResearchSourceEditor } from "./research-source-editor";

export function ResearchEditor({ value, onChange, options, disabled, readOnly, saved, onOpenSource, onPreviewSource, onRefreshIssues }: {
  value: ResearchContent; onChange(value: ResearchContent): void; options: ResearchOptions | null; disabled: boolean;
  readOnly: boolean; saved: ResearchRevisionView | null; onOpenSource(id: string): void; onPreviewSource(source: ResearchSourceInput): void;
  onRefreshIssues(): void;
}) {
  function update(patch: Partial<ResearchContent>) { onChange({ ...value, ...patch }); }
  const textarea = (key: "purpose" | "scope" | "rule" | "exceptions" | "supportingAnalysis" | "opposingAnalysis" | "conclusion" | "unresolved" | "nextSteps", label: string, rows = 4) =>
    <div className="space-y-1.5"><Label htmlFor={`research-${key}`}>{label}</Label><Textarea id={`research-${key}`} rows={rows} readOnly={readOnly} disabled={disabled} value={value[key]} onChange={event => update({ [key]: event.target.value })} /></div>;
  function updateQuery(index: number, patch: Partial<ResearchQuery>) { update({ queryLog: value.queryLog.map((row, i) => i === index ? { ...row, ...patch } : row) }); }
  return <Tabs defaultValue="question" className="space-y-4">
    <TabsList><TabsTrigger value="question">问题与范围</TabsTrigger><TabsTrigger value="sources">依据与阅读</TabsTrigger><TabsTrigger value="analysis">论证与结论</TabsTrigger></TabsList>
    <TabsContent value="question" className="space-y-4">
      <div className="space-y-1.5"><Label htmlFor="research-question">研究问题</Label><Input id="research-question" value={value.question} onChange={event => update({ question: event.target.value })} maxLength={300} readOnly={readOnly} disabled={disabled} /></div>
      {readOnly ? saved?.issue ? <details className="text-sm space-y-2"><summary className="cursor-pointer">关联争点：{saved.issue.title} · 修订 {saved.issue.revision}{saved.issue.changed ? "（争点已有新修订）" : saved.issue.confirmationChanged ? "（核对状态已有变化）" : ""}</summary>
        <p className="whitespace-pre-wrap break-words">{saved.issue.content}</p><p className="text-xs text-muted-foreground">采用时：{saved.issue.confirmedAt ? `已核对（${shDayKey(saved.issue.confirmedAt)}）` : "尚未核对"} · 输入固定于 {shDayKey(saved.issue.capturedAt)}</p>
        {saved.issue.sources.map(source => <div key={source.id} className="flex items-center justify-between gap-3 rounded-md border p-2"><span>{source.documentName} · V{source.documentVersion} · {source.locationLabel}</span><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onOpenSource(source.id)}>查看争点来源</Button></div>)}
      </details> : null : <div className="space-y-1.5"><div className="flex items-center justify-between gap-3"><Label>关联争点</Label><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onRefreshIssues}>更新争点选项</Button></div>
        <Select disabled={disabled || !options} value={researchIssueSelectionKey(value.issueSelection)} onValueChange={key => {
          if (key === "none") { update({ issueSelection: null }); return; }
          const issue = options?.issues.find(item => researchIssueSelectionKey(item.selection) === key);
          if (issue) update({ issueSelection: issue.selection });
        }}><SelectTrigger aria-label="关联争点"><SelectValue placeholder="不关联争点" /></SelectTrigger><SelectContent><SelectItem value="none">不关联争点</SelectItem>
          {value.issueSelection && !options?.issues.some(issue => researchIssueSelectionKey(issue.selection) === researchIssueSelectionKey(value.issueSelection)) ? <SelectItem value={researchIssueSelectionKey(value.issueSelection)} disabled={value.issueSelection.kind === "CURRENT"}>{value.issueSelection.kind === "CURRENT" ? "所选争点已变化，请重新选择" : "保留原研究的争点输入"}</SelectItem> : null}
          {options?.issues.map(issue => <SelectItem key={researchIssueSelectionKey(issue.selection)} value={researchIssueSelectionKey(issue.selection)}>{issue.title} · 修订 {issue.revision} · {issue.selection.confirmedAt ? "已核对" : "待核对"}</SelectItem>)}
        </SelectContent></Select>
      </div>}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5"><Label htmlFor="research-jurisdiction">法域</Label><Input id="research-jurisdiction" placeholder={readOnly ? "待核实" : "未知可留空"} value={value.jurisdiction} readOnly={readOnly} disabled={disabled} onChange={event => update({ jurisdiction: event.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="research-relevant-date">事实相关日期</Label><Input id="research-relevant-date" type="date" value={value.relevantDate} readOnly={readOnly} disabled={disabled} onChange={event => update({ relevantDate: event.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="research-date">研究日期</Label><Input id="research-date" type="date" value={shDayKey(value.researchedAt)} readOnly={readOnly} disabled={disabled} onChange={event => { if (event.target.value) update({ researchedAt: new Date(`${event.target.value}T00:00:00+08:00`).toISOString() }); }} /></div>
      </div>
      {textarea("purpose", "用途与受众", 2)}
      {textarea("scope", "范围、时限与资料限制", 3)}
    </TabsContent>
    <TabsContent value="sources" className="space-y-6">
      <section className="space-y-3"><h3 className="font-medium text-sm">选入原文</h3>
        {readOnly ? saved?.sources.length ? saved.sources.map(source => <div key={source.id} className="rounded-md border p-3 space-y-1.5">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium break-words">{source.documentName} · V{source.version}</p><p className="text-xs text-muted-foreground">{sourceRelationLabels[source.relation]} · {source.locationLabel}{source.changed ? " · 已有新版本，当前研究仍采用此版" : ""}</p></div>
            <Button variant="outline" size="sm" onClick={() => onOpenSource(source.id)} disabled={disabled}>查看原文</Button></div>
          {source.lawMetadata.kind !== "MATERIAL" ? <p className="text-sm">{lawKindLabels[source.lawMetadata.kind]} · {source.lawMetadata.jurisdiction || "法域待核实"} · {source.lawMetadata.title || "法源名称未记录"} · {source.lawMetadata.verification === "CHECKED" ? "身份及时点已核实" : "待核实"}</p> : null}
          <details><summary className="text-xs cursor-pointer text-muted-foreground">来源详情</summary><dl className="mt-2 text-sm grid grid-cols-[8rem_1fr] gap-2">
            <dt>机关 / 编号</dt><dd>{source.lawMetadata.authority || "未记录"} / {source.lawMetadata.number || "未记录"}</dd>
            <dt>效力期间</dt><dd>{source.lawMetadata.effectiveFrom || "起日未知"} 至 {source.lawMetadata.effectiveTo || "结束日未知"}</dd>
            <dt>取得时间 / 途径</dt><dd>{source.lawMetadata.acquiredOn || "未记录"} / {source.lawMetadata.acquiredVia || "未记录"}</dd>
            <dt>使用范围</dt><dd className="whitespace-pre-wrap break-words">{source.lawMetadata.usageScope || "待核实"}</dd>
          </dl></details>
        </div>) : <p className="text-sm text-muted-foreground">尚未选入原文。链接与摘要见下方查询记录。</p> : <ResearchSourceEditor value={value.sources} documents={options?.documents ?? []} disabled={disabled || !options} onChange={sources => update({ sources })} onPreview={onPreviewSource} />}
      </section>
      <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium text-sm">查询与阅读记录</h3>{!readOnly ? <Button size="sm" variant="outline" disabled={disabled || value.queryLog.length >= 40} onClick={() => update({ queryLog: [...value.queryLog, { query: "", location: "", access: "NONE", outcome: "NOT_OBTAINED", notes: "" }] })}>添加记录</Button> : null}</div>
        {value.queryLog.map((query, index) => <div key={index} className="rounded-md border p-3 space-y-3">
          <div className="space-y-1.5"><Label htmlFor={`query-${index}`}>查询词或阅读范围</Label><Input id={`query-${index}`} value={query.query} disabled={disabled} readOnly={readOnly} onChange={event => updateQuery(index, { query: event.target.value })} /></div>
          <div className="grid grid-cols-[1fr_9rem_11rem] gap-3">
            <div className="space-y-1.5"><Label htmlFor={`query-location-${index}`}>来源位置或链接</Label><Input id={`query-location-${index}`} value={query.location} disabled={disabled} readOnly={readOnly} onChange={event => updateQuery(index, { location: event.target.value })} /></div>
            <div className="space-y-1.5"><Label>取得范围</Label><Select value={query.access} disabled={disabled || readOnly} onValueChange={access => updateQuery(index, { access: access as ResearchQuery["access"] })}><SelectTrigger aria-label={`取得范围 ${index + 1}`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(queryAccessLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>实际结果</Label><Select value={query.outcome} disabled={disabled || readOnly} onValueChange={outcome => updateQuery(index, { outcome: outcome as ResearchQuery["outcome"] })}><SelectTrigger aria-label={`查询结果 ${index + 1}`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(queryOutcomeLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor={`query-notes-${index}`}>发现、限制或失败原因</Label><Textarea id={`query-notes-${index}`} rows={2} value={query.notes} readOnly={readOnly} disabled={disabled} onChange={event => updateQuery(index, { notes: event.target.value })} /></div>
          {!readOnly ? <Button variant="ghost" size="sm" disabled={disabled} onClick={() => update({ queryLog: value.queryLog.filter((_, i) => i !== index) })}>移除此记录</Button> : null}
        </div>)}
      </section>
    </TabsContent>
    <TabsContent value="analysis" className="space-y-4">
      {textarea("rule", "规则与法律前提")}{textarea("exceptions", "例外与适用条件", 3)}
      <div className="grid grid-cols-2 gap-4">{textarea("supportingAnalysis", "支持论证", 6)}{textarea("opposingAnalysis", "反向论证与可能反驳", 6)}</div>
      {textarea("conclusion", "结论与成立条件")}{textarea("unresolved", "未决与材料缺口", 3)}{textarea("nextSteps", "下一步", 3)}
    </TabsContent>
  </Tabs>;
}
