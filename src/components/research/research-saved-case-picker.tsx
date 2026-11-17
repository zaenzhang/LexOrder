"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { actionErrorMessage } from "@/lib/action-error";
import { getSavedCaseResearchInput } from "@/server/research/actions";
import { queryAccessLabels, queryOutcomeLabels, type ResearchContent, type ResearchOptions, type SavedCaseResearchInput } from "@/server/research/contracts";

export function ResearchSavedCasePicker({ matterId, options, value, onChange, disabled }: {
  matterId: string; options: ResearchOptions; value: ResearchContent; onChange(value: ResearchContent): void; disabled: boolean;
}) {
  const [open, setOpen] = useState(false), [documentId, setDocumentId] = useState("");
  const [input, setInput] = useState<SavedCaseResearchInput | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const documents = options.documents.filter(document => document.hasIdentity && options.savedCaseDocumentIds.includes(document.id));

  useEffect(() => {
    sequence.current += 1;
    setOpen(false); setDocumentId(""); setInput(null); setLoading(false); setError(null);
    return () => { sequence.current += 1; };
  }, [matterId, disabled]);

  function changeOpen(next: boolean) {
    sequence.current += 1;
    setOpen(next); setDocumentId(""); setInput(null); setLoading(false); setError(null);
  }
  function selectDocument(id: string) {
    sequence.current += 1;
    setDocumentId(id); setInput(null); setLoading(false); setError(null);
  }
  async function read() {
    if (!documentId || disabled) return;
    const request = ++sequence.current;
    setLoading(true); setError(null); setInput(null);
    try {
      const result = await getSavedCaseResearchInput(matterId, documentId);
      if (request === sequence.current) setInput(result);
    } catch (err) {
      if (request === sequence.current) setError(actionErrorMessage(err) || "读取失败，请重试");
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }
  function adopt() {
    if (!input || loading || disabled) return;
    if (input.source.documentId !== documentId || !documents.some(document => document.id === documentId)) {
      setError("材料选项已变化，请重新选择并读取"); return;
    }
    if (value.sources.some(source => source.documentId === documentId) || value.queryLog.some(query => query.sourceDocumentId === documentId)) {
      setError("此版本材料已在当前研究中，请在已有来源或阅读记录中核对"); return;
    }
    if (value.sources.length >= 50 || value.queryLog.length >= 40) {
      setError("研究最多保留 50 项来源和 40 条查询记录，请先整理当前草稿"); return;
    }
    // Use the current draft at confirmation, not the draft from when the read began.
    onChange({ ...value, sources: [...value.sources, input.source], queryLog: [...value.queryLog, input.query] });
    changeOpen(false);
  }
  return <Dialog open={open && !disabled} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="outline" disabled={disabled}>采用已保存类案</Button></DialogTrigger>
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>采用已保存类案</DialogTitle><DialogDescription>选择本事项内的一份固定材料版本，核对后将来源与阅读记录加入当前研究草稿。</DialogDescription></DialogHeader>
      {documents.length ? <div className="space-y-3">
        <div className="space-y-1.5"><Label>已保存类案材料</Label>
          <Select value={documentId} onValueChange={selectDocument} disabled={disabled}>
            <SelectTrigger aria-label="已保存类案材料"><SelectValue placeholder="选择具体材料版本" /></SelectTrigger>
            <SelectContent>{documents.map(document => <SelectItem key={document.id} value={document.id}>{document.name} · V{document.version}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={read} disabled={!documentId || loading || disabled}>{loading ? "正在读取材料…" : error ? "重新读取材料" : "读取材料元信息"}</Button>
      </div> : <p className="text-sm text-muted-foreground">没有可自动识别的已保存类案。缺少保存记录的材料仍可在研究中手工选入。</p>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {input ? <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 break-words">
          <dt className="text-muted-foreground">材料所载名称</dt><dd>{input.source.lawMetadata.title || "未记录"}</dd>
          <dt className="text-muted-foreground">法院 / 案号</dt><dd>{input.source.lawMetadata.authority || "未记录"} / {input.source.lawMetadata.number || "未记录"}</dd>
          <dt className="text-muted-foreground">采用范围</dt><dd>{queryAccessLabels[input.query.access]} · {queryOutcomeLabels[input.query.outcome]} · 待核实</dd>
          <dt className="text-muted-foreground">材料所载链接</dt><dd className="min-w-0 break-all">{input.query.location || "未记录"}</dd>
        </dl>
        <p className="whitespace-pre-wrap break-words text-muted-foreground">{input.query.notes}</p>
      </div> : null}
      <DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)}>取消</Button>
        <Button type="button" disabled={!input || loading || disabled} onClick={adopt}>加入研究</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
