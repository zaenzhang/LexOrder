"use client"

import Link from "@/features/shell/workspace-link"
import { FileTextIcon, PlusIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MatterFolder } from "./matter-folder"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { VolumeTools } from "./volume-tools"
import { MaterialVersionComparison } from "./material-version-comparison"
import { TaskMaterialReviewHistory, TaskMaterialReviewSheet, type ReviewContext } from "./task-material-review"
import type { TaskMaterialReviewContext } from "../../../../src/server/tasks/material-review-contract"
import { SkillInputPreview } from "./skill-input-preview"
import { MaterialBatch } from "./material-batch"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DataTable, type DataColumn } from "@/kit/data-table/data-table"
import { commissionItemLabels, readPersonal, workspaceEndpoint, type CommissionFollowUp, type CommissionIssue } from "./personal-client"

import { useWorkingCopies } from "./working-copies"
import { materialCategoryBatchLimit, type MaterialCatalogEntry } from "../../../../src/lib/documents/catalog"

export type MaterialFilters = { q: string; folder: string; version: string; category?: string; origin?: string }
export type MaterialStage = { id: string; name: string; procedureId: string }
export type Material = MaterialCatalogEntry
const originLabels: Record<string, string> = {
  CLIENT_PROVIDED: "当事人提供", COURT_SERVED: "法院送达", SELF_COLLECTED: "自行调取",
  TEAM_PRODUCED: "办案产出", AI_EXTRACTED: "自动识别",
}
const taskStateLabels = { OPEN: "待办", DONE: "已办结", CANCELLED: "已取消" }
const categories = [["EVIDENCE", "证据"], ["PLEADING", "诉讼文书"], ["PROCEDURE", "程序材料"], ["JUDGMENT", "裁判文书"], ["CONTRACT", "合同"], ["OTHER", "其他"]] as const

function download(material: Material, inline = false) {
  return "/api/documents/" + material.id + "/download" + (inline ? "?inline=1" : "")
}

function previewPath(material: Material) {
  const mime = material.mimeType ?? ""
  if (mime === "application/pdf" || mime === "text/plain" || /^image\/(png|jpe?g|gif|webp)$/.test(mime)) return download(material, true)
  if (mime.includes("wordprocessingml") || mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") {
    return "/api/documents/" + material.id + "/preview"
  }
}

export function MaterialsWorkspace({ matterId, stage, task, canOrganize, reviewId, commissionResearchId, commissionIssue, commissionFollowUp, documents, folders, filters, onFilter, onUploaded, selection, hasReadOnlySelection, onSelectionChange, openUpload, factAnalysis, pageNavigation }: {
  selection: string[]; hasReadOnlySelection: boolean; onSelectionChange: (ids: string[]) => void; filters: MaterialFilters; onFilter: (filters: MaterialFilters) => void;
  canOrganize: boolean; matterId: string; stage?: MaterialStage; task?: TaskMaterialReviewContext; reviewId?: string; commissionResearchId?: string; commissionIssue?: CommissionIssue; commissionFollowUp?: CommissionFollowUp;
  documents: Material[]; folders: { id: string; name: string }[]; onUploaded: () => void; openUpload?: boolean; factAnalysis?: boolean; pageNavigation?: React.ReactNode
}) {
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
  const [versionsOf, setVersionsOf] = useState<Material | [string, string]>()
  const [skillInput, setSkillInput] = useState<string[]>()
  const [reviewDocuments, setReviewDocuments] = useState<string[]>()
  const [historyRecord, setHistoryRecord] = useState(reviewId ?? null)
  const [historyOpen, setHistoryOpen] = useState(!!reviewId)
  const canRecord = task?.reviewRevision != null
  const reviewContext: ReviewContext | undefined = task && {
    matterId, task, onSaved: id => {
      setReviewDocuments(undefined)
      setVersionsOf(undefined)
      setHistoryRecord(id)
      setNotice("核对意见已保存。")
    },
  }
  const closePreview = useRef<HTMLButtonElement>(null)
  const materialSearch = useRef<HTMLInputElement>(null)
  const [uploadOpen, setUploadOpen] = useState(Boolean(openUpload))
  const [readingId, setReadingId] = useState("")
  const reading = documents.find(item => item.id === readingId) ?? documents[0]
  const readingPath = reading ? previewPath(reading) : undefined
  const showCategoryAction = canOrganize && !task && !commissionIssue && !commissionResearchId && !commissionFollowUp && !factAnalysis
  const [file, setFile] = useState<File>()
  const [name, setName] = useState("")
  const [category, setCategory] = useState("OTHER")
  const [requestKey, setRequestKey] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const columns: DataColumn<Material>[] = [
    { id: "name", header: "材料名称", cell: item => <Button variant="ghost" size="sm"
      aria-pressed={reading?.id === item.id} className="h-auto justify-start whitespace-normal px-2 py-1 text-start" onClick={() => setReadingId(item.id)}>
      <span className="grid min-w-0 gap-0.5"><span className="break-words font-medium">{item.name}</span>
        <span className="text-xs font-normal text-muted-foreground">V{item.version}{item.isLatest ? "" : " · 历史版本"} · {categories.find(([value]) => value === item.category)?.[1]}</span></span></Button> },
    { id: "origin", header: "来源", cell: item => <span className="whitespace-nowrap text-xs text-muted-foreground">{originLabels[item.sourceOrigin ?? ""] ?? "未登记"}</span> },
  ]

  function workingActions(item: Material) {
    return <div className="flex flex-wrap items-center gap-2">
      {item.editable && <Button size="sm" variant="outline" disabled={busy} onClick={() => edit({ action: "open", matterId, documentId: item.id })}>用默认编辑器打开</Button>}
      {mine.filter(copy => copy.id === item.id).map(copy => <div key={copy.sessionId} className="flex flex-wrap items-center gap-2">
        <span role="status" className="text-xs text-muted-foreground">{offline ? "运行时断开，工作稿保留在本机" : copy.message || "工作稿已同步 · V" + copy.version}</span>
        {copy.message && <Button variant="outline" size="sm" disabled={busy} onClick={() => edit({ action: "reopen", matterId, sessionId: copy.sessionId })}>打开本机稿</Button>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => edit({ action: "finish", matterId, sessionId: copy.sessionId, keepLocal: !!copy.message })}>{copy.message ? "保留本机稿并结束" : "结束编辑"}</Button>
      </div>)}
      <Button size="sm" variant="outline" onClick={() => setVersionsOf(item)}>详情 / 版本</Button>
      {previewPath(item) && <Button size="sm" variant="ghost" onClick={() => setPreview(item)}>放大原文</Button>}
      <Button nativeButton={false} variant="outline" size="sm" render={<a href={download(item)} download />}>下载此版本</Button>
    </div>
  }

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || pending) return
    const form = new FormData()
    form.set("file", file)
    form.set("name", name.trim())
    form.set("category", category)
    form.set("matterId", matterId)
    if (stage) {
      form.set("stageId", stage.id)
      form.set("procedureId", stage.procedureId)
    }
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
    <PageHeader title={task?.title ?? "案卷材料"} meta={task?.state && <Badge variant="secondary">{taskStateLabels[task.state]}</Badge>} description={task?.description || (!task && stage?.name)} actions={<>
      {task && <Button variant="outline" onClick={() => setHistoryOpen(true)}>核对记录</Button>}
      {factAnalysis && <Link className={buttonVariants({ variant: "outline" })} href={"/matters/" + matterId + "/evidence/graph"}>返回案情图谱</Link>}
      <Button variant="outline" nativeButton={false} render={<Link href={`/matters/${matterId}/court`} />}>法院来件</Button>
      <Sheet open={uploadOpen} onOpenChange={open => { if (!pending) { setUploadOpen(open); setError(""); if (!open) setFile(undefined) } }}>
        <SheetTrigger render={<Button />}><PlusIcon data-icon="inline-start" />添加材料</SheetTrigger>
        <SheetContent className="motion-reduce:transition-none">
          <SheetHeader><SheetTitle>上传材料</SheetTitle><SheetDescription>{stage ? "文件将归入「" + stage.name + "」环节。" : "文件将作为新材料归入当前案件。"}</SheetDescription></SheetHeader>
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
    </>} />
    {editorError && <p role="alert" className="text-sm text-destructive">{editorError}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {mine.filter(copy => !documents.some(item => item.id === copy.id)).map(copy =>
      <div key={copy.sessionId} className="flex flex-wrap items-center gap-2">
        <span className="text-sm">列表外的本机工作稿 · V{copy.version} · {copy.sessionId.slice(0, 8)}</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => edit({ action: "finish", matterId, sessionId: copy.sessionId, keepLocal: true })}>保留本机稿并结束</Button>
      </div>
    )}
    {commissionFollowUp && <p className="text-sm text-muted-foreground">补件复核 · {commissionItemLabels[commissionFollowUp.kind]}。勾选补件和本次需要核对的材料。</p>}
    <div className="grid min-w-0 items-stretch gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Card className="min-w-0 gap-3">
        <CardHeader><CardTitle className="text-lg">材料目录</CardTitle></CardHeader>
        <CardContent className="grid min-w-0 gap-3">
          <Tabs value={filters.version} onValueChange={version => onFilter({ ...filters, version })}>
            <TabsList aria-label="材料目录范围"><TabsTrigger value="all">{stage ? "全部版本" : "全卷材料"}</TabsTrigger><TabsTrigger value="latest">当前版本</TabsTrigger><TabsTrigger value="historical">历史版本</TabsTrigger></TabsList>
          </Tabs>
          <div className="grid gap-2 sm:grid-cols-[minmax(7rem,1.5fr)_minmax(5.5rem,1fr)_minmax(5.5rem,1fr)]">
            <Input ref={materialSearch} aria-label="搜索案内材料" placeholder="材料名称或标签" maxLength={200} value={filters.q} onChange={event => onFilter({ ...filters, q: event.target.value })} />
            <NativeSelect className="w-full" aria-label="筛选材料类别" value={filters.category ?? ""} onChange={event => onFilter({ ...filters, category: event.target.value })}>
              <NativeSelectOption value="">全部类别</NativeSelectOption>
              {categories.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
            </NativeSelect>
            <NativeSelect className="w-full" aria-label="筛选材料来源" value={filters.origin ?? ""} onChange={event => onFilter({ ...filters, origin: event.target.value })}>
              <NativeSelectOption value="">全部来源</NativeSelectOption>
              {Object.entries(originLabels).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="max-h-[23rem] min-w-0 overflow-auto [&_tr:has(button[aria-pressed=true])]:bg-accent/60">
            <DataTable columns={columns} rows={documents} getRowId={item => item.id} loading={false} sort={[]} onSortChange={() => {}} label="案内材料"
              selection={selection} onSelectionChange={onSelectionChange} onRowClick={item => setReadingId(item.id)}
              empty={<p className="text-sm text-muted-foreground">暂无符合条件的材料。</p>} />
          </div>
          {pageNavigation}
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="筛选案内卷宗" value={filters.folder} onChange={event => onFilter({ ...filters, folder: event.target.value })}>
              <NativeSelectOption value="*">全部卷宗</NativeSelectOption><NativeSelectOption value="">未分卷</NativeSelectOption>
              {folders.map(v => <NativeSelectOption key={v.id} value={v.id}>{v.name}</NativeSelectOption>)}
            </NativeSelect>
            {canOrganize && <VolumeTools matterId={matterId} folders={folders} documents={documents} refresh={onUploaded} />}
            <MaterialBatch key={matterId} matterId={matterId} stage={stage} categories={categories} onUploaded={onUploaded} />
          </div>
        </CardContent>
      </Card>
      <Card className="min-w-0 gap-3">
        <CardHeader>
          <p className="text-xs text-muted-foreground">原文预览</p>
          {reading && <><CardTitle className="break-words text-lg">{reading.name}</CardTitle>
            <p className="text-xs text-muted-foreground">V{reading.version} · {originLabels[reading.sourceOrigin ?? ""] ?? "来源未登记"}</p></>}
        </CardHeader>
        <CardContent className="flex min-h-80 grow flex-col bg-muted/50 p-3 sm:p-4">
          {readingPath
            ? <iframe key={readingPath} className="min-h-80 w-full grow rounded-md border bg-card" title="选中材料固定版本" src={readingPath} />
            : <div className="grid min-h-80 grow content-center justify-items-center gap-2 rounded-md border bg-card p-4 text-center text-sm text-muted-foreground">
              <FileTextIcon aria-hidden className="size-6" />
              <p>{reading ? "此文件可下载后查看原文。" : "选中一份材料可查看原文和固定版本。"}</p>
            </div>}
        </CardContent>
        {reading && <CardFooter className="items-start">{workingActions(reading)}</CardFooter>}
      </Card>
    </div>
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
      <p role="status" className="me-auto text-sm">已选 {selection.length} 份材料
        {(selection.length < 2 || (!task && selection.length > 2)) && " · 选择两份以并排核对"}
      </p>
      {showCategoryAction &&
        <MaterialCategorySheet matterId={matterId} selection={selection} search={materialSearch} hasReadOnlySelection={hasReadOnlySelection} onSaved={changed => {
          onSelectionChange([])
          setNotice(changed ? `已更新 ${changed} 份材料的类别。` : "所选材料已是该类别。")
          onFilter(filters)
          onUploaded()
        }} />}
      <Button size="sm" variant="outline" disabled={selection.length < 2 || (!task && selection.length > 2)}
        onClick={() => setVersionsOf([selection[0], selection[1]])}>并排核对</Button>
      {canRecord ? <Button size="sm" disabled={!selection.length || selection.length > task.reviewSourceLimit}
        onClick={() => setReviewDocuments([...selection])}>记录核对意见</Button>
        : !task && <Button size="sm" variant="outline" disabled={!selection.length || selection.length > 50} onClick={() => setSkillInput(selection)}>{factAnalysis ? "分段预检" : "委托材料预检"}</Button>}
      {selection.length > 0 && <Button size="sm" variant="ghost" onClick={() => onSelectionChange([])}>清空选材</Button>}
      {canRecord && selection.length > task.reviewSourceLimit && <p className="text-sm text-muted-foreground">每条意见最多引用 {task.reviewSourceLimit} 份材料。</p>}
      {showCategoryAction && hasReadOnlySelection &&
        <p className="text-sm text-muted-foreground">选材含历史或审核版本，移除后可更改类别。</p>}
      {!task && selection.length > 50 && <p className="text-sm text-muted-foreground">单次预检最多 50 份材料。</p>}
    </div>
    <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">案件文件夹</summary>
      <MatterFolder matterId={matterId} />
    </details>
    {versionsOf && <MaterialVersionComparison key={Array.isArray(versionsOf) ? versionsOf.join("/") : versionsOf.id}
      matterId={matterId} selection={versionsOf} reviewContext={reviewContext}
      comparisonPool={task && Array.isArray(versionsOf) && selection.length <= task.reviewSourceLimit ? selection : undefined}
      close={() => setVersionsOf(undefined)} />}
    {reviewContext && reviewDocuments && <TaskMaterialReviewSheet context={reviewContext} documents={reviewDocuments} onClose={() => setReviewDocuments(undefined)} />}
    {task && historyOpen && <TaskMaterialReviewHistory matterId={matterId} task={task} initialRecord={historyRecord} onClose={() => setHistoryOpen(false)} />}
    {skillInput && <SkillInputPreview matterId={matterId} factAnalysis={factAnalysis} researchId={commissionResearchId} issue={commissionIssue} followUp={commissionFollowUp} documentIds={skillInput} close={() => setSkillInput(undefined)} />}
    <Sheet open={!!preview} onOpenChange={open => { if (!open) setPreview(undefined) }}>
      <SheetContent initialFocus={closePreview} showCloseButton={false} className="data-[side=right]:w-full data-[side=right]:sm:max-w-[60rem] motion-reduce:transition-none">
        {preview && <>
          <SheetHeader><SheetTitle className="pe-8">{preview.name}</SheetTitle><SheetDescription>第 {preview.version} 版</SheetDescription></SheetHeader>
          <SheetClose render={<Button ref={closePreview} variant="ghost" size="icon-sm" className="absolute end-3 top-3" aria-label="关闭原文预览" />}><XIcon /></SheetClose>
          <iframe className="mx-4 min-h-0 flex-1 rounded-md border" title="案内材料原文" src={previewPath(preview)} />
          <div className="px-4 pb-4"><Button nativeButton={false} variant="outline" render={<a href={download(preview)} download />}>下载此版本</Button></div>
        </>}
      </SheetContent>
    </Sheet>
  </div>
}

function MaterialCategorySheet({ matterId, selection, search, hasReadOnlySelection, onSaved }: {
  matterId: string
  selection: string[]
  search: React.RefObject<HTMLInputElement | null>
  hasReadOnlySelection: boolean
  onSaved: (changed: number) => void
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [category, setCategory] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const limit = materialCategoryBatchLimit
  const saved = useRef(false)

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!category || busy) return
    setBusy(true)
    setError("")
    try {
      const { changed } = await readPersonal<{ changed: number }>(workspaceEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change-material-category", matterId, documentIds: selectedIds, category }),
      })
      saved.current = true
      setSelectedIds([])
      onSaved(changed)
    } catch (err) {
      setError(err instanceof Error ? err.message : "材料归类失败。")
    } finally {
      setBusy(false)
    }
  }

  return selection.length > limit
    ? <p className="text-sm text-muted-foreground">每次最多归类 {limit} 份材料。</p>
    : <Sheet open={selectedIds.length > 0} onOpenChange={open => {
      if (busy) return
      setError("")
      setCategory("")
      if (open) saved.current = false
      setSelectedIds(open ? [...selection] : [])
    }}>
      <SheetTrigger render={<Button size="sm" variant="outline" disabled={!selection.length || hasReadOnlySelection} />}>更改类别</SheetTrigger>
      <SheetContent finalFocus={() => saved.current ? search.current : true}>
        <SheetHeader>
          <SheetTitle>更改材料类别</SheetTitle>
          <SheetDescription>将更新已勾选的 {selectedIds.length} 份材料（含其他页）。仅可更改本案当前草稿版本的目录类别。</SheetDescription>
        </SheetHeader>
        <form className="grid gap-4" onSubmit={save}>
          <div className="grid gap-2 px-4 text-sm">
            <label id="material-category-label">目标类别</label>
            <Select
              items={categories.map(([value, label]) => ({ value, label }))}
              value={category || null}
              onValueChange={value => setCategory(value ?? "")}
              disabled={busy}
            >
              <SelectTrigger aria-labelledby="material-category-label" className="w-full">
                <SelectValue placeholder="选择类别" />
              </SelectTrigger>
              <SelectContent>
                {categories.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <SheetFooter>
            <SheetClose render={<Button type="button" variant="outline" disabled={busy} />}>取消</SheetClose>
            <Button type="submit" disabled={busy || !category}>{busy ? "正在保存…" : "保存类别"}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
}
