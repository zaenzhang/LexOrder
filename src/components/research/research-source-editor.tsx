"use client";

import { Select, Button, Input, TextArea } from "@douyinfe/semi-ui";
import { useId, useState } from "react";
import { MaterialSourceLocationPicker, type MaterialSourceLocation } from "@/components/documents/material-source-location-picker";
import type { EvidenceDocumentOption } from "@/server/evidence/contracts";
import { emptyLawMetadata, lawKindLabels, sourceRelationLabels, type LawMetadata, type ResearchSourceInput } from "@/server/research/contracts";

type Props = { matterId: string; value: ResearchSourceInput[]; documents: EvidenceDocumentOption[]; disabled: boolean; onChange(value: ResearchSourceInput[]): void; onPreview(source: ResearchSourceInput): void };
const locationKey = (source: Pick<ResearchSourceInput, "documentId" | "parseRunId" | "anchorId">) => `${source.documentId}:${source.parseRunId ?? ""}:${source.anchorId ?? ""}`;

export function ResearchSourceEditor({ matterId, value, documents, disabled, onChange, onPreview }: Props) {
  const selectLabelId = useId();
  const [documentId, setDocumentId] = useState("");
  const [relation, setRelation] = useState<ResearchSourceInput["relation"]>("SUPPORTS");
  const [location, setLocation] = useState<MaterialSourceLocation>({ page: "", position: null });
  const [locationLabels, setLocationLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const selected = documents.find(document => document.id === documentId);
  const updateLaw = (index: number, patch: Partial<LawMetadata>) => onChange(value.map((source, i) => {
    if (i !== index) return source;
    const changed = Object.entries(patch).some(([key, next]) => key !== "verification" && next !== source.lawMetadata[key as keyof LawMetadata]);
    return { ...source, lawMetadata: { ...source.lawMetadata, ...patch,
      verification: changed ? "PENDING" : patch.verification ?? source.lawMetadata.verification } };
  }));
  function add() {
    if (!selected || disabled) return;
    const numericPage = !location.position && location.page ? Number(location.page) : null;
    if (numericPage !== null && (!selected.isPdf || !Number.isInteger(numericPage) || numericPage < 1 || !selected.pageCount || numericPage > selected.pageCount)) {
      setError("页码须在这份 PDF 的已知页数内"); return;
    }
    if (value.some(source => source.documentId === selected.id && source.relation === relation && (source.page ?? null) === numericPage
      && (source.parseRunId ?? null) === (location.position?.runId ?? null) && (source.anchorId ?? null) === (location.position?.anchorId ?? null))) {
      setError("此材料位置和用途已选入"); return;
    }
    const source: ResearchSourceInput = { documentId: selected.id, relation,
      ...(location.position ? { parseRunId: location.position.runId, anchorId: location.position.anchorId } : { page: numericPage }),
      lawMetadata: { ...emptyLawMetadata(), title: selected.name } };
    if (location.position) setLocationLabels(previous => ({ ...previous, [locationKey(source)]: location.position!.locationLabel }));
    onChange([...value, source]);
    setDocumentId(""); setLocation({ page: "", position: null }); setError("");
  }
  return <div className="space-y-4">
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1 space-y-1.5"><label id={selectLabelId + "-1"} className="text-sm font-medium text-[var(--semi-color-text-1)]">材料版本</label>
        <Select value={documentId} onChange={value => { if (typeof value !== "string") return; setDocumentId(value); setLocation({ page: "", position: null }); setError(""); }} disabled={disabled} aria-labelledby={selectLabelId + "-1"} placeholder="选择本事项材料" className="w-full" motion={false}>{documents.filter(document => document.hasIdentity).map(document => <Select.Option key={document.id} value={document.id}>{document.name} · V{document.version}</Select.Option>)}</Select>
      </div>
      <div className="w-32 space-y-1.5"><label id={selectLabelId + "-2"} className="text-sm font-medium text-[var(--semi-color-text-1)]">用途</label><Select value={relation} onChange={value => { if (typeof value === "string") setRelation(value as ResearchSourceInput["relation"]); }} disabled={disabled} aria-labelledby={selectLabelId + "-2"} className="w-full" motion={false}>{Object.entries(sourceRelationLabels).map(([key, label]) => <Select.Option key={key} value={key}>{label}</Select.Option>)}</Select></div>
      <Button onClick={add} disabled={disabled || !selected || value.length >= 50} htmlType="button" type="tertiary" theme="outline">选入</Button>
    </div>
    {selected ? <MaterialSourceLocationPicker key={`${matterId}:${selected.id}`} matterId={matterId} document={selected} value={location} onChange={setLocation} disabled={disabled} /> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {value.map((source, index) => {
      const document = documents.find(document => document.id === source.documentId);
      return <div key={`${source.documentId}:${index}`} className="rounded-md border p-3 space-y-3">
        <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium text-sm">{document?.name ?? "已选具体材料"}{document ? ` · V${document.version}` : ""}</p>
          <p className="text-xs text-muted-foreground">{sourceRelationLabels[source.relation]} · {source.anchorId ? locationLabels[locationKey(source)] ?? "固定原文片段" : source.page ? `第 ${source.page} 页` : "原件"}</p></div>
          <div className="flex gap-2"><Button disabled={disabled} onClick={() => onPreview(source)} htmlType="button" type="tertiary" theme="outline" size="small">查看原文</Button><Button disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))} htmlType="button" type="tertiary" theme="borderless" size="small">移除</Button></div>
        </div>
        <details><summary className="cursor-pointer text-sm">来源身份与使用范围</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><label id={selectLabelId + "-3" + "-" + index} className="text-sm font-medium text-[var(--semi-color-text-1)]">资料类别</label><Select disabled={disabled} value={source.lawMetadata.kind} onChange={kind => { if (typeof kind === "string") updateLaw(index, { kind: kind as LawMetadata["kind"], verification: "PENDING" }); }} aria-labelledby={selectLabelId + "-3" + "-" + index} className="w-full" motion={false}>{Object.entries(lawKindLabels).map(([key, label]) => <Select.Option key={key} value={key}>{label}</Select.Option>)}</Select></div>
            <div className="space-y-1.5"><label id={selectLabelId + "-4" + "-" + index} className="text-sm font-medium text-[var(--semi-color-text-1)]">身份及时点核实</label><Select disabled={disabled} value={source.lawMetadata.verification} onChange={verification => { if (typeof verification === "string") updateLaw(index, { verification: verification as LawMetadata["verification"] }); }} aria-labelledby={selectLabelId + "-4" + "-" + index} className="w-full" motion={false}><Select.Option value="PENDING">待核实</Select.Option><Select.Option value="CHECKED">已核实</Select.Option></Select></div>
            {source.lawMetadata.kind !== "MATERIAL" ? <>
              {([['title', '法源名称'], ['authority', '制定或裁判机关'], ['number', '编号'], ['jurisdiction', '法域']] as const).map(([key, label]) => <div key={key} className="space-y-1.5"><label htmlFor={`law-${index}-${key}`} className="text-sm font-medium text-[var(--semi-color-text-1)]">{label}</label><Input id={`law-${index}-${key}`} value={source.lawMetadata[key]} onChange={inputValue => updateLaw(index, { [key]: inputValue })} disabled={disabled} /></div>)}
              <div className="space-y-1.5"><label htmlFor={`law-${index}-from`} className="text-sm font-medium text-[var(--semi-color-text-1)]">效力开始日期</label><Input id={`law-${index}-from`} type="date" value={source.lawMetadata.effectiveFrom} onChange={inputValue => updateLaw(index, { effectiveFrom: inputValue })} disabled={disabled} /></div>
              <div className="space-y-1.5"><label htmlFor={`law-${index}-to`} className="text-sm font-medium text-[var(--semi-color-text-1)]">效力结束日期</label><Input id={`law-${index}-to`} type="date" value={source.lawMetadata.effectiveTo} onChange={inputValue => updateLaw(index, { effectiveTo: inputValue })} disabled={disabled} /></div>
            </> : null}
            <div className="space-y-1.5"><label htmlFor={`law-${index}-acquired`} className="text-sm font-medium text-[var(--semi-color-text-1)]">取得日期</label><Input id={`law-${index}-acquired`} type="date" value={source.lawMetadata.acquiredOn} onChange={inputValue => updateLaw(index, { acquiredOn: inputValue })} disabled={disabled} /></div>
            <div className="space-y-1.5"><label htmlFor={`law-${index}-via`} className="text-sm font-medium text-[var(--semi-color-text-1)]">取得途径</label><Input id={`law-${index}-via`} value={source.lawMetadata.acquiredVia} onChange={inputValue => updateLaw(index, { acquiredVia: inputValue })} disabled={disabled} /></div>
            <div className="col-span-2 space-y-1.5"><label htmlFor={`law-${index}-scope`} className="text-sm font-medium text-[var(--semi-color-text-1)]">授权使用范围</label><TextArea id={`law-${index}-scope`} rows={2} value={source.lawMetadata.usageScope} onChange={inputValue => updateLaw(index, { usageScope: inputValue })} disabled={disabled} /></div>
          </div>
        </details>
      </div>;
    })}
  </div>;
}
