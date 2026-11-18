"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, Modal, Select } from "@douyinfe/semi-ui";
import { actionErrorMessage } from "@/lib/action-error";
import { getSavedCaseResearchInput } from "@/server/research/actions";
import { queryAccessLabels, queryOutcomeLabels, type ResearchContent, type ResearchOptions, type SavedCaseResearchInput } from "@/server/research/contracts";

export function ResearchSavedCasePicker({ matterId, options, value, onChange, disabled }: {
  matterId: string; options: ResearchOptions; value: ResearchContent; onChange(value: ResearchContent): void; disabled: boolean;
}) {
  const [open, setOpen] = useState(false), [documentId, setDocumentId] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [input, setInput] = useState<SavedCaseResearchInput | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const labelId = useId();
  const documents = options.documents.filter(document => document.hasIdentity && options.savedCaseDocumentIds.includes(document.id));

  useEffect(() => {
    sequence.current += 1;
    setOpen(false); setOptionsOpen(false); setDocumentId(""); setInput(null); setLoading(false); setError(null);
    return () => { sequence.current += 1; };
  }, [matterId, disabled]);

  function changeOpen(next: boolean) {
    sequence.current += 1;
    setOpen(next); setOptionsOpen(false); setDocumentId(""); setInput(null); setLoading(false); setError(null);
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
  return <>
    <Button htmlType="button" size="small" type="tertiary" aria-haspopup="dialog" aria-expanded={open && !disabled} disabled={disabled} onClick={() => changeOpen(true)}>
      采用已保存类案
    </Button>
    <Modal
      title="采用已保存类案"
      visible={open && !disabled}
      width="min(42rem, calc(100vw - 2rem))"
      centered
      motion={false}
      okText="加入研究"
      cancelText="取消"
      okButtonProps={{ disabled: !input || loading || disabled }}
      bodyStyle={{ maxHeight: "65vh", overflowY: "auto" }}
      onOk={adopt}
      onCancel={() => changeOpen(false)}
    >
      <p className="mb-3 text-sm text-muted-foreground">选择本事项内的一份固定材料版本，核对后将来源与阅读记录加入当前研究草稿。</p>
      {documents.length ? <div className="space-y-3">
        <div className="space-y-1.5" onKeyDown={event => {
          if (optionsOpen && event.key === "Escape") event.stopPropagation();
        }}>
          <p id={labelId} className="text-sm font-medium">已保存类案材料</p>
          <Select<string>
            aria-labelledby={labelId}
            motion={false}
            value={documentId || undefined}
            onChange={next => { if (typeof next === "string") selectDocument(next); }}
            onDropdownVisibleChange={setOptionsOpen}
            disabled={disabled}
            placeholder="选择具体材料版本"
            optionList={documents.map(document => ({ value: document.id, label: `${document.name} · V${document.version}` }))}
            className="w-full"
          />
        </div>
        <Button htmlType="button" type="tertiary" size="small" onClick={read} disabled={!documentId || loading || disabled}>{loading ? "正在读取材料…" : error ? "重新读取材料" : "读取材料元信息"}</Button>
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
    </Modal>
  </>;
}
