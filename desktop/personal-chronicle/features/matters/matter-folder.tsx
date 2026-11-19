"use client"

import { useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { readPersonal } from "./personal-client"

type Binding = { matterId: string; path: string | null; available: boolean; suggestedName: string }
const endpoint = "/api/personal-runtime/matter-folder"

export function MatterFolder({ matterId }: { matterId: string }) {
  return <FolderForm key={matterId} matterId={matterId} />
}

function FolderForm({ matterId }: { matterId: string }) {
  const [picking, setPicking] = useState(false)
  const [binding, setBinding] = useState<Binding>()
  const [location, setLocation] = useState("")
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    readPersonal<Binding>(endpoint + "?matter=" + encodeURIComponent(matterId), { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setBinding(value) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId, refresh])

  async function chooseFolder() {
    setError("")
    setPicking(true)
    try {
      const selected = await invoke<string | null>("choose_case_directory", { matterId })
      if (selected) setLocation(selected)
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "无法打开系统文件夹选择器，可手动输入绝对路径。")
    } finally { setPicking(false) }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!binding || busy || picking) return
    setError("")
    setBusy(true)
    try {
      await readPersonal(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(binding.path
          ? { matterId, action: "relocate", path: location }
          : { matterId, action: "bind", root: location }),
      })
      setLocation("")
      setEditing(false)
      setBinding(undefined)
      setRefresh(value => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存目录。") }
    finally { setBusy(false) }
  }

  return <Card>
    <CardHeader><CardTitle>案件文件夹</CardTitle></CardHeader>
    <CardContent className="grid gap-3">
      {binding?.path ? <p className="break-all text-sm">{binding.path}</p> : null}
      {binding?.path && !binding.available ? <p role="alert" className="text-sm text-destructive">当前目录不可用。请连接原磁盘，或重新定位到移动后的案件文件夹。</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!binding ? (error
        ? <Button className="justify-self-start" variant="outline" size="sm" onClick={() => { setError(""); setRefresh(value => value + 1) }}>重新读取</Button>
        : <p role="status" className="text-sm text-muted-foreground">正在读取目录…</p>) : null}
      {binding && (editing || !binding.path) ?
        <form onSubmit={save} className="grid gap-2">
          <label className="grid gap-2 text-sm">{binding.path ? "移动后案目录的绝对路径" : "保存案件的父目录（绝对路径）"}
            <Input disabled={busy || picking} required value={location} onChange={event => setLocation(event.target.value)} />
          </label>
          {isTauri() ? <Button type="button" variant="outline" size="sm" className="justify-self-start"
            disabled={busy || picking} onClick={chooseFolder}>{picking ? "正在选择…" : "选择文件夹"}</Button> : null}
          {!binding.path ? <p className="text-xs text-muted-foreground">将创建「{binding.suggestedName}」并归集本案材料和工作稿。</p> : null}
          <div className="flex gap-2"><Button size="sm" disabled={busy || picking || !location.trim()} type="submit">
            {busy ? "正在保存…" : binding.path ? "保存新位置" : "绑定案件文件夹"}
          </Button>
          {binding.path ? <Button size="sm" variant="ghost" type="button" disabled={busy || picking} onClick={() => { setEditing(false); setLocation(""); setError("") }}>取消</Button> : null}</div>
        </form>
        : binding ? <Button variant="outline" className="justify-self-start" size="sm" onClick={() => { setEditing(true); setError("") }}>重新定位</Button> : null}
    </CardContent>
  </Card>
}
