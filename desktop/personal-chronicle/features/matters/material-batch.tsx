"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { addBatchFiles, batchRows, clearCompletedRows, removeBatchRow, submitBatch, subscribeToBatch } from "./material-batch-queue"

const stateNames = { waiting: "待入卷", sending: "正在入卷", done: "已入卷", failed: "入卷失败" }
type Props = { matterId: string; categories: readonly (readonly [string, string])[]; onUploaded: () => void }

export function MaterialBatch({ matterId, categories, onUploaded }: Props) {
  const rows = useSyncExternalStore(subscribeToBatch, () => batchRows(matterId), () => batchRows(""))
  const [category, setCategory] = useState("OTHER")
  const [open, setOpen] = useState(false)
  const completed = rows.filter(row => row.status === "done").length
  const pending = rows.filter(row => row.status === "waiting").length
  const failed = rows.filter(row => row.status === "failed").length
  const sending = rows.some(row => row.status === "sending")
  const prior = useRef(completed)
  useEffect(() => {
    if (completed > prior.current) onUploaded()
    prior.current = completed
  }, [completed, onUploaded])

  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger render={<Button variant="outline" />}>批量导入</SheetTrigger>
    <SheetContent className="overflow-y-auto motion-reduce:transition-none">
      <SheetHeader><SheetTitle>批量导入材料</SheetTitle><SheetDescription>文件将逐件归入当前案件。</SheetDescription></SheetHeader>
      <div className="grid gap-4 px-4 pb-4">
        <label className="grid gap-2 text-sm">本次所选文件的分类
          <NativeSelect value={category} onChange={event => setCategory(event.target.value)}>
            {categories.map(([id, label]) => <NativeSelectOption key={id} value={id}>{label}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <label className="grid gap-2 text-sm">选择文件
          <Input type="file" multiple onChange={event => {
            const files = Array.from(event.currentTarget.files ?? [])
            if (files.length) addBatchFiles(matterId, files, category)
            event.currentTarget.value = ""
          }} />
        </label>
        {!!rows.length && <>
          <p className="text-sm text-muted-foreground" role="status">已入卷 {completed} 件，待处理 {pending} 件，失败 {failed} 件</p>
          <ul className="divide-y" aria-label="逐件导入回执">{rows.map(row =>
            <li key={row.key} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1"><p className="break-all font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">{categories.find(([id]) => id === row.category)?.[1]} · {stateNames[row.status]}</p>
                {row.error && <p className="break-words text-xs text-destructive">{row.error}</p>}
              </div>
              {row.status === "failed" && <Button size="sm" variant="outline" disabled={sending} aria-label={"重试 " + row.name} onClick={() => void submitBatch(matterId, "failed", row.key)}>重试</Button>}
              {(row.status === "waiting" || row.status === "failed") && <Button size="sm" variant="ghost" disabled={sending} aria-label={"移除 " + row.name} onClick={() => removeBatchRow(matterId, row.key)}>移除</Button>}
            </li>)}</ul>
          <div className="flex flex-wrap gap-2">
            {pending > 0 && <Button disabled={sending} onClick={() => void submitBatch(matterId, "waiting")}>导入待处理文件</Button>}
            {failed > 0 && <Button disabled={sending} variant="outline" onClick={() => void submitBatch(matterId, "failed")}>重试失败项</Button>}
            {completed > 0 && <Button disabled={sending} variant="ghost" onClick={() => clearCompletedRows(matterId)}>清除成功回执</Button>}
          </div>
        </>}
      </div>
    </SheetContent>
  </Sheet>
}
