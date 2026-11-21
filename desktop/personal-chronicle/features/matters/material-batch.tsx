"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { addBatchFiles, batchRows, clearCompletedRows, removeBatchRow, submitBatch, subscribeToBatch } from "./material-batch-queue"

import { materialUploadsEndpoint, PendingUploads } from "./pending-material-uploads"
import { readPersonal } from "./personal-client"
import type { PendingMaterialUploads } from "../../../../src/lib/documents/upload-contract"
import type { MaterialStage } from "./materials-workspace"

const stateNames = { waiting: "待入卷", sending: "正在入卷", done: "已入卷", failed: "入卷失败" }
type Props = { matterId: string; stage?: MaterialStage; categories: readonly (readonly [string, string])[]; onUploaded: () => void }

export function MaterialBatch({ matterId, stage, categories, onUploaded }: Props) {
  const rows = useSyncExternalStore(subscribeToBatch, () => batchRows(matterId), () => batchRows(""))
  const [category, setCategory] = useState("OTHER")
  const [open, setOpen] = useState(false)
  const [dropError, setDropError] = useState("")
  const completed = rows.filter(row => row.status === "done").length
  const pending = rows.filter(row => row.status === "waiting").length
  const failed = rows.filter(row => row.status === "failed").length
  const sending = rows.some(row => row.status === "sending")
  const unfinished = useQuery({
    queryKey: ["personal", "material-uploads", matterId],
    queryFn: ({ signal }) => readPersonal<PendingMaterialUploads>(materialUploadsEndpoint + "?" + new URLSearchParams({ matter: matterId }), { signal }),
    enabled: open,
    refetchInterval: query => query.state.data?.items.some(row => row.waiting) ? 15_000 : false,
  })
  const savedRows = unfinished.data?.items.filter(item => !rows.some(row => row.key === item.id)) ?? []
  async function submit(status: "waiting" | "failed", key?: string) {
    await submitBatch(matterId, status, key)
    await unfinished.refetch()
  }
  const prior = useRef(completed)
  useEffect(() => {
    if (completed > prior.current) onUploaded()
    prior.current = completed
  }, [completed, onUploaded])

  function queueFiles(files: File[]) {
    if (files.length) addBatchFiles(matterId, files, category, stage)
    setDropError("")
  }

  return <Sheet open={open} onOpenChange={value => {
    setOpen(value)
    if (!value) setDropError("")
  }}>
    <SheetTrigger render={<Button variant="outline" />}>批量导入</SheetTrigger>
    <SheetContent className="overflow-y-auto motion-reduce:transition-none">
      <SheetHeader><SheetTitle>批量导入材料</SheetTitle><SheetDescription>{stage ? "本次选取的文件将逐件归入「" + stage.name + "」环节。" : "文件将逐件归入当前案件。"}</SheetDescription></SheetHeader>
      <div className="grid gap-4 px-4 pb-4">
        {open && <>
          {unfinished.isLoading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />正在读取未完成上传</p>}
          {unfinished.isError && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-2">
            {unfinished.error.message} <Button variant="outline" size="sm" onClick={() => void unfinished.refetch()}>重试读取</Button>
          </AlertDescription></Alert>}
          <PendingUploads matterId={matterId} items={savedRows} hasMore={!!unfinished.data?.hasMore} onChange={saved => {
            void unfinished.refetch()
            if (saved) onUploaded()
          }} />
        </>}
        <label className="grid gap-2 text-sm">本次所选文件的分类
          <NativeSelect value={category} onChange={event => setCategory(event.target.value)}>
            {categories.map(([id, label]) => <NativeSelectOption key={id} value={id}>{label}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <label className="grid gap-2 rounded-md border border-dashed p-3 text-sm"
          onDragOver={event => {
            if (!event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
            event.dataTransfer.dropEffect = "copy"
          }}
          onDrop={event => {
            event.preventDefault()
            const { files, items } = event.dataTransfer
            if (Array.from(items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
              setDropError("请打开文件夹，再把要导入的文件拖到这里。")
              return
            }
            if (!files.length) {
              setDropError("没有收到可导入的文件。")
              return
            }
            queueFiles(Array.from(files))
          }}>
          选择文件或拖到这里
          <Input type="file" multiple onChange={event => {
            queueFiles(Array.from(event.currentTarget.files ?? []))
            event.currentTarget.value = ""
          }} />
        </label>
        {dropError && <p className="text-sm text-destructive" role="alert">{dropError}</p>}
        {!!rows.length && <>
          <p className="text-sm text-muted-foreground" role="status">已入卷 {completed} 件，待处理 {pending} 件，失败 {failed} 件</p>
          <ul className="divide-y" aria-label="逐件导入回执">{rows.map(row =>
            <li key={row.key} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1"><p className="break-all font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">{categories.find(([id]) => id === row.category)?.[1]} · {stateNames[row.status]}{row.stage ? " · " + row.stage.name : stage ? " · 全案" : ""}</p>
                {row.error && <p className="break-words text-xs text-destructive">{row.error}</p>}
              </div>
              {row.status === "failed" && <Button size="sm" variant="outline" disabled={sending} aria-label={"重试 " + row.name} onClick={() => void submit("failed", row.key)}>重试</Button>}
              {(row.status === "waiting" || row.status === "failed") && <Button size="sm" variant="ghost" disabled={sending} aria-label={"移除 " + row.name} onClick={() => removeBatchRow(matterId, row.key)}>移除</Button>}
            </li>)}</ul>
          <div className="flex flex-wrap gap-2">
            {pending > 0 && <Button disabled={sending} onClick={() => void submit("waiting")}>导入待处理文件</Button>}
            {failed > 0 && <Button disabled={sending} variant="outline" onClick={() => void submit("failed")}>重试失败项</Button>}
            {completed > 0 && <Button disabled={sending} variant="ghost" onClick={() => clearCompletedRows(matterId)}>清除成功回执</Button>}
          </div>
        </>}
      </div>
    </SheetContent>
  </Sheet>
}
