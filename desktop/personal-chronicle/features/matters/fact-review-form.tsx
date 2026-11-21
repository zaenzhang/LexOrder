"use client"

import { useRouter } from "@/kit/framework"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { evidenceEndpoint, readPersonal } from "./personal-client"
import type { Issue } from "./evidence-review"

export function FactReviewForm({ matterId, issue, current, onReload, onClose }: {
  matterId: string; issue: Issue; current?: Issue; onReload: () => Promise<Issue[]>; onClose: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const router = useRouter()
  const [request, setRequest] = useState(() => ({ requestKey: crypto.randomUUID(), researchedAt: new Date().toISOString() }))
  const [basis, setBasis] = useState(issue)
  const [sourceId, setSourceId] = useState("")
  const [change, setChange] = useState("")
  const editable = current?.canEdit && !current.restricted
  const sources = basis.sources.filter(source => !source.legacy && source.status === "AVAILABLE" && source.relation)

  async function refreshBasis() {
    setSaving(true)
    setError("")
    try {
      const fresh = await onReload()
      const next = fresh.find(row => row.id === issue.id)
      if (!next || !next.canEdit || next.restricted) {
        setSourceId("")
        return
      }
      setBasis(next)
      if (!next.sources.some(row => row.id === sourceId && row.status === "AVAILABLE")) setSourceId("")
      if (next.revision !== basis.revision || next.confirmedAt !== basis.confirmedAt) {
        setChange(`已重读 V${next.revision}，请核对当前记载后再保存。`)
        setRequest({ requestKey: crypto.randomUUID(), researchedAt: new Date().toISOString() })
      } else setChange("所见争点仍为当前修订。")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法重读争点。") }
    finally { setSaving(false) }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !editable) return
    const fields = new FormData(event.currentTarget)
    setSaving(true)
    setError("")
    try {
      const result = await readPersonal<{ id: string }>(evidenceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-fact-review", matterId, evidenceItemId: issue.id,
          revision: basis.revision, confirmedAt: basis.confirmedAt, ...request,
          sourceId, value: fields.get("value"), reason: fields.get("reason") }),
      })
      onClose()
      router.push(`/matters/${matterId}/research/${result.id}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存研究修订。") }
    finally { setSaving(false) }
  }

  return <Sheet open onOpenChange={next => { if (!next && !saving) { if (dirty) setDiscard(true); else onClose() } }}>
    <SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>记录本版争点的取舍</SheetTitle></SheetHeader>
      <form className="grid gap-4 px-4 pb-4 text-sm" onSubmit={save} onChange={() => {
        setDirty(true); setDiscard(false); setError("")
      }}>
        <fieldset disabled={saving} className="grid gap-3">
          {editable && change && <div role="status"><p>{change}</p><p className="whitespace-pre-wrap">{basis.content}</p></div>}
          {editable ? <label className="grid gap-1">本次采用的出处<NativeSelect name="source" required value={sourceId} onChange={event => setSourceId(event.target.value)}>
            <NativeSelectOption value="" disabled>选择具体材料和位置</NativeSelectOption>
            {sources.map(source => <NativeSelectOption key={source.id} value={source.id}>
              {source.relation === "REBUTS" ? "反证" : source.relation === "SUPPORTS" ? "支持" : "背景"} · {source.documentName} · V{source.documentVersion} · {source.locationLabel}
            </NativeSelectOption>)}
          </NativeSelect></label> : <p role="status">当前争点已不可编辑，可复制下方已填写的内容。</p>}
          <label className="grid gap-1">采用值<Textarea name="value" readOnly={!editable} required maxLength={2000} /></label>
          <label className="grid gap-1">采用理由<Textarea name="reason" readOnly={!editable} required maxLength={3000} /></label>
          {editable && <Button type="submit">{saving ? "保存中…" : "确认取舍并保存研究修订"}</Button>}
        </fieldset>
        {error && <div role="alert"><p className="text-destructive">{error}</p><Button type="button" disabled={saving} variant="outline" onClick={() => void refreshBasis()}>重读争点并保留输入</Button></div>}
        {discard && <div role="alert">放弃本次取舍？
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setDiscard(false)}>保留输入</Button>
            <Button type="button" variant="ghost" onClick={onClose}>放弃修改</Button></div>
        </div>}
      </form>
    </SheetContent>
  </Sheet>
}
