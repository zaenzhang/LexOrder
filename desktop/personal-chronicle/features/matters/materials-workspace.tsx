"use client"

import { EyeIcon, PlusIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { VolumeTools } from "./volume-tools"
import { MaterialBatch } from "./material-batch"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { DataTable, type DataColumn } from "@/kit/data-table/data-table"
import { materialUrl, readPersonal, workspaceEndpoint } from "./personal-client"

import { useWorkingCopies } from "./working-copies"

export type MaterialFilters = { q: string; folder: string; version: string }
export type Material = { folderId?: string | null; id: string; name: string; version: number; isLatest: boolean; editable: boolean; mimeType: string | null }
const categories = [["EVIDENCE", "证据"], ["PLEADING", "诉讼文书"], ["PROCEDURE", "程序材料"], ["JUDGMENT", "裁判文书"], ["CONTRACT", "合同"], ["OTHER", "其他"]] as const

function download(material: Material, inline = false) {
  return materialUrl("/api/documents/" + material.id + "/download" + (inline ? "?inline=1" : ""))
}

export function MaterialsWorkspace({ matterId, documents, folders, filters, onFilter, onUploaded }: { filters: MaterialFilters; onFilter: (filters: MaterialFilters) => void; matterId: string; documents: Material[]; folders: {id:string;name:string}[]; onUploaded: () => void }) {
  const { copies, offline, act } = useWorkingCopies()
  const [asDraft, setAsDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editorError, setEditorError] = useState("")
  const lastReceipt = useRef("")
  const mine = copies.filter(copy => copy.matterId === matterId)
  const receipts = mine.map(copy => copy.sessionId + "/" + copy.id + "/" + (copy.message ?? "")).join("|")
  useEffect(() => {
    if (receipts !== lastReceipt.current) { lastReceipt.current = receipts; onUploaded() }
  }, [receipts, onUploaded])

  async function edit(input: Parameters<typeof act>[0]) {
    setBusy(true)
    setEditorError("")
    try { await act(input) } catch (err) { setEditorError(err instanceof Error ? err.message : "工作稿请求失败。") } finally { setBusy(false) }
  }
  const [preview, setPreview] = useState<Material>()
  const closePreview = useRef<HTMLButtonElement>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [file, setFile] = useState<File>()
  const [name, setName] = useState("")
  const [category, setCategory] = useState("OTHER")
  const [requestKey, setRequestKey] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const columns: DataColumn<Material>[] = [
    { id: "name", header: "材料名称", cell: item => <span className="font-medium">{item.name}</span> },
    { id: "version", header: "版本", cell: item => <span className="num">V{item.version}</span> },
    { id: "status", header: "状态", cell: item => <Badge variant={item.isLatest ? "secondary" : "outline"}>{item.isLatest ? "当前版本" : "历史版本"}</Badge> },
    { id: "actions", header: "操作", cell: item => <div className="flex flex-wrap gap-2">
      {item.editable && <Button size="sm" variant="outline" disabled={busy} onClick={() => edit({ action: "open", matterId, documentId: item.id })}>用默认编辑器打开</Button>}
      {mine.filter(copy => copy.id === item.id).map(copy => <div key={copy.sessionId} className="flex flex-wrap items-center gap-2">
        <span role="status" className="text-xs text-muted-foreground">{offline ? "运行时断开，工作稿保留在本机" : copy.message || "工作稿已同步 · V" + copy.version}</span>
        {copy.message && <Button variant="outline" size="sm" disabled={busy} onClick={() => edit({ action: "reopen", matterId, sessionId: copy.sessionId })}>打开本机稿</Button>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => edit({ action: "finish", matterId, sessionId: copy.sessionId, keepLocal: !!copy.message })}>{copy.message ? "保留本机稿并结束" : "结束编辑"}</Button>
      </div>)}
      {item.mimeType === "application/pdf" && <Button variant="ghost" size="sm" onClick={() => setPreview(item)}><EyeIcon data-icon="inline-start" />查看 PDF</Button>}
      <Button nativeButton={false} variant="outline" size="sm" render={<a href={download(item)} download />}>下载此版本</Button>
    </div> },
  ]

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || pending) return
    const form = new FormData()
    form.set("file", file)
    form.set("name", name.trim())
    form.set("category", category)
    form.set("matterId", matterId)
    if (asDraft) form.set("sourceOrigin", "TEAM_PRODUCED")
    form.set("requestKey", requestKey || crypto.randomUUID())
    setRequestKey(String(form.get("requestKey")))
    setPending(true)
    setError("")
    try {
      await readPersonal(workspaceEndpoint, { method: "POST", body: form })
      setNotice("材料已入卷。")
      setUploadOpen(false)
      setFile(undefined)
      setAsDraft(false)
      setName("")
      setCategory("OTHER")
      setRequestKey("")
      onFilter({ q:"", folder:"*", version:"all" })
      onUploaded()
    } catch (error) {
      setError(error instanceof Error ? error.message : "上传失败。")
    } finally {
      setPending(false)
    }
  }

  return <div className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-center gap-2">
      <Input className="max-w-xs" aria-label="搜索案内材料" placeholder="搜索材料名称" maxLength={200} value={filters.q} onChange={event => onFilter({...filters,q:event.target.value})} />
      <NativeSelect aria-label="筛选材料版本" value={filters.version} onChange={event => onFilter({...filters,version:event.target.value})}>
        <NativeSelectOption value="all">全部版本</NativeSelectOption><NativeSelectOption value="latest">当前版本</NativeSelectOption><NativeSelectOption value="historical">历史版本</NativeSelectOption>
      </NativeSelect>
      <NativeSelect aria-label="筛选案内卷宗" value={filters.folder} onChange={event=>onFilter({...filters,folder:event.target.value})}>
        <NativeSelectOption value="*">全部卷宗</NativeSelectOption><NativeSelectOption value="">未分卷</NativeSelectOption>
        {folders.map(v=><NativeSelectOption key={v.id} value={v.id}>{v.name}</NativeSelectOption>)}
      </NativeSelect>
      <VolumeTools matterId={matterId} folders={folders} documents={documents} refresh={onUploaded}/>
      <MaterialBatch key={matterId} matterId={matterId} categories={categories} onUploaded={onUploaded} />
      <Sheet open={uploadOpen} onOpenChange={open => { if (!pending) { setUploadOpen(open); setError(""); if (!open) setFile(undefined) } }}>
        <SheetTrigger render={<Button className="ms-auto" />}><PlusIcon data-icon="inline-start" />上传材料</SheetTrigger>
        <SheetContent className="motion-reduce:transition-none">
          <SheetHeader><SheetTitle>上传材料</SheetTitle><SheetDescription>文件将作为新材料归入当前案件。</SheetDescription></SheetHeader>
          <form className="grid gap-4 px-4" onSubmit={upload}>
            <label className="grid gap-2 text-sm">文件<Input type="file" required disabled={pending} onChange={event => {
              const selected = event.target.files?.[0]
              setAsDraft(false); setFile(selected); setName(selected?.name ?? ""); setRequestKey("")
            }} /></label>
            <label className="grid gap-2 text-sm">材料名称<Input required maxLength={255} disabled={pending} value={name} onChange={event => { setName(event.target.value); setRequestKey("") }} /></label>
            <label className="grid gap-2 text-sm">分类<NativeSelect disabled={pending} value={category} onChange={event => { setCategory(event.target.value); setRequestKey("") }}>
              {categories.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
            </NativeSelect></label>
            {file && /\.(?:docx?|xlsx?|pptx?|txt)$/i.test(file.name) && <label className="flex items-center gap-2 text-sm"><Checkbox checked={asDraft} disabled={pending} onCheckedChange={value => { setAsDraft(value); setRequestKey("") }} />作为本案工作稿</label>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending || !file || !name.trim()}>{pending ? "正在上传…" : "上传并入卷"}</Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
    {editorError && <p role="alert" className="text-sm text-destructive">{editorError}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {mine.filter(copy => !documents.some(item => item.id === copy.id)).map(copy =>
      <div key={copy.sessionId} className="flex flex-wrap items-center gap-2">
        <span className="text-sm">列表外的本机工作稿 · V{copy.version} · {copy.sessionId.slice(0, 8)}</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => edit({ action: "finish", matterId, sessionId: copy.sessionId, keepLocal: true })}>保留本机稿并结束</Button>
      </div>
    )}
    <DataTable columns={columns} rows={documents} getRowId={item => item.id} loading={false} sort={[]} onSortChange={() => {}} label="案内材料"
      empty={<p className="text-sm text-muted-foreground">{documents.length ? "没有匹配的材料。" : "暂无可查看的材料。"}</p>} />
    <Sheet open={!!preview} onOpenChange={open => { if (!open) setPreview(undefined) }}>
      <SheetContent initialFocus={closePreview} showCloseButton={false} className="w-[min(100%,60rem)] sm:max-w-none motion-reduce:transition-none">
        {preview && <>
          <SheetHeader><SheetTitle className="pe-8">{preview.name}</SheetTitle><SheetDescription>第 {preview.version} 版</SheetDescription></SheetHeader>
          <SheetClose render={<Button ref={closePreview} variant="ghost" size="icon-sm" className="absolute end-3 top-3" aria-label="关闭原文预览" />}><XIcon /></SheetClose>
          <iframe className="mx-4 min-h-0 flex-1 rounded-md border" title="案内材料原文" src={download(preview, true)} />
          <div className="px-4 pb-4"><Button nativeButton={false} variant="outline" render={<a href={download(preview)} download />}>下载此版本</Button></div>
        </>}
      </SheetContent>
    </Sheet>
  </div>
}
