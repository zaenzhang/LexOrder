"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { readPersonal, workspaceEndpoint } from "./personal-client"

type Seal = { id: string; code: string; documentTitle: string; status: string; sealType: string; purpose: string; requestedBy: string
  approveNote: string | null; draftDoc: { id: string; name: string } | null; stampedDoc: { id: string; name: string } | null; canApprove: boolean; canStamp: boolean; canCancel: boolean }
export type SealData = { seals: Seal[]; canRequest: boolean; types: { type: string; label: string }[]; purposes: { id: string; name: string; allowedSealTypes: string[] }[] }
const statuses: Record<string,string> = { PENDING: "待确认", APPROVED: "已确认，待盖章", STAMPED: "已回填盖章件", REJECTED: "已驳回", CANCELLED: "已撤销" }
const labels = { create: "申请用印", approve: "本人确认申请", reject: "驳回申请", cancel: "撤销申请", stamp: "登记实际盖章" }
type Action = keyof typeof labels

export function SealWorkspace({ matterId, data, reload }: { matterId: string; data: SealData; reload: () => void }) {
  const [edit, setEdit] = useState<{ action: Action; row?: Seal }>()
  const [notice, setNotice] = useState("")
  const configured = data.types.some(t => data.purposes.some(p => p.allowedSealTypes.includes(t.type)))
  return <Card><CardHeader><CardTitle>用印记录</CardTitle></CardHeader><CardContent className="grid gap-3">
    {data.canRequest && (configured ? <Button size="sm" className="justify-self-start" onClick={() => setEdit({ action: "create" })}>申请用印</Button>
      : <p className="text-sm text-muted-foreground">尚无可用的印章与用章事项组合。</p>)}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!data.seals.length && <p className="text-sm text-muted-foreground">本案暂无用印记录。</p>}
    {data.seals.map(row => <section key={row.id} className="grid gap-2 border-b pb-3 text-sm">
      <h3 className="font-medium">{row.documentTitle}</h3>
      <p>{row.code} · {data.types.find(t => t.type === row.sealType)?.label ?? row.sealType} · {statuses[row.status] ?? row.status}</p>
      <p>{row.requestedBy} · {row.purpose}</p>{row.approveNote && <p>{row.approveNote}</p>}
      {[row.draftDoc, row.stampedDoc].map((doc,i) => doc ? <a className="underline" key={doc.id} href={"/api/documents/"+doc.id+"/download"} download>
        {i ? "盖章扫描件" : "待盖章版本"} · {doc.name}</a> : null)}
      <div className="flex flex-wrap gap-2">{(["approve","reject","cancel","stamp"] as const).filter(a => a === "cancel" ? row.canCancel : a === "stamp" ? row.canStamp : row.canApprove).map(action =>
        <Button key={action} size="sm" variant="outline" onClick={() => setEdit({ action, row })}>{labels[action]}</Button>)}</div>
    </section>)}
    {edit && <SealForm matterId={matterId} data={data} action={edit.action} row={edit.row} close={() => setEdit(undefined)} saved={() => { setEdit(undefined); setNotice("用印记录已更新。"); reload() }} />}
  </CardContent></Card>
}
function SealForm({ matterId, data, action, row, close, saved }: { matterId: string; data: SealData; action: Action; row?: Seal; close: () => void; saved: () => void }) {
  const [type,setType] = useState("")
  const [dirty,setDirty] = useState(false)
  const [discard,setDiscard] = useState(false)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState("")
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError("")
    const form = new FormData(event.currentTarget)
    try {
      if (action === "create" || action === "stamp") {
        form.set("action",action+"-seal"); form.set("matterId",matterId)
        if (row) form.set("id",row.id)
        await readPersonal(workspaceEndpoint,{ method:"POST", body:form })
      } else {
        await readPersonal(workspaceEndpoint,{ method:"POST", headers:{ "Content-Type":"application/json" },body:JSON.stringify({
          action:action+"-seal",matterId,data:{ id:row?.id,...(action === "approve" ? { note:form.get("note") } : action === "reject" ? { reason:form.get("note") } : {}) },
        }) })
      }
      saved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "登记失败。") } finally { setBusy(false) }
  }
  return <Sheet open onOpenChange={open => { if (!open && !busy) { if (dirty) setDiscard(true); else close() } }}>
    <SheetContent className="overflow-y-auto motion-reduce:transition-none"><SheetHeader><SheetTitle>{labels[action]}</SheetTitle></SheetHeader>
      <form className="grid gap-3 px-4 pb-4 text-sm" onSubmit={save} onChange={() => { setDirty(true); setDiscard(false) }}>
        {row && <p>{row.documentTitle} · {row.code}</p>}
        <fieldset className="grid gap-2" disabled={busy}>
          {action === "create" && <>
            <label className="grid gap-1">印章<NativeSelect name="sealType" required value={type} onChange={e => setType(e.target.value)}><NativeSelectOption value="">选择印章</NativeSelectOption>
              {data.types.filter(t => data.purposes.some(p => p.allowedSealTypes.includes(t.type))).map(t => <NativeSelectOption key={t.type} value={t.type}>{t.label}</NativeSelectOption>)}</NativeSelect></label>
            <label className="grid gap-1">用章事项<NativeSelect key={type} name="purposeConfigId" required defaultValue=""><NativeSelectOption value="">选择事项</NativeSelectOption>
              {data.purposes.filter(p => p.allowedSealTypes.includes(type)).map(p => <NativeSelectOption key={p.id} value={p.id}>{p.name}</NativeSelectOption>)}</NativeSelect></label>
            <label className="grid gap-1">文书名称<Input required name="documentTitle" maxLength={200} /></label>
            <label className="grid gap-1">用印事由<Input required name="purpose" maxLength={60} /></label>
            <label className="grid gap-1">每份页数<Input required type="number" min={1} defaultValue={1} name="pageCount"/></label>
            <label className="grid gap-1">份数<Input required type="number" min={1} defaultValue={1} name="copies"/></label>
            <label className="flex gap-2"><input type="checkbox" name="requireCrossPageSeal" value="true" />需要骑缝章</label>
            <label className="grid gap-1">待盖章 PDF<Input type="file" accept="application/pdf,.pdf" required name="draftDoc"/></label>
          </>}
          {action === "stamp" && <label className="grid gap-1">实际盖章后的扫描件（PDF）<Input type="file" accept="application/pdf,.pdf" required name="stampedDoc"/></label>}
          {(action === "approve" || action === "reject") && <label className="grid gap-1">{action === "approve" ? "本人确认意见" : "驳回原因"}<Textarea name="note" maxLength={500} required={action === "reject"} /></label>}
          <Button type="submit">{busy ? "正在保存…" : labels[action]}</Button>
        </fieldset>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {discard && <div role="alert">放弃未保存的用印登记？<div className="mt-2 flex gap-2"><Button type="button" size="sm" onClick={() => setDiscard(false)}>继续填写</Button><Button type="button" variant="outline" size="sm" onClick={close}>放弃修改</Button></div></div>}
      </form>
    </SheetContent>
  </Sheet>
}
