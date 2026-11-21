import { useId, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import type { PendingMaterialUploads } from "../../../../src/lib/documents/upload-contract"
import { readPersonal } from "./personal-client"

export const materialUploadsEndpoint = "/api/personal/material-uploads"

export function PendingUploads({ matterId, items, hasMore, onChange }: PendingMaterialUploads & {
  matterId: string
  onChange: (saved: boolean) => void
}) {
  const inputId = useId()
  const [selecting, setSelecting] = useState<string>()
  const [active, setActive] = useState<string>()
  const [failure, setFailure] = useState<{ id: string; message: string }>()
  const [notice, setNotice] = useState("")

  async function act(uploadId: string, action: "continue" | "close", file?: File) {
    setActive(uploadId)
    setFailure(undefined)
    setNotice("")
    try {
      const identity = { matterId, uploadId, action }
      if (file) {
        const body = new FormData()
        for (const [key, value] of Object.entries(identity)) body.set(key, value)
        body.set("file", file)
        await readPersonal(materialUploadsEndpoint, { method: "POST", body })
      } else {
        await readPersonal(materialUploadsEndpoint, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identity),
        })
      }
      setSelecting(undefined)
      setNotice(action === "close" ? "已关闭上传记录。" : "已恢复上传，材料已入卷。")
      onChange(action === "continue")
    } catch (error) {
      setFailure({ id: uploadId, message: error instanceof Error ? error.message : "暂时无法处理此上传。" })
    } finally {
      setActive(undefined)
    }
  }

  if (!items.length && !notice) return null
  return <section aria-label="未完成上传" className="grid gap-2">
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {items.length > 0 && <>
      <h3 className="text-sm font-medium">未完成上传</h3>
      <ItemGroup className="gap-2">
        {items.map(row => <Item key={row.id} variant="outline" size="sm" className="flex-col items-stretch">
          <ItemContent className="min-w-0">
            <ItemTitle className="break-all">{row.name}</ItemTitle>
            <ItemDescription className="line-clamp-none">{row.description}</ItemDescription>
          </ItemContent>
          {failure?.id === row.id && <Alert variant="destructive"><AlertDescription>{failure.message}</AlertDescription></Alert>}
          {selecting === row.id && <Field>
            <FieldLabel htmlFor={inputId}>选择与原提交内容相同的文件</FieldLabel>
            <Input type="file" id={inputId} disabled={!!active} onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ""
              if (file) void act(row.id, "continue", file)
            }} />
          </Field>}
          <ItemActions className="flex-wrap">
            {active === row.id && <Spinner aria-label="正在处理上传" />}
            <Button variant="outline" size="sm" disabled={!!active || row.waiting} onClick={() => void act(row.id, "continue")}>继续处理</Button>
            <Button variant="outline" size="sm" disabled={!!active || row.waiting} aria-expanded={selecting === row.id}
              onClick={() => setSelecting(selecting === row.id ? undefined : row.id)}>重新选择原文件</Button>
            <Button variant="ghost" size="sm" disabled={!!active || row.waiting} onClick={() => void act(row.id, "close")}>关闭记录</Button>
          </ItemActions>
        </Item>)}
      </ItemGroup>
      {hasMore && <p className="text-xs text-muted-foreground">显示最近 20 条，处理后可查看其余记录。</p>}
    </>}
  </section>
}
