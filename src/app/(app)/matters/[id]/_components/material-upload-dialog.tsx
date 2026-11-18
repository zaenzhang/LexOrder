"use client";

import { Disclosure } from "@/components/patterns/disclosure";
import { FileInput } from "@/components/patterns/file-input";
import { Select, Button, Input, Tag } from "@douyinfe/semi-ui";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentCategory, DocumentSourceOrigin } from "@prisma/client";
import { WorkspaceDialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/patterns/workspace-dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { ContextInputPicker } from "@/components/matters/context-input-picker";
import type { ContextInputSelection } from "@/lib/matters/context-inputs";
import { documentCategoryLabel } from "@/lib/enums";
import { documentSourceChip } from "@/lib/ui/moan-tones";
import { actionErrorMessage } from "@/lib/action-error";
import { updateDossierLocation } from "@/lib/matters/dossier-location";
import type { MaterialUploadReceipt } from "@/lib/documents/upload-contract";
import { uploadDocument } from "@/server/documents/actions";
import { closeMaterialUpload, continueMaterialUpload, getMaterialUploadReceipt } from "@/server/documents/ingest-actions";
import { ensureProcedureStage } from "@/server/procedures/actions";
import { MaterialProcessingStatus } from "./material-processing-status";
import { useDocActions } from "./doc-actions-context";

export type UploadProcedureChoice = {
  id: string; label: string; sourceOptions: string[];
  stages: { id: string; name: string; status: "ACTIVE" | "HIDDEN" }[];
};
export type UploadPageContext = {
  matterId: string; procedureId: string | null; stageKey: string | null;
  stageId: string | null; stageName: string | null; title: string;
};
type Location = { pathname: string; procedure: string | null; stage: string | null };
type OpenContext = UploadPageContext & { location: Location; virtualKey: string | null; materializedId: string | null; awaitingStage: boolean };
type Fields = {
  procedureId: string | null; stageId: string | null; stageName: string | null; virtualKey: string | null;
  category: DocumentCategory; sourceParty: string; sourceOrigin: DocumentSourceOrigin | "";
};
type Draft = Fields & { name: string; contextInputs: ContextInputSelection[] };
type Row = {
  id: string; key: string; file: File; draft: Draft; sent: Draft | null;
  status: "DRAFT" | "SENDING" | "REJECTED" | "UNKNOWN" | "INCOMPLETE" | "SAVED" | "CLOSED";
  uncertain: boolean; hasIntent: boolean; message: string;
  receipt: MaterialUploadReceipt | null; documentId: string | null;
};
const labels: Record<Row["status"], string> = {
  DRAFT: "待上传", SENDING: "正在提交", REJECTED: "待修改", UNKNOWN: "结果待核对",
  INCOMPLETE: "上传未完成", SAVED: "已保存", CLOSED: "本次上传已关闭",
};
const categories: DocumentCategory[] = ["PLEADING", "EVIDENCE", "PROCEDURE", "JUDGMENT", "CONTRACT", "OTHER"];
const hasParty = (category: DocumentCategory) => category === "PLEADING" || category === "EVIDENCE";
function editable(row: Row) { return !row.uncertain && !row.hasIntent && (row.status === "DRAFT" || row.status === "REJECTED"); }
function copyDraft(draft: Draft): Draft { return { ...draft, contextInputs: draft.contextInputs.map(input => ({ ...input })) }; }
function locationNow(): Location {
  const url = new URL(window.location.href);
  return { pathname: url.pathname, procedure: url.searchParams.get("procedure"), stage: url.searchParams.get("stage") };
}
function sameLocation(left: Location, right: Location) {
  return left.pathname === right.pathname && left.procedure === right.procedure && left.stage === right.stage;
}

/** One case-scoped batch reuses the existing single-file service; only the selected row mounts its editor. */
export function MaterialUploadDialog({ current, procedures, canWrite, scopeValid, request, defaultCategory }: {
  current: UploadPageContext; procedures: UploadProcedureChoice[]; canWrite: boolean; scopeValid: boolean;
  request: number; defaultCategory: DocumentCategory;
}) {
  const router = useRouter();
  const { onOpenDocument } = useDocActions();
  const id = useId();
  const [context, setContext] = useState<OpenContext | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Fields | null>(null);
  const [busy, setBusy] = useState(false), [paused, setPaused] = useState(false), [notice, setNotice] = useState("");
  const rowsRef = useRef<Row[]>([]), contextRef = useRef<OpenContext | null>(null);
  const currentRef = useRef({ current, procedures, canWrite, scopeValid });
  const live = useRef(false), working = useRef(false), stopped = useRef(false), confirming = useRef(false), materializing = useRef(false);
  const openedRequest = useRef(0), epoch = useRef(0);
  const trigger = useRef<HTMLElement | null>(null), replacement = useRef<string | null>(null);
  const replacementInput = useRef<HTMLInputElement>(null);

  function changeRows(change: (previous: Row[]) => Row[]) {
    rowsRef.current = change(rowsRef.current);
    if (live.current) setRows(rowsRef.current);
  }
  function changeContext(value: OpenContext | null) { contextRef.current = value; if (live.current) setContext(value); }
  function belongsHere(expected: OpenContext, allowOwnEnsure = false) {
    const now = currentRef.current;
    return live.current && now.canWrite && now.current.matterId === expected.matterId && now.current.procedureId === expected.procedureId &&
      sameLocation(locationNow(), expected.location) && (now.scopeValid || expected.awaitingStage || (allowOwnEnsure && materializing.current));
  }
  function stop() { stopped.current = true; if (live.current) setPaused(true); }

  useEffect(() => {
    live.current = true;
    epoch.current++;
    return () => { live.current = false; stopped.current = true; };
  }, []);
  useEffect(() => {
    currentRef.current = { current, procedures, canWrite, scopeValid };
    const opened = contextRef.current;
    if (!opened) return;
    if (opened.awaitingStage && scopeValid && current.stageId === opened.materializedId) changeContext({ ...opened, awaitingStage: false });
    if (!belongsHere(contextRef.current!, true)) stop();
  });
  useEffect(() => {
    if (!request || request === openedRequest.current) return;
    openedRequest.current = request;
    if (contextRef.current || !canWrite || !scopeValid) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const virtualKey = current.stageKey?.startsWith("default-") && !current.stageId ? current.stageKey : null;
    const opened = { ...current, location: locationNow(), virtualKey, materializedId: null, awaitingStage: false };
    const initial: Fields = { procedureId: current.procedureId, stageId: current.stageId, stageName: current.stageName,
      virtualKey, category: defaultCategory, sourceParty: "", sourceOrigin: "" };
    changeContext(opened); setDefaults(initial); setNotice(""); setPaused(false); stopped.current = false;
    // request is the explicit opening signal; ordinary navigation never opens or resets a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const selectedRow = rows.find(row => row.id === selected) ?? null;
  const scopeMatches = context ? canWrite && current.matterId === context.matterId && current.procedureId === context.procedureId &&
    current.stageKey === context.stageKey && (scopeValid || context.awaitingStage) : false;

  function editRow(rowId: string, change: (draft: Draft) => Draft) {
    if (working.current) return;
    changeRows(previous => previous.map(row => row.id === rowId && editable(row)
      ? { ...row, draft: change(copyDraft(row.draft)), sent: null, status: "DRAFT", message: "", receipt: null } : row));
  }
  function addFiles(files: File[]) {
    if (!defaults || !context || working.current || !belongsHere(context)) return;
    const added: Row[] = files.map(file => ({ id: crypto.randomUUID(), key: crypto.randomUUID(), file,
      draft: { ...defaults, name: file.name, contextInputs: [] }, sent: null, status: "DRAFT", uncertain: false,
      hasIntent: false, message: "", receipt: null, documentId: null }));
    changeRows(previous => [...previous, ...added]);
    if (!selected && added.length) setSelected(added[0].id);
  }
  function replaceFile(file: File | undefined) {
    const rowId = replacement.current; replacement.current = null;
    if (!file || !rowId || working.current) return;
    changeRows(previous => previous.map(row => row.id === rowId && (editable(row) || row.status === "CLOSED") ? {
      ...row, file, key: row.status === "CLOSED" ? crypto.randomUUID() : row.key, sent: null,
      draft: { ...row.draft, name: file.name, contextInputs: row.draft.contextInputs.map(value => ({ ...value })) },
      status: "DRAFT", uncertain: false, hasIntent: false, receipt: null, message: "", documentId: null,
    } : row));
  }
  function invalidTarget(draft: Draft): string | null {
    const available = currentRef.current.procedures;
    const procedure = available.find(item => item.id === draft.procedureId);
    if (draft.procedureId && !procedure) return "所选程序已不可用，请重新选择";
    if (draft.virtualKey) return draft.virtualKey === contextRef.current?.virtualKey && draft.procedureId === contextRef.current.procedureId
      ? null : "该待建立环节不属于打开时的程序";
    if (draft.stageId && !procedure?.stages.some(stage => stage.id === draft.stageId && stage.status === "ACTIVE") &&
      !(contextRef.current?.awaitingStage && draft.stageId === contextRef.current.materializedId && draft.procedureId === contextRef.current.procedureId)) {
      return "所选环节已不可用，请重新选择";
    }
    if (draft.sourceParty && (!hasParty(draft.category) || !procedure?.sourceOptions.includes(draft.sourceParty))) return "来源方与当前程序不符，请重新选择";
    return null;
  }
  async function ensureCurrentStage(token: number) {
    const opened = contextRef.current;
    if (!opened?.virtualKey || opened.materializedId || !opened.procedureId || !opened.stageName) return;
    materializing.current = true;
    try {
      const result = await ensureProcedureStage({ procedureId: opened.procedureId, name: opened.stageName, description: "", insertPosition: "END" });
      if (!live.current || epoch.current !== token) return;
      // The returned identity may be retained after navigation; never move the user's new target.
      const stillHere = !stopped.current && belongsHere(opened, true);
      const next: OpenContext = { ...opened, materializedId: result.id, stageId: result.id, stageKey: `stage-${result.id}`,
        location: { ...opened.location, stage: `stage-${result.id}` }, awaitingStage: true };
      changeContext(next);
      const materialize = <T extends Fields>(fields: T): T => fields.virtualKey === opened.virtualKey && fields.procedureId === opened.procedureId
        ? { ...fields, stageId: result.id, stageName: opened.stageName, virtualKey: null } : fields;
      changeRows(previous => previous.map(row => ({ ...row, draft: materialize(row.draft) })));
      setDefaults(previous => previous ? materialize(previous) : previous);
      if (stillHere) updateDossierLocation({ stage: next.stageKey }, "replace");
      else stop();
    } finally { materializing.current = false; }
  }
  function formData(row: Row, draft: Draft, opened: OpenContext) {
    const form = new FormData();
    form.set("requestKey", row.key); form.set("matterId", opened.matterId); form.set("file", row.file);
    form.set("name", draft.name.trim() || row.file.name); form.set("category", draft.category);
    if (draft.procedureId) form.set("procedureId", draft.procedureId);
    if (draft.stageId) form.set("stageId", draft.stageId);
    form.set("tags", draft.stageId && draft.stageName ? `阶段:${draft.stageName}` : "");
    if (hasParty(draft.category) && draft.sourceParty) form.set("sourceParty", draft.sourceParty);
    if (draft.sourceOrigin) form.set("sourceOrigin", draft.sourceOrigin);
    form.set("contextInputs", JSON.stringify(draft.contextInputs));
    return form;
  }
  async function send(onlyRow?: string) {
    const opened = contextRef.current;
    if (working.current || !opened || !belongsHere(opened)) return;
    working.current = true; setBusy(true); stopped.current = false; setPaused(false); setNotice("");
    const token = epoch.current;
    const ids = rowsRef.current.filter(row => onlyRow ? row.id === onlyRow && ["DRAFT", "REJECTED", "UNKNOWN"].includes(row.status) : editable(row)).map(row => row.id);
    let saved = false;
    try {
      for (const rowId of ids) {
        if (stopped.current || token !== epoch.current || !belongsHere(contextRef.current!)) { stop(); break; }
        let row = rowsRef.current.find(item => item.id === rowId)!;
        if (row.draft.virtualKey) {
          try { await ensureCurrentStage(token); }
          catch (error) { if (live.current) setNotice(actionErrorMessage(error) || "环节建立结果尚未核实，请核对后继续"); stop(); break; }
        }
        if (stopped.current || token !== epoch.current || !belongsHere(contextRef.current!)) { stop(); break; }
        row = rowsRef.current.find(item => item.id === rowId)!;
        const draft = row.sent ?? copyDraft(row.draft);
        const invalid = row.sent ? null : invalidTarget(draft);
        if (invalid) { changeRows(previous => previous.map(item => item.id === rowId ? { ...item, status: "REJECTED", message: invalid } : item)); continue; }
        changeRows(previous => previous.map(item => item.id === rowId ? { ...item, sent: draft, status: "SENDING", message: "" } : item));
        try {
          const result = await uploadDocument(formData(row, draft, contextRef.current!));
          if (result.ok) {
            saved = true;
            changeRows(previous => previous.map(item => item.id === rowId && item.key === row.key ? { ...item, status: "SAVED", hasIntent: true,
              documentId: result.id, message: "已保存，等待材料处理", receipt: null } : item));
          } else {
            changeRows(previous => previous.map(item => item.id === rowId && item.key === row.key ? { ...item,
              status: item.uncertain || item.hasIntent ? "UNKNOWN" : "REJECTED", message: result.message } : item));
          }
        } catch (error) {
          changeRows(previous => previous.map(item => item.id === rowId && item.key === row.key ? { ...item,
            status: "UNKNOWN", uncertain: true, message: actionErrorMessage(error) || "提交结果尚未核实，请核对原上传" } : item));
        }
      }
    } finally {
      working.current = false;
      if (live.current) { setBusy(false); if (saved) router.refresh(); }
    }
  }
  function applyReceipt(rowId: string, key: string, receipt: MaterialUploadReceipt) {
    changeRows(previous => previous.map(row => {
      if (row.id !== rowId || row.key !== key) return row;
      if (receipt.status === "COMMITTED") return { ...row, receipt, status: "SAVED", hasIntent: true, documentId: receipt.document?.id ?? null,
        message: receipt.document ? `已保存 · 第 ${receipt.document.version} 版` : "已保存，当前不可读取该材料" };
      if (receipt.status === "CLOSED") return { ...row, receipt, status: "CLOSED", hasIntent: true, message: "本次上传已关闭，可以重新选择文件" };
      if (receipt.status === "INCOMPLETE") return { ...row, receipt, status: "INCOMPLETE", hasIntent: true, message: receipt.description };
      return { ...row, receipt, status: "UNKNOWN", message: "暂未查到上传记录；旧请求仍可能处理中，请保留原文件和输入核对" };
    }));
  }
  async function inspect(row: Row) {
    const opened = contextRef.current;
    if (!opened || working.current || !belongsHere(opened)) return;
    working.current = true; setBusy(true);
    try { applyReceipt(row.id, row.key, await getMaterialUploadReceipt({ matterId: opened.matterId, requestKey: row.key })); }
    catch (error) { changeRows(previous => previous.map(item => item.id === row.id ? { ...item, message: actionErrorMessage(error) || "上传结果核对失败" } : item)); }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  async function continueUpload(row: Row) {
    const opened = contextRef.current;
    if (!opened || working.current || !belongsHere(opened)) return;
    working.current = true; setBusy(true);
    try {
      const result = await continueMaterialUpload(row.key);
      changeRows(previous => previous.map(item => item.id === row.id && item.key === row.key ? { ...item, status: "SAVED", hasIntent: true, documentId: result.id, message: "已保存，等待材料处理" } : item));
      if (live.current) router.refresh();
    } catch (error) { changeRows(previous => previous.map(item => item.id === row.id && item.key === row.key ? { ...item, uncertain: true, message: actionErrorMessage(error) || "接续结果尚未核实，请核对原上传" } : item)); }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  async function closeIntent(row: Row) {
    const opened = contextRef.current;
    if (!opened || working.current || confirming.current || !belongsHere(opened)) return;
    confirming.current = true;
    try {
      if (!await confirmDialog({ title: `关闭「${row.file.name}」的本次上传？`, description: "仅关闭尚未登记的本次上传；已保存材料不会删除。关闭成功后可重新选择文件。", confirmText: "关闭本次上传", cancelText: "继续核对", initialFocus: "cancel" })) return;
      if (!belongsHere(opened)) return;
      working.current = true; setBusy(true);
      await closeMaterialUpload(row.key);
      applyReceipt(row.id, row.key, { status: "CLOSED" });
    } catch (error) { changeRows(previous => previous.map(item => item.id === row.id && item.key === row.key ? { ...item, uncertain: true, message: actionErrorMessage(error) || "关闭结果尚未核实，请先核对原上传" } : item)); }
    finally { confirming.current = false; working.current = false; if (live.current) setBusy(false); }
  }
  async function closeDialog() {
    if (working.current || confirming.current) return;
    confirming.current = true;
    try {
      const unfinished = rowsRef.current.filter(row => row.status !== "SAVED" && row.status !== "CLOSED");
      if (unfinished.length && !await confirmDialog({ title: "放弃未上传的材料？",
        description: unfinished.some(row => row.sent) ? "这只放弃本地文件和输入，不会取消已经发送的上传。已保存结果保留，未完成请求仍可在材料区核对。" : undefined,
        confirmText: "放弃本地草稿", cancelText: "继续编辑", initialFocus: "cancel" })) return;
      epoch.current++; stopped.current = true; changeContext(null); changeRows(() => []); setDefaults(null); setSelected(null); setNotice("");
    } finally { confirming.current = false; }
  }
  function backToScope() {
    if (!context || working.current) return;
    if (window.location.pathname === context.location.pathname) updateDossierLocation({ procedure: context.location.procedure, stage: context.location.stage });
    else {
      const query = new URLSearchParams({ view: "work", workPane: "materials" });
      if (context.location.procedure) query.set("procedure", context.location.procedure);
      if (context.location.stage) query.set("stage", context.location.stage);
      router.push(`${context.location.pathname}?${query}`);
    }
  }

  return <WorkspaceDialog open={context !== null} onOpenChange={open => { if (!open) void closeDialog(); }}>
    <DialogContent className="max-w-5xl" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus({ preventScroll: true }); }}>
      <DialogHeader><DialogTitle>上传材料 · {context?.title}</DialogTitle>
        <DialogDescription>逐件核对归属和来源，文件分别保存。</DialogDescription></DialogHeader>
      {!scopeMatches && context ? <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive"><span>上传范围已变化；未发送材料已暂停，原文件和输入保留。</span><Button disabled={busy} onClick={backToScope} type="tertiary" theme="outline">返回上传范围</Button></div>
        : paused ? <p role="status" className="text-sm text-muted-foreground">已暂停。核对本批输入后，可继续上传尚未发送的材料。</p> : null}
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      <div className="space-y-2"><label htmlFor={`${id}-files`} className="text-sm font-medium text-[var(--semi-color-text-1)]">文件 *（可多选）</label><FileInput
        id={`${id}-files`}
        multiple
        disabled={busy || !scopeMatches}
        onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></div>
      <input ref={replacementInput} type="file" hidden aria-label="替换当前文件" onChange={event => { replaceFile(event.target.files?.[0]); event.target.value = ""; }} />
      {defaults && context ? <Disclosure heading="共同默认值">
        <div className="space-y-3 pt-3"><UploadFields value={defaults} onChange={setDefaults} procedures={procedures} opened={context} disabled={busy || !scopeMatches} prefix={`${id}-defaults`} />
          <Button
            disabled={busy || !scopeMatches || !rows.some(editable)}
            onClick={() => {
            changeRows(previous => previous.map(row => editable(row) ? { ...row, draft: { ...row.draft, ...defaults }, sent: null, status: "DRAFT", message: "" } : row));
            setNotice("共同默认值已应用到可编辑项；逐件名称及采用的目标和指示保持。");
          }}
            type="tertiary" theme="outline"
            size="small">应用到可编辑项</Button></div></Disclosure> : null}
      {rows.length ? <div className="grid items-start gap-4 md:grid-cols-[minmax(13rem,1fr)_minmax(0,2fr)]">
        <ol aria-label="本批材料" className="max-h-[58vh] space-y-1 overflow-y-auto rounded-md border p-2">
          {rows.map((row, index) => <li key={row.id}><Button
            className="h-auto w-full justify-start whitespace-normal p-3 text-left"
            aria-pressed={selected === row.id}
            onClick={() => setSelected(row.id)}
            type={selected === row.id ? "primary" : "tertiary"}
            theme={selected === row.id ? "light" : "borderless"}><span className="min-w-0 space-y-1"><span className="block break-words">{index + 1}. {row.file.name}</span><Tag color="grey" type="ghost">{labels[row.status]}</Tag></span></Button></li>)}
        </ol>
        {selectedRow && context ? <section aria-label="当前材料" className="min-w-0 space-y-3 rounded-md border p-4">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words font-medium">{selectedRow.file.name}</h3><p className="text-xs text-muted-foreground">{(selectedRow.file.size / 1024).toFixed(0)} KB · {labels[selectedRow.status]}</p></div>
            {editable(selectedRow) || selectedRow.status === "CLOSED" ? <Button disabled={busy || !scopeMatches} onClick={() => { replacement.current = selectedRow.id; replacementInput.current?.click(); }} type="tertiary" theme="borderless" size="small">重新选择文件</Button> : null}</div>
          {selectedRow.message ? <p role={selectedRow.status === "SAVED" ? "status" : "alert"} className="whitespace-pre-wrap break-words text-sm">{selectedRow.message}</p> : null}
          <fieldset disabled={busy || !scopeMatches || !editable(selectedRow)} className="space-y-3">
            <div className="space-y-1.5"><label htmlFor={`${id}-name`} className="text-sm font-medium text-[var(--semi-color-text-1)]">显示名</label><Input id={`${id}-name`} value={selectedRow.draft.name} onChange={inputValue => editRow(selectedRow.id, draft => ({ ...draft, name: inputValue }))} /></div>
            <UploadFields value={selectedRow.draft} onChange={fields => editRow(selectedRow.id, draft => ({ ...draft, ...fields }))}
              procedures={procedures} opened={context} disabled={busy || !scopeMatches || !editable(selectedRow)} prefix={`${id}-row`} />
            <ContextInputPicker key={selectedRow.id} matterId={context.matterId} value={selectedRow.draft.contextInputs}
              onChange={contextInputs => editRow(selectedRow.id, draft => ({ ...draft, contextInputs }))} disabled={busy || !scopeMatches || !editable(selectedRow)} />
          </fieldset>
          <div className="flex flex-wrap gap-2">
            {editable(selectedRow) ? <><Button disabled={busy || !scopeMatches} onClick={() => void send(selectedRow.id)} theme="solid" size="small">上传此项</Button><Button
              disabled={busy}
              onClick={() => {
              changeRows(previous => previous.filter(row => row.id !== selectedRow.id)); setSelected(rowsRef.current[0]?.id ?? null);
            }}
              type="tertiary" theme="borderless"
              size="small">移除此项</Button></> : null}
            {["UNKNOWN", "INCOMPLETE"].includes(selectedRow.status) ? <Button disabled={busy || !scopeMatches} onClick={() => void inspect(selectedRow)} type="tertiary" theme="outline" size="small">核对上传结果</Button> : null}
            {selectedRow.status === "UNKNOWN" && !selectedRow.hasIntent ? <Button disabled={busy || !scopeMatches} onClick={() => void send(selectedRow.id)} theme="solid" size="small">重试原提交</Button> : null}
            {selectedRow.status === "INCOMPLETE" ? <><Button disabled={busy || !scopeMatches || (selectedRow.receipt?.status === "INCOMPLETE" && selectedRow.receipt.waiting)} onClick={() => void continueUpload(selectedRow)} theme="solid" size="small">继续本次上传</Button>
              <Button disabled={busy || !scopeMatches || (selectedRow.receipt?.status === "INCOMPLETE" && selectedRow.receipt.waiting)} onClick={() => void closeIntent(selectedRow)} type="tertiary" theme="outline" size="small">关闭本次上传</Button></> : null}
            {selectedRow.status === "SAVED" && selectedRow.documentId && onOpenDocument ? <Button onClick={() => onOpenDocument(selectedRow.documentId!)} type="tertiary" theme="outline" size="small">查看材料</Button> : null}
          </div>
        </section> : null}
      </div> : <p className="py-3 text-sm text-muted-foreground">选择本次收到的文件，再逐件核对。</p>}
      {context && rows.some(row => row.status === "SAVED" && row.documentId) ? <MaterialProcessingStatus matterId={context.matterId}
        documentIds={rows.filter(row => row.status === "SAVED" && row.documentId).map(row => row.documentId!)} canManage={canWrite && scopeMatches} /> : null}
      <DialogFooter><span className="mr-auto text-sm text-muted-foreground">{rows.length} 份 · 已保存 {rows.filter(row => row.status === "SAVED").length} 份</span>
        <Button onClick={() => void closeDialog()} disabled={busy} type="tertiary" theme="outline">关闭</Button>
        <Button onClick={() => void send()} disabled={busy || !scopeMatches || !rows.some(editable)} theme="solid">{busy ? "正在上传…" : paused ? "继续上传" : "上传"}</Button></DialogFooter>
    </DialogContent>
  </WorkspaceDialog>;
}

function UploadFields({ value, onChange, procedures, opened, disabled, prefix }: {
  value: Fields; onChange(value: Fields): void; procedures: UploadProcedureChoice[]; opened: OpenContext; disabled: boolean; prefix: string;
}) {
  const procedure = procedures.find(item => item.id === value.procedureId);
  const stages = procedure?.stages.filter(stage => stage.status === "ACTIVE") ?? [];
  const virtual = opened.virtualKey && !opened.materializedId && value.procedureId === opened.procedureId;
  const stageValue = value.virtualKey ? "virtual" : value.stageId ?? "none";
  return <div className="grid gap-3 sm:grid-cols-2">
    <div className="space-y-1.5"><label id={`${prefix}-procedure` + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">归属程序</label><Select
      value={value.procedureId ?? "none"}
      disabled={disabled}
      onChange={next => { if (typeof next === "string") onChange({ ...value,
      procedureId: next === "none" ? null : next, stageId: null, stageName: null, virtualKey: null, sourceParty: "" }); }}
      id={`${prefix}-procedure`}
      aria-labelledby={`${prefix}-procedure` + "-label"}
      className="w-full"
      motion={false}><Select.Option value="none">未归属程序</Select.Option>{procedures.map(item => <Select.Option key={item.id} value={item.id}>{item.label}</Select.Option>)}</Select>
      {value.procedureId && !procedure ? <p className="text-xs text-destructive">原选择程序已不可用</p> : null}
      <p className="text-xs text-muted-foreground">改程序会清空原环节和来源方。</p>
    </div>
    <div className="space-y-1.5"><label id={`${prefix}-stage` + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">归属环节</label><Select
      value={stageValue}
      disabled={disabled || !procedure}
      onChange={next => { if (typeof next !== "string") return;
      const stage = stages.find(item => item.id === next);
      onChange({ ...value, stageId: stage?.id ?? null, stageName: next === "virtual" ? opened.stageName : stage?.name ?? null,
        virtualKey: next === "virtual" ? opened.virtualKey : null });
    }}
      id={`${prefix}-stage`}
      aria-labelledby={`${prefix}-stage` + "-label"}
      className="w-full"
      motion={false}><Select.Option value="none">未归属环节</Select.Option>{virtual ? <Select.Option value="virtual">{opened.stageName}（提交时建立）</Select.Option> : null}{stages.map(stage => <Select.Option key={stage.id} value={stage.id}>{stage.name}</Select.Option>)}{value.stageId && !stages.some(stage => stage.id === value.stageId) ? <Select.Option value={value.stageId} disabled>{value.stageName ?? "原选择环节"}（待核对）</Select.Option> : null}</Select></div>
    <div className="space-y-1.5"><label id={`${prefix}-category` + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">材料类别</label><Select
      value={value.category}
      disabled={disabled}
      onChange={category => { if (typeof category === "string") onChange({ ...value, category: category as DocumentCategory,
      sourceParty: hasParty(category as DocumentCategory) ? value.sourceParty : "" }); }}
      id={`${prefix}-category`}
      aria-labelledby={`${prefix}-category` + "-label"}
      className="w-full"
      motion={false}>{categories.map(category => <Select.Option key={category} value={category}>{documentCategoryLabel[category]}</Select.Option>)}</Select></div>
    <div className="space-y-1.5"><label id={`${prefix}-origin` + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">材料来源</label><Select value={value.sourceOrigin || "none"} disabled={disabled} onChange={sourceOrigin => { if (typeof sourceOrigin === "string") onChange({ ...value, sourceOrigin: sourceOrigin === "none" ? "" : sourceOrigin as DocumentSourceOrigin }); }} id={`${prefix}-origin`} aria-labelledby={`${prefix}-origin` + "-label"} className="w-full" motion={false}><Select.Option value="none">不标注</Select.Option>{(Object.keys(documentSourceChip) as DocumentSourceOrigin[]).map(origin => <Select.Option key={origin} value={origin}>{documentSourceChip[origin].label}</Select.Option>)}</Select></div>
    {hasParty(value.category) && procedure?.sourceOptions.length ? <div className="space-y-1.5 sm:col-span-2"><label id={`${prefix}-party` + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">来源方</label><Select value={value.sourceParty || "none"} disabled={disabled} onChange={sourceParty => { if (typeof sourceParty === "string") onChange({ ...value, sourceParty: sourceParty === "none" ? "" : sourceParty }); }} id={`${prefix}-party`} aria-labelledby={`${prefix}-party` + "-label"} className="w-full" motion={false}><Select.Option value="none">不标注</Select.Option>{procedure.sourceOptions.map(party => <Select.Option key={party} value={party}>{party}</Select.Option>)}</Select></div> : null}
  </div>;
}
