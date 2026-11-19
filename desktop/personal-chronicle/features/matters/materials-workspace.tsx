"use client"

import { EyeIcon, PlusIcon, XIcon } from "lucide-react"
import { useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { DataTable, type DataColumn } from "@/kit/data-table/data-table"
import { materialUrl, readPersonal, workspaceEndpoint } from "./personal-client"

export type Material = { id: string; name: string; version: number; isLatest: boolean; mimeType: string | null }
const categories = [["EVIDENCE", "证据"], ["PLEADING", "诉讼文书"], ["PROCEDURE", "程序材料"], ["JUDGMENT", "裁判文书"], ["CONTRACT", "合同"], ["OTHER", "其他"]] as const

function download(material: Material, inline = false) {
  return materialUrl("/api/documents/" + material.id + "/download" + (inline ? "?inline=1" : ""))
}

export function MaterialsWorkspace({ matterId, documents, onUploaded }: { matterId: string; documents: Material[]; onUploaded: () => void }) {
  const [search, setSearch] = useState("")
  const [version, setVersion] = useState("all")
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
  const rows = documents.filter(item => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    && (version === "all" || (version === "latest") === item.isLatest))
  const columns: DataColumn<Material>[] = [
    { id: "name", header: "材料名称", cell: item => <span className="font-medium">{item.name}</span> },
    { id: "version", header: "版本", cell: item => <span className="num">V{item.version}</span> },
    { id: "status", header: "状态", cell: item => <Badge variant={item.isLatest ? "secondary" : "outline"}>{item.isLatest ? "当前版本" : "历史版本"}</Badge> },
    { id: "actions", header: "操作", cell: item => <div className="flex flex-wrap gap-2">
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
    form.set("requestKey", requestKey || crypto.randomUUID())
    setRequestKey(String(form.get("requestKey")))
    setPending(true)
    setError("")
    try {
      await readPersonal(workspaceEndpoint, { method: "POST", body: form })
      setNotice("材料已入卷。")
      setUploadOpen(false)
      setFile(undefined)
      setName("")
      setCategory("OTHER")
      setRequestKey("")
      setSearch("")
      setVersion("all")
      onUploaded()
    } catch (error) {
      setError(error instanceof Error ? error.message : "上传失败。")
    } finally {
      setPending(false)
    }
  }

  return <div className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-center gap-2">
      <Input className="max-w-xs" aria-label="搜索案内材料" placeholder="搜索材料名称" value={search} onChange={event => setSearch(event.target.value)} />
      <NativeSelect aria-label="筛选材料版本" value={version} onChange={event => setVersion(event.target.value)}>
        <NativeSelectOption value="all">全部版本</NativeSelectOption><NativeSelectOption value="latest">当前版本</NativeSelectOption><NativeSelectOption value="historical">历史版本</NativeSelectOption>
      </NativeSelect>
      <Sheet open={uploadOpen} onOpenChange={open => { if (!pending) { setUploadOpen(open); setError(""); if (!open) setFile(undefined) } }}>
        <SheetTrigger render={<Button className="ms-auto" />}><PlusIcon data-icon="inline-start" />上传材料</SheetTrigger>
        <SheetContent className="motion-reduce:transition-none">
          <SheetHeader><SheetTitle>上传材料</SheetTitle><SheetDescription>文件将作为新材料归入当前案件。</SheetDescription></SheetHeader>
          <form className="grid gap-4 px-4" onSubmit={upload}>
            <label className="grid gap-2 text-sm">文件<Input type="file" required disabled={pending} onChange={event => {
              const selected = event.target.files?.[0]
              setFile(selected); setName(selected?.name ?? ""); setRequestKey("")
            }} /></label>
            <label className="grid gap-2 text-sm">材料名称<Input required maxLength={255} disabled={pending} value={name} onChange={event => { setName(event.target.value); setRequestKey("") }} /></label>
            <label className="grid gap-2 text-sm">分类<NativeSelect disabled={pending} value={category} onChange={event => { setCategory(event.target.value); setRequestKey("") }}>
              {categories.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
            </NativeSelect></label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending || !file || !name.trim()}>{pending ? "正在上传…" : "上传并入卷"}</Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    <DataTable columns={columns} rows={rows} getRowId={item => item.id} loading={false} sort={[]} onSortChange={() => {}} label="案内材料"
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
