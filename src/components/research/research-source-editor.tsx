"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MaterialSourceLocationPicker, type MaterialSourceLocation } from "@/components/documents/material-source-location-picker";
import type { EvidenceDocumentOption } from "@/server/evidence/contracts";
import { emptyLawMetadata, lawKindLabels, sourceRelationLabels, type LawMetadata, type ResearchSourceInput } from "@/server/research/contracts";

type Props = { matterId: string; value: ResearchSourceInput[]; documents: EvidenceDocumentOption[]; disabled: boolean; onChange(value: ResearchSourceInput[]): void; onPreview(source: ResearchSourceInput): void };
const locationKey = (source: Pick<ResearchSourceInput, "documentId" | "parseRunId" | "anchorId">) => `${source.documentId}:${source.parseRunId ?? ""}:${source.anchorId ?? ""}`;

export function ResearchSourceEditor({ matterId, value, documents, disabled, onChange, onPreview }: Props) {
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
      <div className="min-w-0 flex-1 space-y-1.5"><Label>材料版本</Label>
        <Select value={documentId} onValueChange={value => { setDocumentId(value); setLocation({ page: "", position: null }); setError(""); }} disabled={disabled}>
          <SelectTrigger aria-label="选择研究来源材料"><SelectValue placeholder="选择本事项材料" /></SelectTrigger>
          <SelectContent>{documents.filter(document => document.hasIdentity).map(document => <SelectItem key={document.id} value={document.id}>{document.name} · V{document.version}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="w-32 space-y-1.5"><Label>用途</Label><Select value={relation} onValueChange={value => setRelation(value as ResearchSourceInput["relation"])} disabled={disabled}>
        <SelectTrigger aria-label="来源用途"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(sourceRelationLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
      </Select></div>
      <Button type="button" variant="outline" onClick={add} disabled={disabled || !selected || value.length >= 50}>选入</Button>
    </div>
    {selected ? <MaterialSourceLocationPicker key={`${matterId}:${selected.id}`} matterId={matterId} document={selected} value={location} onChange={setLocation} disabled={disabled} /> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {value.map((source, index) => {
      const document = documents.find(document => document.id === source.documentId);
      return <div key={`${source.documentId}:${index}`} className="rounded-md border p-3 space-y-3">
        <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium text-sm">{document?.name ?? "已选具体材料"}{document ? ` · V${document.version}` : ""}</p>
          <p className="text-xs text-muted-foreground">{sourceRelationLabels[source.relation]} · {source.anchorId ? locationLabels[locationKey(source)] ?? "固定原文片段" : source.page ? `第 ${source.page} 页` : "原件"}</p></div>
          <div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onPreview(source)}>查看原文</Button><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))}>移除</Button></div>
        </div>
        <details><summary className="cursor-pointer text-sm">来源身份与使用范围</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>资料类别</Label><Select disabled={disabled} value={source.lawMetadata.kind} onValueChange={kind => updateLaw(index, { kind: kind as LawMetadata["kind"], verification: "PENDING" })}>
              <SelectTrigger aria-label={`资料类别 ${index + 1}`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(lawKindLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
            </Select></div>
            <div className="space-y-1.5"><Label>身份及时点核实</Label><Select disabled={disabled} value={source.lawMetadata.verification} onValueChange={verification => updateLaw(index, { verification: verification as LawMetadata["verification"] })}>
              <SelectTrigger aria-label={`来源核实状态 ${index + 1}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PENDING">待核实</SelectItem><SelectItem value="CHECKED">已核实</SelectItem></SelectContent>
            </Select></div>
            {source.lawMetadata.kind !== "MATERIAL" ? <>
              {([['title', '法源名称'], ['authority', '制定或裁判机关'], ['number', '编号'], ['jurisdiction', '法域']] as const).map(([key, label]) => <div key={key} className="space-y-1.5"><Label htmlFor={`law-${index}-${key}`}>{label}</Label><Input id={`law-${index}-${key}`} value={source.lawMetadata[key]} onChange={event => updateLaw(index, { [key]: event.target.value })} disabled={disabled} /></div>)}
              <div className="space-y-1.5"><Label htmlFor={`law-${index}-from`}>效力开始日期</Label><Input id={`law-${index}-from`} type="date" value={source.lawMetadata.effectiveFrom} onChange={event => updateLaw(index, { effectiveFrom: event.target.value })} disabled={disabled} /></div>
              <div className="space-y-1.5"><Label htmlFor={`law-${index}-to`}>效力结束日期</Label><Input id={`law-${index}-to`} type="date" value={source.lawMetadata.effectiveTo} onChange={event => updateLaw(index, { effectiveTo: event.target.value })} disabled={disabled} /></div>
            </> : null}
            <div className="space-y-1.5"><Label htmlFor={`law-${index}-acquired`}>取得日期</Label><Input id={`law-${index}-acquired`} type="date" value={source.lawMetadata.acquiredOn} onChange={event => updateLaw(index, { acquiredOn: event.target.value })} disabled={disabled} /></div>
            <div className="space-y-1.5"><Label htmlFor={`law-${index}-via`}>取得途径</Label><Input id={`law-${index}-via`} value={source.lawMetadata.acquiredVia} onChange={event => updateLaw(index, { acquiredVia: event.target.value })} disabled={disabled} /></div>
            <div className="col-span-2 space-y-1.5"><Label htmlFor={`law-${index}-scope`}>授权使用范围</Label><Textarea id={`law-${index}-scope`} rows={2} value={source.lawMetadata.usageScope} onChange={event => updateLaw(index, { usageScope: event.target.value })} disabled={disabled} /></div>
          </div>
        </details>
      </div>;
    })}
  </div>;
}
