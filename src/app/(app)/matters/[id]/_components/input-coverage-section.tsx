"use client";

import { Disclosure } from "@/components/patterns/disclosure";
import { Button as SemiButton } from "@douyinfe/semi-ui";

import { Checkbox } from "@douyinfe/semi-ui";
import { useEffect, useId, useRef, useState } from "react";
import { ActionError, actionErrorMessage } from "@/lib/action-error";
import {
  INPUT_COVERAGE_MAX_DOCUMENTS,
  type AvailableInputCoverageItem,
  type InputCoverageRange,
  type MatterInputCoverageView
} from "@/lib/ai/input-coverage";
import { formatDateTime } from "@/lib/utils";
import { getMatterInputCoverage } from "@/server/ai/input-coverage-actions";

type DocumentChoice = { id: string; name: string; version?: number | null };
type Props = { matterId: string; documents: DocumentChoice[]; refreshKey?: string | number; showHeading?: boolean };
type ReadState = { status: "idle" | "loading" } | { status: "ready"; data: MatterInputCoverageView } | { status: "error"; message: string };

const unitLabels = { PAGE: "页", PARAGRAPH: "段", SEGMENT: "处理单元" } as const;
const unitStatusLabels = { READY: "可读取", PENDING: "尚未识别", FAILED: "处理失败", UNSUPPORTED: "暂不支持", TRUNCATED: "仅处理了部分内容" } as const;
const count = (value: number) => value.toLocaleString("zh-CN");

/** Selection is explicit and local to this material list, never an implicit whole-matter query. */
export function InputCoverageSection({ matterId, documents, refreshKey, showHeading = true }: Props) {
  const scope = JSON.stringify([matterId, refreshKey ?? null, documents.map(document => [document.id, document.name, document.version ?? null])]);
  return <CoverageSection key={scope} matterId={matterId} documents={documents} showHeading={showHeading} />;
}

function CoverageSection({ matterId, documents, showHeading }: Omit<Props, "refreshKey">) {
  const titleId = useId();
  const active = useRef(false);
  const request = useRef(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  const [state, setState] = useState<ReadState>({ status: "idle" });

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; request.current += 1; };
  }, []);

  function changeSelection(documentId: string, checked: boolean) {
    request.current += 1;
    setState({ status: "idle" });
    setSelected(previous => checked ? [...new Set([...previous, documentId])].slice(0, INPUT_COVERAGE_MAX_DOCUMENTS) : previous.filter(id => id !== documentId));
  }

  function clearSelection() {
    request.current += 1;
    setState({ status: "idle" });
    setSelected([]);
  }

  async function check() {
    const selections = documents.filter(document => selected.includes(document.id)).map(document => ({ documentId: document.id }));
    if (!selections.length) return;
    const generation = ++request.current;
    setState({ status: "loading" });
    try {
      const data = await getMatterInputCoverage({ matterId, documents: selections });
      if (!active.current || generation !== request.current) return;
      if (data.matterId !== matterId || data.mode !== "PREVIEW" || data.modelSupply.status !== "NOT_SENT"
        || data.modelSupply.sentChars !== 0 || data.items.length !== selections.length
        || data.items.some((item, index) => item.documentId !== selections[index].documentId)) {
        throw new ActionError("检查结果与本次所选材料不一致，请重试");
      }
      setUnavailable(previous => {
        const next = new Set(previous);
        for (const item of data.items) {
          if (item.status === "UNAVAILABLE") next.add(item.documentId);
          else next.delete(item.documentId);
        }
        return next;
      });
      setState({ status: "ready", data });
    } catch (error) {
      if (active.current && generation === request.current) {
        const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
        const businessError = error instanceof ActionError || (typeof digest === "string" && digest.startsWith("ACTION_ERROR:"));
        setState({ status: "error", message: (businessError ? actionErrorMessage(error) : "") || "暂时无法检查，请稍后重试" });
      }
    }
  }

  return (
    <section className="space-y-3 text-sm" aria-labelledby={showHeading ? titleId : undefined} aria-label={showHeading ? undefined : "材料读取检查"} aria-busy={state.status === "loading"}>
      {showHeading ? <h3 className="font-medium" id={titleId}>材料读取检查</h3> : null}
      {documents.length === 0 ? <p className="text-xs text-muted-foreground">暂无可选择的材料。</p> : <>
        <fieldset>
          <legend className="mb-2 text-xs text-muted-foreground">选择材料（最多 {INPUT_COVERAGE_MAX_DOCUMENTS} 份）</legend>
          <div className="grid max-h-52 gap-x-4 gap-y-2 overflow-y-auto p-1 sm:grid-cols-2">
            {documents.map((document, index) => {
              const checked = selected.includes(document.id);
              const label = unavailable.has(document.id) ? `材料 ${index + 1}（当前不可用）`
                : `${document.name}${document.version == null ? "" : ` · 第 ${document.version} 版`}`;
              return <div key={document.id} className="flex min-w-0 cursor-pointer items-start gap-2 text-xs leading-relaxed">
                <Checkbox checked={checked} onChange={({ target: { checked } }) => changeSelection(document.id, checked === true)} disabled={!checked && selected.length >= INPUT_COVERAGE_MAX_DOCUMENTS} aria-label={label} className="mt-0.5">
                <span className="min-w-0 break-all">{label}</span>
              </Checkbox></div>;
            })}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">本地检查 · 未调用 AI</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">已选 {selected.length} 份</span>
            <SemiButton htmlType="button" theme="borderless" type="tertiary" onClick={clearSelection} disabled={!selected.length}>取消全部勾选</SemiButton>
            <SemiButton htmlType="button" theme="outline" type="tertiary" onClick={() => { void check(); }} disabled={!selected.length || state.status === "loading"}>
              {state.status === "loading" ? "正在检查材料…" : state.status === "error" ? "重试材料检查" : state.status === "ready" ? "重新检查所选材料" : "检查所选材料"}
            </SemiButton>
          </div>
        </div>
      </>}
      {state.status === "loading" ? <p role="status" className="text-xs text-muted-foreground">正在检查所选版本的可读取内容…</p> : null}
      {state.status === "error" ? <p role="alert" className="text-xs text-destructive">材料检查失败：{state.message}</p> : null}
      {state.status === "ready" ? <CoverageResult view={state.data} /> : null}
    </section>
  );
}

function CoverageResult({ view }: { view: MatterInputCoverageView }) {
  return <section aria-label="读取检查结果" className="flex flex-col gap-3 border-t border-[var(--semi-color-border)] pt-3">
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      <div>
        <dt className="text-xs text-muted-foreground">可查看材料</dt>
        <dd className="mt-1 text-base font-medium tabular-nums">{view.summary.availableDocuments}<span className="text-xs font-normal text-muted-foreground"> / {view.summary.selectedDocuments} 份</span></dd>
        {view.summary.unavailableDocuments ? <dd className="mt-1 text-xs text-muted-foreground">不可用 {view.summary.unavailableDocuments} 份</dd> : null}
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{view.summary.preparedChars === view.summary.availableChars ? "可用文本" : "可读取"}</dt>
        <dd className="mt-1 text-base font-medium tabular-nums">{count(view.summary.availableChars)}<span className="text-xs font-normal text-muted-foreground"> 字符</span></dd>
      </div>
      {view.summary.preparedChars !== view.summary.availableChars ? <div>
        <dt className="text-xs text-muted-foreground">本次可用</dt>
        <dd className="mt-1 text-base font-medium tabular-nums">{count(view.summary.preparedChars)}<span className="text-xs font-normal text-muted-foreground"> 字符</span></dd>
      </div> : null}
    </dl>
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>文字上限 {count(view.budget.maxChars)} 字符 · 按列表顺序分配</span>
      <span>检查于 {formatDateTime(view.checkedAt)}</span>
    </div>
    {view.summary.omittedRangeCount > 0 || view.summary.omittedUnitCount > 0 ? <p className="text-xs leading-relaxed text-muted-foreground">
        明细展示有上限：{view.summary.omittedRangeCount > 0 ? `${count(view.summary.omittedRangeCount)} 条文本范围未展开` : ""}
        {view.summary.omittedRangeCount > 0 && view.summary.omittedUnitCount > 0 ? "；" : ""}
        {view.summary.omittedUnitCount > 0 ? `${count(view.summary.omittedUnitCount)} 个处理单元的明细未展开` : ""}。统计仍包含已知范围。
    </p> : null}
    <ul className="divide-y divide-[var(--semi-color-border)]">
      {view.items.map((item, index) => <li key={item.documentId} className="space-y-2 py-3 first:pt-0 last:pb-0">
        {item.status === "UNAVAILABLE" ? <>
          <h4 className="text-xs font-medium">所选材料 {index + 1} 当前不可用</h4>
          <p className="text-xs text-muted-foreground">材料不存在或当前无权查看，未展示名称、版本及范围。</p>
        </> : <AvailableCoverage item={item} />}
      </li>)}
    </ul>
  </section>;
}

function AvailableCoverage({ item }: { item: AvailableInputCoverageItem }) {
  const unit = item.coverage ? unitLabels[item.coverage.unitKind] : "处理单元";
  const counts = item.coverage?.counts;
  const unprocessed = item.coverage?.units.filter(entry => entry.status !== "READY") ?? [];
  return <>
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h4 className="min-w-0 break-all text-xs font-medium">{item.documentName}</h4>
      <span className="text-xs text-muted-foreground">第 {item.documentVersion} 版 · {item.processing.label}</span>
      {item.run ? <span className="text-xs text-muted-foreground">{item.run.isCurrent ? "当前提取文本" : "以前提取的文本"}</span> : null}
    </div>
    <div className="space-y-1 text-xs text-muted-foreground">
      {item.coverage && counts ? <>
        <p>已处理 {count(counts.ready)} / {item.coverage.totalUnits === null ? "总范围未知" : count(item.coverage.totalUnits)} {unit}。
          {item.coverage.totalUnits === null ? "仍可能有未处理内容，不能判断是否完整。" : ""}</p>
        {counts.pending || counts.failed || counts.unsupported || counts.truncated ? <p>
          {[
            counts.pending ? `尚未识别 ${count(counts.pending)} ${unit}` : "",
            counts.failed ? `处理失败 ${count(counts.failed)} ${unit}` : "",
            counts.unsupported ? `暂不支持 ${count(counts.unsupported)} ${unit}` : "",
            counts.truncated ? `仅处理部分内容 ${count(counts.truncated)} ${unit}` : ""
          ].filter(Boolean).join("；")}。
        </p> : null}
      </> : <p>尚无可核实的文本范围。</p>}
      <p>{item.preparation.preparedChars === item.preparation.availableChars
        ? `可用文本 ${count(item.preparation.availableChars)} 字符`
        : `可读取 ${count(item.preparation.availableChars)} 字符 · 本次可用 ${count(item.preparation.preparedChars)} 字符`}
        {item.preparation.unpreparedChars > 0 ? ` · 本次未包含 ${count(item.preparation.unpreparedChars)} 字符` : ""}</p>
      {!item.preparation.canPrepare ? <p>当前无权把此材料用于 AI 审查；仍可查看本地处理状态。</p> : null}
    </div>
    {item.issues.length > 0 ? <ul className="space-y-1 text-xs leading-relaxed">
      {item.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>
        <span className="font-medium">{issue.label}</span>{issue.detail ? <span className="text-muted-foreground">：{issue.detail}</span> : null}
      </li>)}
    </ul> : null}
    {unprocessed.length > 0 || (item.coverage?.omittedUnitCount ?? 0) > 0 ? <Disclosure className="text-xs" heading={<>{unprocessed.length > 0 ? "查看未处理部分" : "查看处理范围说明"}</>}>
      <ul className="mt-1 space-y-1 text-muted-foreground">
        {unprocessed.map(entry => <li key={entry.unit}>第 {entry.unit} {unit}：{unitStatusLabels[entry.status]}</li>)}
      </ul>
      {(item.coverage?.omittedUnitCount ?? 0) > 0 ? <p className="mt-1 text-muted-foreground">另有 {count(item.coverage!.omittedUnitCount)} 个处理单元的明细未展开，不能从当前明细推断其状态。</p> : null}
    </Disclosure> : null}
    {item.preparation.ranges.length > 0 || item.preparation.omittedRangeCount > 0 ? <Disclosure className="text-xs" heading="查看本次可用文本的位置">
      <p className="mt-1 text-muted-foreground">范围对应已提取的文本片段，不代表原件整页或整段均已覆盖。</p>
      <p className="mt-1 text-muted-foreground">字符数按 UTF-16 长度统计，字符位置相对于各文本片段。</p>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {item.preparation.ranges.map(range => <RangeRow key={`${range.anchorId}:${range.start}:${range.end}`} range={range} />)}
      </ul>
      {item.preparation.omittedRangeCount > 0 ? <p className="mt-1 text-muted-foreground">另有 {count(item.preparation.omittedRangeCount)} 条范围明细未展开。</p> : null}
    </Disclosure> : null}
  </>;
}

function RangeRow({ range }: { range: InputCoverageRange }) {
  const partial = range.start !== 0 || range.end !== range.totalChars;
  return <li className="break-words">
    {range.locationLabel} · 本次可用 {count(range.end - range.start)}{partial ? ` / 片段共 ${count(range.totalChars)}` : ""} 字符
    {partial ? `（仅此片段的第 ${count(range.start + 1)}—${count(range.end)} 个字符）` : ""}
    {partial ? <span>；其余文本本次未包含。</span> : null}
  </li>;
}
