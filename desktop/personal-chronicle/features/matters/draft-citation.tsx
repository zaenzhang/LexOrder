"use client"

import Link from "@/features/shell/workspace-link"
import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { readPersonal, workspaceEndpoint } from "./personal-client"

type Draft = { id: string; name: string; version: number }
type Paragraph = { position: number; text: string; canReplace: boolean }
type DraftPreview = { document: Draft; research: { version: number; checked: boolean; conclusion: string }; paragraphs: Paragraph[] }
type Saved = { id: string; version: number }

export function DraftCitation({ matterId, researchId, disabled }: { matterId: string; researchId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<Saved>()
  return <Sheet open={open} onOpenChange={(next, details) => {
    if (busy) { details.cancel(); return }
    setOpen(next)
    if (next) setSaved(undefined)
  }}>
    <SheetTrigger render={<Button variant="outline" disabled={disabled} />}>引用到现有工作稿</SheetTrigger>
    <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
      <SheetHeader className="pe-12">
        <SheetTitle>引用研究结论</SheetTitle>
        <SheetDescription>选择当前 DOCX 工作稿和正文段落，核对后保存为同一文书的新版本。</SheetDescription>
      </SheetHeader>
      {saved ? <div className="grid gap-3 px-4 pb-4">
        <p role="status">已保存为 V{saved.version}。</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href={`/matters/${matterId}/delivery/${saved.id}`} />}>查看 V{saved.version} 审阅与交付</Button>
          <Button variant="outline" nativeButton={false} render={<a download href={`/api/documents/${saved.id}/download`} />}>下载 V{saved.version}</Button>
        </div>
      </div> : open && <CitationForm matterId={matterId} researchId={researchId} busy={busy} setBusy={setBusy} onSaved={setSaved} />}
    </SheetContent>
  </Sheet>
}

function CitationForm({ matterId, researchId, busy, setBusy, onSaved }: {
  matterId: string; researchId: string; busy: boolean; setBusy: (busy: boolean) => void; onSaved: (saved: Saved) => void;
}) {
  const [cursor, setCursor] = useState("")
  const [draftId, setDraftId] = useState("")
  const [query, setQuery] = useState("")
  const [position, setPosition] = useState(0)
  const [mode, setMode] = useState<"AFTER" | "REPLACE">("AFTER")
  const [error, setError] = useState("")
  const requestKey = useRef<string | null>(null)
  const choices = useQuery({
    queryKey: ["chronicle", "citation-drafts", matterId, cursor],
    queryFn: ({ signal }) => readPersonal<{ items: Draft[]; next: string | null }>("/api/personal/document-review?" +
      new URLSearchParams({ matter: matterId, citationDrafts: "1", ...(cursor ? { before: cursor } : {}) }), { signal }),
    retry: false,
  })
  const preview = useQuery({
    enabled: Boolean(draftId),
    queryKey: ["chronicle", "citation-paragraphs", matterId, researchId, draftId],
    queryFn: ({ signal }) => readPersonal<DraftPreview>(workspaceEndpoint + "?" +
      new URLSearchParams({ matter: matterId, section: "draft-citation", research: researchId, document: draftId }), { signal }),
    retry: false,
  })
  const anchor = preview.data?.paragraphs.find(row => row.position === position)
  const matching = preview.data?.paragraphs.filter(row => !query || String(row.position) === query.trim() || row.text.toLowerCase().includes(query.toLowerCase())) ?? []
  const visible = matching.slice(0, 80)
  const options = anchor && !visible.includes(anchor) ? [anchor, ...visible] : visible
  const conclusion = preview.data?.research.conclusion.replace(/\r\n?/g, "\n")
  const sameText = mode === "REPLACE" && anchor?.text === conclusion

  function chooseDraft(id: string) {
    setDraftId(id); setQuery(""); setPosition(0); setMode("AFTER"); setError(""); requestKey.current = null
  }

  async function save() {
    if (!preview.data || !anchor || sameText || busy || (mode === "REPLACE" && !anchor.canReplace)) return
    setError("")
    setBusy(true)
    requestKey.current ??= crypto.randomUUID()
    try {
      onSaved(await readPersonal<Saved>(workspaceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-draft-citation", data: {
          matterId, documentId: preview.data.document.id, researchRevisionId: researchId,
          expectedVersion: preview.data.document.version, position, mode, requestKey: requestKey.current,
        } }),
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存工作稿失败。")
    } finally {
      setBusy(false)
    }
  }

  return <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void save() }}>
    <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
      <fieldset className="grid gap-3" disabled={busy}>
        {choices.isPending && <p role="status">正在读取工作稿…</p>}
        {choices.error && <p role="alert">{choices.error.message} <Button type="button" size="sm" variant="outline" onClick={() => void choices.refetch()}>重试</Button></p>}
        {choices.data && <label className="grid gap-1">DOCX 工作稿
          <NativeSelect className="w-full" value={draftId} onChange={event => chooseDraft(event.target.value)}>
            <NativeSelectOption value="">{choices.data.items.length ? "选择工作稿" : "本页没有可引用的工作稿"}</NativeSelectOption>
            {choices.data.items.map(doc => <NativeSelectOption key={doc.id} value={doc.id}>{doc.name} · V{doc.version}</NativeSelectOption>)}
          </NativeSelect>
        </label>}
        {(cursor || choices.data?.next) && <div className="flex gap-2">
          {cursor && <Button type="button" size="sm" variant="outline" onClick={() => { chooseDraft(""); setCursor("") }}>第一页</Button>}
          {choices.data?.next && <Button type="button" size="sm" variant="outline" onClick={() => { chooseDraft(""); setCursor(choices.data!.next!) }}>下一页</Button>}
        </div>}
        {draftId && preview.isPending && <p role="status">正在读取正文段落…</p>}
        {preview.error && <p role="alert">{preview.error.message} <Button type="button" size="sm" variant="outline" onClick={() => void preview.refetch()}>重试</Button></p>}
        {preview.data && <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>研究 V{preview.data.research.version} · {preview.data.research.checked ? "已核对" : "待核对"}</span>
            <a className="underline" download href={`/api/documents/${preview.data.document.id}/download`}>下载原稿 V{preview.data.document.version}</a>
          </div>
          {!preview.data.paragraphs.length ? <p>此工作稿没有可用的正文段落。可以在本机编辑器中添加正文。</p> : <>
            <label className="grid gap-1">查找正文段落<Input value={query} onChange={event => setQuery(event.target.value)} placeholder="段落编号或正文关键词" /></label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <label className="grid min-w-0 gap-1">正文段落
                <NativeSelect className="w-full" value={position} onChange={event => {
                  setPosition(Number(event.target.value)); setMode("AFTER"); setError(""); requestKey.current = null
                }}>
                  <NativeSelectOption value={0}>{matching.length ? "请选择正文段落" : "没有匹配段落"}</NativeSelectOption>
                  {options.map(row => <NativeSelectOption key={row.position} value={row.position}>第 {row.position} 段 · {row.text.trim().replace(/\s+/g, " ").slice(0, 65) || "空白或非文字内容"}</NativeSelectOption>)}
                </NativeSelect>
              </label>
              <label className="grid gap-1">写入方式
                <NativeSelect className="w-full" value={mode} disabled={!anchor} onChange={event => {
                  setMode(event.target.value === "REPLACE" ? "REPLACE" : "AFTER"); setError(""); requestKey.current = null
                }}>
                  <NativeSelectOption value="AFTER">在段后插入</NativeSelectOption>
                  <NativeSelectOption value="REPLACE" disabled={!anchor?.canReplace}>替换本段</NativeSelectOption>
                </NativeSelect>
              </label>
            </div>
            {matching.length > visible.length && <p className="text-xs text-muted-foreground">共 {matching.length} 段，显示前 {visible.length} 段。可按段号或正文定位其余段落。</p>}
            {anchor && <>
              {!anchor.canReplace && <p className="text-xs text-muted-foreground">本段含复杂格式，可在段后插入。</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <section className="min-w-0 rounded-lg border p-3">
                  <h3 className="font-medium">原稿 · 第 {position} 段</h3>
                  <p className="mt-2 whitespace-pre-wrap break-words">{anchor.text || "此段无可显示文字"}</p>
                </section>
                <section className="min-w-0 rounded-lg border p-3">
                  <h3 className="font-medium">{mode === "AFTER" ? `插入位置 · 第 ${position} 段后` : `替换后 · 第 ${position} 段`}</h3>
                  <p className="mt-2 whitespace-pre-wrap break-words">{conclusion}</p>
                </section>
              </div>
              {sameText && <p role="status">结论与原段落相同。</p>}
            </>}
          </>}
        </>}
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </div>
    <SheetFooter className="border-t">
      <Button type="submit" disabled={busy || !anchor || Boolean(preview.error) || sameText}>{busy ? "正在保存…" : "确认并保存新版本"}</Button>
    </SheetFooter>
  </form>
}
