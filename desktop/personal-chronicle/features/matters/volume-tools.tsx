"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
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
          ...values,
          action: mode,
          matterId,
          folderId: values.folderId || null,
        }),
      })
      refresh()
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
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
          setOpen(value)
        }
      }}
    >
      <SheetTrigger render={<Button variant="outline" />}>
        管理卷宗
      </SheetTrigger>
      <SheetContent>
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
              onChange={(e) => {
                setError("")
                setMode(e.target.value)
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
          {mode !== "create-volume" && (
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
          {mode !== "file-in-volume" && (
            <label>
              新名称
              <Input name="name" maxLength={40} required />
            </label>
          )}
          <Button className="justify-self-start" disabled={busy}>
            保存
          </Button>
          {error && <p role="alert">{error}</p>}
        </form>
      </SheetContent>
    </Sheet>
  )
}
