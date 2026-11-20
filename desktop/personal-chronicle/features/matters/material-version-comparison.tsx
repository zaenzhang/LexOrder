"use client"

import { useEffect, useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { blankReviewDraft, DiscardTaskReview, TaskMaterialReviewForm, type ReviewContext, type ReviewDraftState } from "./task-material-review"
import type { TaskReviewOption } from "../../../../src/server/tasks/material-review-contract"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { readPersonal, workspaceEndpoint } from "./personal-client"

type Version = {
  id: string
  name: string
  version: number
  isLatest: boolean
  preview: "inline" | "office" | null
  isPdf: boolean
}

function Original({ material, label }: { material: Version; label: string }) {
  const endpoint = "/api/documents/" + material.id
  const preview = material.preview && endpoint + (material.preview === "office" ? "/preview" : "/download?inline=1") + (material.isPdf ? "#view=FitH" : "")
  return <section className="grid min-w-0 gap-2 rounded-lg border p-3">
    <h3 className="text-sm font-medium break-words">{label} · V{material.version} · {material.name}</h3>
    {preview && <iframe className="h-[clamp(20rem,65dvh,56rem)] w-full rounded-md border" title={label + " V" + material.version} src={preview} />}
    {material.preview === "office" && <p className="text-xs text-muted-foreground">转换预览，正式版式请核对原件。</p>}
    {!preview && <p className="text-sm text-muted-foreground">该格式请下载此版本查看。</p>}
    <a className={buttonVariants({ variant: "outline", size: "sm", className: "justify-self-start" })}
      href={endpoint + "/download"} download>下载 V{material.version}</a>
  </section>
}

export function MaterialVersionComparison({ matterId, selection, reviewContext, comparisonPool, close }: {
  matterId: string; selection: { id: string; name: string } | [string, string]; reviewContext?: ReviewContext; comparisonPool?: string[]; close(): void
}) {
  const paired = Array.isArray(selection)
  const [pair, setPair] = useState(() => paired ? selection : undefined)
  const id = Array.isArray(selection) ? pair?.[0] ?? selection[0] : selection.id
  const other = pair?.[1]
  const [draft, setDraft] = useState(false)
  const [draftState, setDraftState] = useState<ReviewDraftState>(blankReviewDraft)
  const [discard, setDiscard] = useState<"form" | "workspace">()
  const [poolOptions, setPoolOptions] = useState<TaskReviewOption[]>()
  const [poolError, setPoolError] = useState("")
  const taskId = reviewContext?.task.id
  const [versions, setVersions] = useState<Version[]>()
  const [left, setLeft] = useState(id)
  const [right, setRight] = useState("")
  const [resultKey, setResultKey] = useState("")
  const [error, setError] = useState("")
  useEffect(() => {
    if (!comparisonPool || comparisonPool.length <= 2 || !taskId) return
    const controller = new AbortController()
    const query = new URLSearchParams({ section: "task-material-reviews", matter: matterId, task: taskId })
    comparisonPool.forEach(document => query.append("document", document))
    readPersonal<TaskReviewOption[]>(workspaceEndpoint + "?" + query, { signal: controller.signal })
      .then(items => { if (!controller.signal.aborted) setPoolOptions(items) })
      .catch(error => { if (!controller.signal.aborted) setPoolError(error.message) })
    return () => controller.abort()
  }, [matterId, taskId, comparisonPool])

  const pairKey = JSON.stringify([id, other])
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ matter: matterId, section: other ? "material-pair" : "material-versions", document: id })
    if (other) query.append("document", other)
    readPersonal<{ versions: Version[] }>(workspaceEndpoint + "?" + query, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return
        setVersions(result.versions)
        setRight(result.versions.find(row => row.id !== id)?.id ?? "")
        setResultKey(pairKey)
        setError("")
      })
      .catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setResultKey(pairKey) } })
    return () => controller.abort()
  }, [matterId, id, other, pairKey])

  const ready = resultKey === pairKey && !error
  const first = ready ? versions?.find(row => row.id === (paired ? id : left)) : undefined
  const second = ready ? versions?.find(row => row.id === (paired ? other : right)) : undefined
  function versionOptions(exclude: string) {
    return versions?.filter(row => row.id !== exclude).map(row =>
      <NativeSelectOption key={row.id} value={row.id}>V{row.version}{row.isLatest ? " · 当前版本" : ""}</NativeSelectOption>)
  }

  function stopDraft(target: "form" | "workspace") {
    if (draft && draftState.busy) return
    if (draft && draftState.dirty) setDiscard(target)
    else if (target === "workspace") close()
    else setDraft(false)
  }

  return <Sheet open onOpenChange={open => { if (!open) stopDraft("workspace") }}>
    <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[68rem] motion-reduce:transition-none">
      <SheetHeader className="pe-12">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><SheetTitle>{paired ? "并排核对材料" : "版本对照"}</SheetTitle>
            <SheetDescription>{paired ? reviewContext?.task.title ?? "本案选中的两份固定原件" : selection.name}</SheetDescription></div>
          {paired && first && second && reviewContext && reviewContext.task.reviewRevision !== null && !draft && <Button size="sm" onClick={() => {
            setDraftState(blankReviewDraft); setDraft(true)
          }}>记录这两份的核对意见</Button>}
        </div>
      </SheetHeader>
      <div className="grid gap-3 px-4 pb-4">
        {resultKey === pairKey && error && <p role="alert">{error}</p>}
        {resultKey !== pairKey && <p role="status">正在读取可访问的版本…</p>}
        {ready && versions?.length === 0 && <p role="status">没有可读取的版本。</p>}
        {ready && versions?.length === 1 && <p role="status">当前只有一个可读取的版本。</p>}
        {!paired && ready && versions && versions.length > 1 && <div className="grid grid-cols-2 gap-3">
          <NativeSelect aria-label="左侧版本" value={left} onChange={event => setLeft(event.target.value)}>{versionOptions(right)}</NativeSelect>
          <NativeSelect aria-label="右侧版本" value={right} onChange={event => setRight(event.target.value)}>{versionOptions(left)}</NativeSelect>
        </div>}
        {poolError && <p role="alert" className="text-sm">{poolError}</p>}
        {pair && poolOptions && <div className="grid gap-2 sm:grid-cols-2">
          {([0, 1] as const).map(side => <NativeSelect key={side} aria-label={side === 0 ? "左侧材料" : "右侧材料"}
            value={pair[side]} disabled={draft} onChange={event => {
              const material = event.currentTarget.value
              setPair(side === 0 ? [material, pair[1]] : [pair[0], material])
            }}>
            {poolOptions.map(row => <NativeSelectOption key={row.id} value={row.id} disabled={row.id === pair[1 - side]}>{row.name} · V{row.version}</NativeSelectOption>)}
          </NativeSelect>)}
        </div>}
        <div className={draft ? "grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]" : "grid gap-3"}>
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {first && <Original key={first.id} label="左侧原文" material={first} />}
            {second && <Original key={second.id} label="右侧原文" material={second} />}
          </div>
          {draft && reviewContext && pair && <section className="grid min-w-0 gap-3 rounded-lg border bg-card p-3">
            <TaskMaterialReviewForm {...reviewContext} ids={pair} onDraftState={setDraftState} onCancel={() => stopDraft("form")} />
            {discard && <DiscardTaskReview onKeep={() => setDiscard(undefined)} onDiscard={() => {
              if (discard === "workspace") close()
              else { setDraft(false); setDiscard(undefined) }
            }} />}
          </section>}
        </div>
      </div>
    </SheetContent>
  </Sheet>
}
