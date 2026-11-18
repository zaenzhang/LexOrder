"use client";

import { Disclosure } from "@/components/patterns/disclosure";
import { Button, Input, Select, Toast } from "@douyinfe/semi-ui";
import { formatDeadlineDue } from "@/lib/deadline-due";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { actionErrorMessage } from "@/lib/action-error";
import { formatDateTime } from "@/lib/utils";
import { matterHref } from "@/lib/matters/route";
import { procedureTypeLabel } from "@/lib/enums";
import { savedSmsDecision, smsEventChoice, suggestionPayload, type SmsEventChoice } from "@/lib/sms/suggestions";
import { analyzeSmsInboundFiles, decideSmsSuggestions, listSmsEventTargets, retrySmsSuggestionFiling } from "@/server/sms/confirm-actions";
import { SMS_SUGGESTION_CN, type SmsRow } from "./sms-types";

type Suggestion = SmsRow["suggestions"][number];
const outcomeLabel = { CREATED: "已新建", LINKED: "已关联已有事项", UPDATED: "已应用", UNCHANGED: "目标已是所确认值", REJECTED: "未采用" } as const;

export function SmsSuggestions({ sms, busy }: { sms: SmsRow; busy: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choices, setChoices] = useState<Record<string, SmsEventChoice | undefined>>({});
  const [message, setMessage] = useState<string | null>(null);
  const setChoice = useCallback((id: string, choice: SmsEventChoice | undefined) => setChoices(previous => ({ ...previous, [id]: choice })), []);
  const suggestions = sms.suggestions.filter(row => row.kind !== "DOC_TYPE");
  const waiting = suggestions.filter(row => row.status === "PENDING");
  const batch = waiting.slice(0, 50);
  const decided = suggestions.filter(row => row.status !== "PENDING");
  const analyzable = sms.inboundFiles.some(file => !file.documentId && ["PENDING_REVIEW", "FILED"].includes(file.state) && ["PENDING", "ANALYZING", "NEEDS_OCR", "FAILED"].includes(file.analysisState));
  const needsFiling = Boolean(sms.matchedMatterId) && sms.inboundFiles.some(file => file.state === "PENDING_REVIEW" && !file.documentId);
  const locked = busy || pending;
  const ready = (row: Suggestion) => !["HEARING", "DEADLINE"].includes(row.kind) || smsEventChoice.safeParse(choices[row.id]).success;

  function decide(rows: Suggestion[], decision: "ACCEPTED" | "REJECTED") {
    startTransition(async () => {
      try {
        const result = await decideSmsSuggestions({ smsId: sms.id, expectedMatchedMatterId: sms.matchedMatterId, decision,
          items: rows.map(row => ({ id: row.id, expectedUpdatedAt: row.updatedAt, ...(decision === "ACCEPTED" && choices[row.id] ? { event: choices[row.id] } : {}) })),
        });
        const created = result.results.filter(row => row.outcome === "CREATED" && !row.replayed).length;
        const linked = result.results.filter(row => row.outcome === "LINKED" && !row.replayed).length;
        const rejected = result.results.filter(row => row.outcome === "REJECTED" && !row.replayed).length;
        const other = result.results.filter(row => ["UPDATED", "UNCHANGED"].includes(row.outcome) && !row.replayed).length;
        const replayed = result.results.filter(row => row.replayed).length;
        const summary = [created ? `新建 ${created} 项` : "", linked ? `关联已有 ${linked} 项` : "", rejected ? `未采用 ${rejected} 项` : "", other ? `确认档案/归属 ${other} 项` : "", replayed ? `已保存记录 ${replayed} 项（未重复应用）` : ""].filter(Boolean).join("，");
        Toast.success(summary || "决定已保存");
        const remaining = result.remaining;
        setMessage([...result.warnings, remaining?.processingNote ?? "", remaining?.remainingFiles ? `仍有 ${remaining.remainingFiles} 个文件待处理，可继续入卷或补传。` : "", remaining?.needsManualFetch ? "仍有取件未完成，请使用来件上的重新取件或人工补传。" : ""].filter(Boolean).join("；") || null);
        router.refresh();
      } catch (error) { setMessage(error instanceof Error ? actionErrorMessage(error) : "保存失败，当前选择仍保留"); }
    });
  }
  if (!suggestions.length && !analyzable && !needsFiling) return null;
  return <section className="mt-3 space-y-3 border-t border-border pt-3" aria-label="来件整理建议">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">整理建议 · {waiting.length} 项待确认</span>
      {analyzable ? <Button size="small" theme="outline" type="tertiary" disabled={locked} onClick={() => startTransition(async () => {
        try {
          const result = await analyzeSmsInboundFiles({ smsId: sms.id });
          const successful = result.results.filter(row => row.state === "ANALYZED").length;
          setMessage(`已分析 ${successful} 个文件，产生 ${result.results.reduce((count, row) => count + row.suggestionCount, 0)} 项业务建议${successful < result.results.length ? "；其余文件的失败或人工接续状态见文件清单" : ""}`);
          router.refresh();
        } catch (error) { setMessage(error instanceof Error ? actionErrorMessage(error) : "分析失败"); }
      })}>阅读并整理</Button> : null}
      {needsFiling ? <Button size="small" theme="outline" type="tertiary" disabled={locked} onClick={() => startTransition(async () => {
        try {
          const result = await retrySmsSuggestionFiling(sms.id);
          setMessage(result.warning ?? result.remaining.processingNote ?? `本次入卷 ${result.filedFiles} 个；仍有 ${result.remaining.remainingFiles} 个文件待处理`);
          router.refresh();
        } catch (error) { setMessage(error instanceof Error ? actionErrorMessage(error) : "入卷失败，请重试"); }
      })}>继续入卷</Button> : null}
      {waiting.length > 1 ? <Button size="small" disabled={locked || !batch.every(ready)} onClick={() => decide(batch, "ACCEPTED")}>{waiting.length > 50 ? "采用前 50 项已核对建议" : "采用全部已核对建议"}</Button> : null}
    </div>
    {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
    {!message && sms.processingNote ? <p role="status" className="text-sm text-muted-foreground">{sms.processingNote}</p> : null}
    {waiting.map(row => {
      const source = sms.inboundFiles.find(file => file.id === row.fileId);
      return <div key={row.id} className="space-y-2 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 text-sm">
            <span className="mr-2 font-medium">{SMS_SUGGESTION_CN[row.kind]}</span>
            {row.kind === "FIELD_CHANGE" ? `${row.fieldKey === "caseNumber" ? "案号" : "法院"}：${row.currentValue || "（空）"} → ${row.suggestedValue}` : row.suggestedValue}
          </div>
          <div className="flex gap-2">
            <Button size="small" theme="outline" type="tertiary" disabled={locked} onClick={() => decide([row], "REJECTED")}>不采用</Button>
            <Button size="small" disabled={locked || !ready(row)} onClick={() => decide([row], "ACCEPTED")}>采用</Button>
          </div>
        </div>
        {(source || row.sourceExcerpt || row.sourcePage) ? <div className="text-xs text-muted-foreground">
          {source?.documentId ? <a className="underline" href={`/api/documents/${source.documentId}/download?inline=1`} target="_blank" rel="noreferrer">{source.displayName ?? source.originalName}</a> : source ? <span>{source.displayName ?? source.originalName} · 待入卷原件</span> : null}
          {row.sourcePage ? <span> · 来源第 {row.sourcePage} 页</span> : null}
          {row.sourceExcerpt ? <p className="mt-1 whitespace-pre-wrap">{row.sourceExcerpt}</p> : null}
        </div> : null}
        {row.kind === "HEARING" || row.kind === "DEADLINE" ? <EventChoiceEditor key={`${row.id}:${row.updatedAt.toISOString()}`} sms={sms} row={row} disabled={locked} onChange={setChoice} /> : null}
      </div>;
    })}
    {decided.length ? <Disclosure className="text-sm" heading={<>已处理建议 · {decided.length} 项</>}>
      <ul className="mt-2 space-y-2">
        {decided.map(row => {
          const receipt = savedSmsDecision(row.payload);
          const label = row.status === "REJECTED" ? "未采用" : receipt ? outcomeLabel[receipt.result.outcome] : "历史已采纳（未记录实际产物）";
          return <li key={row.id}>{row.suggestedValue} · {label}{row.targetId && receipt && sms.matchedMatter ? <Link className="ml-2 underline" href={matterHref(sms.matchedMatter, "?view=work&workPane=tasks")}>查看案件事项</Link> : null}</li>;
        })}
      </ul>
    </Disclosure> : null}
  </section>;
}

function EventChoiceEditor({ sms, row, disabled, onChange }: { sms: SmsRow; row: Suggestion; disabled: boolean; onChange: (id: string, value: SmsEventChoice | undefined) => void }) {
  const payload = suggestionPayload(row.payload);
  const proposed = typeof payload.procedureId === "string" ? payload.procedureId : "";
  const procedures = sms.matchedMatter?.procedures ?? [];
  const [procedureId, setProcedureId] = useState(procedures.some(procedure => procedure.id === proposed) ? proposed : "");
  const [mode, setMode] = useState<"CREATE" | "LINK" | "">("");
  const [title, setTitle] = useState(String(payload.title ?? ""));
  const [dateText, setDateText] = useState(String(payload.dateText ?? ""));
  const [timeText, setTimeText] = useState(String(payload.timeText ?? ""));
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);
  const [targets, setTargets] = useState<Awaited<ReturnType<typeof listSmsEventTargets>> | null>(null);
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (mode !== "LINK" || !procedureId) return;
    let current = true;
    setLoading(true); setTargets(null); setTargetId(""); setError(null);
    listSmsEventTargets({ smsId: sms.id, suggestionId: row.id, procedureId, query: search })
      .then(value => { if (current) setTargets(value); })
      .catch(error => { if (current) setError(error instanceof Error ? actionErrorMessage(error) : "读取失败，请重试"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [mode, procedureId, row.id, sms.id, search, reload]);
  useEffect(() => {
    const target = targets?.targets.find(target => target.id === targetId);
    const choice = mode === "CREATE" ? { mode, procedureId, title, dateText, timeText }
      : mode === "LINK" && target ? { mode, procedureId, targetId, expectedTargetUpdatedAt: target.updatedAt } : undefined;
    const parsed = smsEventChoice.safeParse(choice);
    onChange(row.id, parsed.success ? parsed.data : undefined);
  }, [mode, procedureId, title, dateText, timeText, targetId, targets, row.id, onChange]);
  if (!sms.matchedMatter) return <p className="text-sm text-muted-foreground">先确认上方案件归属，再核对本事件的程序与采用方式。</p>;
  const prefix = `suggestion-${row.id}`;
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1"><label id={`${prefix}-procedure-label`}>程序</label>
        <Select
          aria-labelledby={`${prefix}-procedure-label`}
          placeholder="选择实际程序"
          style={{ width: "100%" }}
          motion={false}
          value={procedureId}
          onChange={value => { if (typeof value === "string") { setProcedureId(value); setTargetId(""); } }}
          disabled={disabled}
          optionList={procedures.map(procedure => ({ value: procedure.id, label: `${procedure.customLabel ?? procedureTypeLabel[procedure.type]}${procedure.caseNumber ? ` · ${procedure.caseNumber}` : ""}` }))}
        />
      </div>
      <div className="space-y-1"><label id={`${prefix}-mode-label`}>采用方式</label>
        <Select
          aria-labelledby={`${prefix}-mode-label`}
          placeholder="核对后选择"
          style={{ width: "100%" }}
          motion={false}
          value={mode}
          onChange={value => { if (value === "CREATE" || value === "LINK") { setMode(value); setTargetId(""); } }}
          disabled={disabled || !procedureId}
          optionList={[{ value: "CREATE", label: "新建事项" }, { value: "LINK", label: "关联已有事项" }]}
        />
      </div>
    </div>
    {mode === "CREATE" ? <div className="space-y-2">
      <div className="space-y-1"><label htmlFor={`${prefix}-title`}>事项标题</label><Input id={`${prefix}-title`} value={title} disabled={disabled} onChange={setTitle} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><label htmlFor={`${prefix}-date`}>实际日期</label><Input type="date" id={`${prefix}-date`} value={dateText} disabled={disabled} onChange={setDateText} /></div>
        <div className="space-y-1"><label htmlFor={`${prefix}-time`}>实际时刻（北京时间）</label><Input type="time" id={`${prefix}-time`} value={timeText} disabled={disabled} onChange={setTimeText} /></div>
      </div>
      {!timeText ? <p className="text-xs text-muted-foreground">时刻未确定时先保留本建议。只有日期的期限，可到 <Link className="underline" href={matterHref(sms.matchedMatter, `?view=work&workPane=tasks&procedure=${procedureId}`)} target="_blank">本程序的期限与庭期</Link> 手工登记，再返回此处关联已有事项。</p> : null}
    </div> : null}
    {mode === "LINK" ? <div className="space-y-2">
      <div className="flex gap-2"><Input aria-label="查找同日已有事项" placeholder="在来源日期内按标题查找" value={query} disabled={disabled} onChange={setQuery} /><Button theme="outline" type="tertiary" size="small" disabled={disabled || loading} onClick={() => { setSearch(query); setReload(value => value + 1); }}>查找</Button></div>
      {loading ? <p className="text-sm text-muted-foreground">正在读取实际事项…</p> : error ? <p role="alert" className="text-sm text-destructive">{error}</p> : targets ? <>
        {targets.targets.length ? <><label id={`${prefix}-target-label`} className="sr-only">已有事项</label><Select
          aria-labelledby={`${prefix}-target-label`}
          placeholder="选择并核对原事项"
          style={{ width: "100%" }}
          motion={false}
          value={targetId}
          onChange={value => { if (typeof value === "string") setTargetId(value); }}
          disabled={disabled}
          optionList={targets.targets.map(target => ({ value: target.id, label: `${target.title} · ${row.kind === "DEADLINE" ? formatDeadlineDue(target.at, target.duePrecision) : formatDateTime(target.at)}` }))}
        /></> : <p className="text-sm text-muted-foreground">所选程序在来源日期没有符合条件的事项；可核对程序、缩小查询或先手工登记。</p>}
        {targets.truncated ? <p className="text-xs text-muted-foreground">显示前100项，请按标题继续查找。</p> : null}
      </> : null}
    </div> : null}
  </div>;
}
