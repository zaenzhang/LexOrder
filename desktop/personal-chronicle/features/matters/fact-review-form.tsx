"use client"

import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { evidenceEndpoint, readPersonal } from "./personal-client"

type Issue = {
  id: string; revision: number; content: string; canEdit: boolean; restricted: boolean; confirmedAt: string | null
  sources: { id: string; status: string; legacy?: boolean; documentName: string | null; documentVersion: number | null; locationLabel: string | null; relation: string | null }[]
}

export function FactReviewForm({ matterId, issue, onReload }: { matterId: string; issue: Issue; onReload: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const router = useRouter()
  const [request, setRequest] = useState<{ requestKey: string; researchedAt: string }>()
  const [basis, setBasis] = useState(issue)
  const [sourceId, setSourceId] = useState("")
  const [change, setChange] = useState("")
  const sources = (open ? basis : issue).sources.filter(source => !source.legacy && source.status === "AVAILABLE" && source.relation)
  if (!open && !sources.length) return null

  async function refreshBasis() {
    setSaving(true)
    setError("")
    try {
      const result = await readPersonal<{ issues: Issue[] }>(evidenceEndpoint + "?" + new URLSearchParams({ matter: matterId }))
      const next = result.issues.find(row => row.id === issue.id)
      if (!next || !next.canEdit || next.restricted) {
        setSourceId(""); setOpen(false); onReload(); return
      }
      if (next.revision !== basis.revision || next.confirmedAt !== basis.confirmedAt) {
        setChange(`已重读 V${next.revision}，请核对当前记载后再保存。`)
        setBasis(next)
        if (!next.sources.some(row => row.id === sourceId && row.status === "AVAILABLE")) setSourceId("")
        setRequest({ requestKey: crypto.randomUUID(), researchedAt: new Date().toISOString() })
      } else setChange("所见争点仍为当前修订。")
      onReload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法重读争点。") }
    finally { setSaving(false) }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !request) return
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
      setOpen(false)
      router.push(`/matters/${matterId}/research/${result.id}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存研究修订。") }
    finally { setSaving(false) }
  }

  return <>
    <Button size="sm" variant="outline" onClick={() => {
      setRequest({ requestKey: crypto.randomUUID(), researchedAt: new Date().toISOString() })
      setBasis(issue); setSourceId(""); setChange(""); setDirty(false); setDiscard(false); setError(""); setOpen(true)
    }}>记录取舍并形成研究</Button>
    {open && <Sheet open onOpenChange={next => { if (!next && !saving) { if (dirty) setDiscard(true); else setOpen(false) } }}>
      <SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>记录本版争点的取舍</SheetTitle></SheetHeader>
        <form className="grid gap-4 px-4 pb-4 text-sm" onSubmit={save} onChange={() => {
          setDirty(true); setDiscard(false); setError("")
        }}>
          <fieldset disabled={saving} className="grid gap-3">
            {change && <div role="status"><p>{change}</p><p className="whitespace-pre-wrap">{basis.content}</p></div>}
            <label className="grid gap-1">本次采用的出处<NativeSelect name="source" required value={sourceId} onChange={event => setSourceId(event.target.value)}>
              <NativeSelectOption value="" disabled>选择具体材料和位置</NativeSelectOption>
              {sources.map(source => <NativeSelectOption key={source.id} value={source.id}>
                {source.relation === "REBUTS" ? "反证" : source.relation === "SUPPORTS" ? "支持" : "背景"} · {source.documentName} · V{source.documentVersion} · {source.locationLabel}
              </NativeSelectOption>)}
            </NativeSelect></label>
            <label className="grid gap-1">采用值<Textarea name="value" required maxLength={2000} /></label>
            <label className="grid gap-1">采用理由<Textarea name="reason" required maxLength={3000} /></label>
            <Button type="submit">{saving ? "保存中…" : "确认取舍并保存研究修订"}</Button>
          </fieldset>
          {error && <div role="alert"><p className="text-destructive">{error}</p><Button type="button" disabled={saving} variant="outline" onClick={() => void refreshBasis()}>重读争点并保留输入</Button></div>}
          {discard && <div role="alert">放弃本次取舍？
            <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setDiscard(false)}>继续编辑</Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>放弃修改</Button></div>
          </div>}
        </form>
      </SheetContent>
    </Sheet>}
  </>
}
