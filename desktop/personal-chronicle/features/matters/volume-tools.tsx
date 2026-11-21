"use client"

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { readPersonal, workspaceEndpoint } from "./personal-client"
import type { Material } from "./materials-workspace"

export function VolumeTools({
  matterId,
  folders,
  documents,
  refresh,
}: {
  matterId: string
  folders: { id: string; name: string }[]
  documents: Material[]
  refresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState("file-in-volume")
  const [order, setOrder] = useState<typeof folders>([])
  const [expectedOrder, setExpectedOrder] = useState<string[]>([])
  const changedOrder = order.some(({ id }, index) => id !== expectedOrder[index])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  function shiftFolder(index: number, offset: number) {
    setOrder(previous => {
      const next = [...previous]
      const adjacent = index + offset
      const folder = next[index]
      next[index] = next[adjacent]
      next[adjacent] = folder
      return next
    })
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setError("")
    setBusy(true)
    try {
      await readPersonal(workspaceEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          matterId,
          ...(mode === "reorder-volumes"
            ? { expectedOrder, orderedIds: order.map(folder => folder.id) }
            : { ...values, folderId: values.folderId || null }),
        }),
      })
      refresh()
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "卷宗操作失败。")
      if (mode === "reorder-volumes") refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setError("")
          if (value) setMode("file-in-volume")
          setOpen(value)
        }
      }}
    >
      <SheetTrigger render={<Button variant="outline" />}>
        管理卷宗
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>案内卷宗</SheetTitle>
          <SheetDescription>
            按卷宗整理材料，固定版本的下载和引用继续可用。
          </SheetDescription>
        </SheetHeader>
        <form className="grid gap-4 px-6" onSubmit={save}>
          <label>
            操作
            <NativeSelect
              value={mode}
              disabled={busy}
              onChange={(e) => {
                setError("")
                setMode(e.target.value)
                if (e.target.value === "reorder-volumes") {
                  setOrder(folders)
                  setExpectedOrder(folders.map(folder => folder.id))
                }
              }}
            >
              <NativeSelectOption value="file-in-volume">
                材料分卷
              </NativeSelectOption>
              <NativeSelectOption value="create-volume">
                新建卷宗
              </NativeSelectOption>
              {folders.length > 0 && (
                <NativeSelectOption value="rename-volume">
                  重命名卷宗
                </NativeSelectOption>
              )}
              {folders.length > 1 && <NativeSelectOption value="reorder-volumes">调整卷宗顺序</NativeSelectOption>}
            </NativeSelect>
          </label>
          {mode === "file-in-volume" && (
            <label>
              材料版本
              <NativeSelect name="documentId" required defaultValue="">
                <NativeSelectOption value="">选择材料版本</NativeSelectOption>
                {documents.map((doc) => (
                  <NativeSelectOption key={doc.id} value={doc.id}>
                    {doc.name} · V{doc.version}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}
          {(mode === "file-in-volume" || mode === "rename-volume") && (
            <label>
              卷宗
              <NativeSelect
                key={mode}
                name="folderId"
                required={mode === "rename-volume"}
                defaultValue=""
              >
                <NativeSelectOption value="">
                  {mode === "rename-volume" ? "选择卷宗" : "未分卷"}
                </NativeSelectOption>
                {folders.map((v) => (
                  <NativeSelectOption key={v.id} value={v.id}>
                    {v.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}
          {(mode === "create-volume" || mode === "rename-volume") && (
            <label>
              新名称
              <Input name="name" maxLength={40} required />
            </label>
          )}
          {mode === "reorder-volumes" && <ItemGroup aria-label="卷宗顺序">
            {order.map((folder, index) => <Item key={folder.id} size="sm" variant="outline" role="listitem">
              <ItemContent><ItemTitle className="break-all">{folder.name}</ItemTitle></ItemContent>
              <ItemActions>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`上移 ${folder.name}`}
                  disabled={busy || index === 0} onClick={() => shiftFolder(index, -1)}><ArrowUpIcon /></Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`下移 ${folder.name}`}
                  disabled={busy || index === order.length - 1} onClick={() => shiftFolder(index, 1)}><ArrowDownIcon /></Button>
              </ItemActions>
            </Item>)}
          </ItemGroup>}
          <Button type="submit" className="justify-self-start" disabled={busy || (mode === "reorder-volumes" && !changedOrder)}>
            保存
          </Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      </SheetContent>
    </Sheet>
  )
}
