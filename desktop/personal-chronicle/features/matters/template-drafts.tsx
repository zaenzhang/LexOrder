"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { materialUrl, readPersonal, workspaceEndpoint } from "./personal-client"

type Target = "clientId" | "opposingPartyId" | "thirdPartyId" | "procedureId"
type Selection = Record<Target, string | null>
type Prepared = { templateId: string; templateUpdatedAt: string; selection: Selection; expectedSubjects: Record<string, string[]>;
  expectedValues: Record<string,string>; choices: Record<string, { id: string; label: string }[]>
  fields: { path: string; value: string; editable: boolean; required: boolean; missing: boolean; controlsScope: boolean; subjectLabel?: string }[] }
const targets = [["clientId","clients","委托人"],["opposingPartyId","opposing","对方当事人"],["thirdPartyId","thirds","第三人"],["procedureId","procedures","程序"]] as const
type Mode = "render" | "upload"
export function TemplateDrafts({ matterId, onGenerated }: { matterId: string; onGenerated: () => void }) {
  const [mode, setMode] = useState<Mode>()
  const [receipt, setReceipt] = useState<{ documentId: string; fileName: string }>()
  return <div className="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="outline" onClick={() => setMode("render")}>从模板起草</Button>
    <Button size="sm" variant="ghost" onClick={() => setMode("upload")}>导入文书模板</Button>
    {receipt && <a className="text-sm underline" href={materialUrl("/api/documents/"+receipt.documentId+"/download")} download>下载 {receipt.fileName}</a>}
    {mode && <TemplateForm mode={mode} matterId={matterId} close={() => setMode(undefined)} generated={result => { setReceipt(result); setMode(undefined); onGenerated() }} />}
  </div>
}
function TemplateForm({ mode, matterId, close, generated }: { mode: Mode; matterId: string; close: () => void; generated: (result: { documentId: string; fileName: string }) => void }) {
  const [choices, setChoices] = useState<{ id: string; name: string }[]>()
  const [selected, setSelected] = useState("")
  const [prepared, setPrepared] = useState<Prepared>()
  const [overrides, setOverrides] = useState<Record<string,string>>({})
  const [changed, setChanged] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (mode !== "render") return
    const controller = new AbortController()
    readPersonal<{ templates: { id: string; name: string }[] }>(workspaceEndpoint + "?" + new URLSearchParams({ section:"templates", matter:matterId }), {signal:controller.signal})
      .then(result => { if (!controller.signal.aborted) setChoices(result.templates) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId,mode,retry])
  function post<T>(action: string, data: unknown) {
    return readPersonal<T>(workspaceEndpoint,{ method:"POST", headers:{"Content-Type":"application/json"},body:JSON.stringify({action,data}) })
  }
  async function prepare(id: string, selection?: Selection, values?: Record<string,string>) {
    if (busy || !id) return
    setBusy(true); setError(""); setReviewed(false)
    try {
      const next = await post<Prepared>("prepare-template",{matterId,templateId:id,selection,overrides:values ?? {},
        ...(values && prepared ? {expectedSubjects:prepared.expectedSubjects}: {})})
      setPrepared(next);setSelected(id);setOverrides(values ?? {});setChanged(false);setKey(crypto.randomUUID())
    } catch (cause) { setError(cause instanceof Error ? cause.message:"无法准备模板。") } finally { setBusy(false) }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError("")
    try {
      if (mode === "upload") {
        const form=new FormData(event.currentTarget);form.set("action","add-template")
        await readPersonal(workspaceEndpoint,{ method:"POST",body:form }); close()
      } else if (prepared && !changed && reviewed) {
        const result = await post<{ documentId: string; fileName: string }>("render-template",{
          matterId,templateId:selected,templateUpdatedAt:prepared.templateUpdatedAt,selection:prepared.selection,expectedValues:prepared.expectedValues,
          expectedSubjects:prepared.expectedSubjects,overrides:Object.fromEntries(prepared.fields.filter(f => f.editable && Object.hasOwn(overrides,f.path)).map(f => [f.path,overrides[f.path]])),
          folderId:null,requestKey:key,reviewed:true,
        })
        generated(result)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message:"保存失败。") } finally { setBusy(false) }
  }
  return <Sheet open onOpenChange={open => { if (!open && !busy) { if (dirty) setDiscard(true); else close() } }}>
    <SheetContent className="overflow-y-auto sm:max-w-xl motion-reduce:transition-none"><SheetHeader><SheetTitle>{mode === "upload" ? "导入文书模板" : "从模板起草"}</SheetTitle></SheetHeader>
      <form className="grid gap-3 px-4 pb-4 text-sm" onSubmit={submit} onChange={() => {setDirty(true);setDiscard(false)}}>
        <fieldset className="grid gap-3" disabled={busy}>
          {mode === "upload" ? <>
            <label className="grid gap-1">模板名称<Input required name="name" maxLength={120}/></label>
            <label className="grid gap-1">模板用途<NativeSelect name="category" defaultValue="WORK_PRODUCT">
              {Object.entries({INTAKE:"收案",RETAINER:"委托",LITIGATION:"诉讼",EXECUTION:"执行",HEARING:"庭审",WORK_PRODUCT:"工作成果",ARCHIVE:"归档",CLOSING:"结案",BLANK:"空白模板"}).map(([id,label]) => <NativeSelectOption key={id} value={id}>{label}</NativeSelectOption>)}</NativeSelect></label>
            <label className="grid gap-1">Word 模板（工作区各案可用）<Input type="file" name="file" accept=".docx" required/></label>
            <Button type="submit">导入模板</Button>
          </> : <>
            <label className="grid gap-1">本案适用模板<NativeSelect value={selected} disabled={!!Object.keys(overrides).length} onChange={e => void prepare(e.target.value)}>
              <NativeSelectOption value="" disabled>{choices ? choices.length ? "选择模板" : "暂无适用模板" : "正在读取…"}</NativeSelectOption>
              {choices?.map(row => <NativeSelectOption key={row.id} value={row.id}>{row.name}</NativeSelectOption>)}</NativeSelect></label>
            {!choices && error && <Button type="button" variant="outline" onClick={() => {setError("");setRetry(n => n+1)}}>重读模板</Button>}
            {prepared && <>
              {targets.filter(([,list]) => prepared.choices[list].length > 0).map(([target,list,label]) => <label className="grid gap-1" key={target}>{label}
                <NativeSelect value={prepared.selection[target] ?? ""} disabled={!!Object.keys(overrides).length} onChange={e => void prepare(selected,{...prepared.selection,[target]:e.target.value || null})}>
                  <NativeSelectOption value="">未选择</NativeSelectOption>{prepared.choices[list].map(row => <NativeSelectOption key={row.id} value={row.id}>{row.label}</NativeSelectOption>)}</NativeSelect></label>)}
              {Object.keys(overrides).length > 0 && <Button size="sm" variant="ghost" type="button" onClick={() => void prepare(selected,prepared.selection)}>清除本次临时值</Button>}
              {prepared.fields.map(field => <label key={field.path} className="grid gap-1">{[field.subjectLabel,field.path].filter(Boolean).join(" · ")}{field.required && "（必填）"}
                <Input readOnly={!field.editable} value={overrides[field.path] ?? field.value} maxLength={2000} onChange={e => {
                  setOverrides({...overrides,[field.path]:e.target.value});setReviewed(false);setChanged(true);setKey(crypto.randomUUID())
                }}/></label>)}
              {changed ? <Button type="button" variant="outline" onClick={() => void prepare(selected,prepared.selection,overrides)}>重新核对实际字段</Button> :
                <label className="flex gap-2"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)}/>已核对本次文书的主体、程序与字段</label>}
              <Button type="submit" disabled={!reviewed || changed || prepared.fields.some(field => field.required && field.missing)}>{busy ? "正在生成…" : "生成工作稿"}</Button>
            </>}
          </>}
        </fieldset>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {discard && <div role="alert" className="grid gap-2">放弃本次模板输入？<div className="flex gap-2"><Button type="button" size="sm" onClick={() => setDiscard(false)}>继续填写</Button><Button type="button" variant="outline" size="sm" onClick={close}>放弃输入</Button></div></div>}
      </form>
    </SheetContent>
  </Sheet>
}
