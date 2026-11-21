"use client"

import Link from "@/features/shell/workspace-link"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { commissionItemLabels as kindLabels, readPersonal, workspaceEndpoint, type CommissionIssue, type CommissionKind } from "./personal-client"
const statusLabels = { SUPPORTED: "候选支持", DISPUTED: "有分歧", INSUFFICIENT: "证据不足" }
const relations = { SUPPORTS: "支持", REBUTS: "反向", CONTEXT: "背景" }
const dispositions = { ADOPT: "采用", PARTIAL: "部分支持", NEEDS_SOURCE: "待补出处" }
const stamp = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })

type Summary = { id: string; createdAt: string; exportedAt: string | null; submittedAt: string | null; adoptedResearchId: string | null; aiState: keyof typeof aiState | null }
type HistoryItem = Summary & { researchVersion: number; issueRevision: number; baselineCurrent: boolean }
type HistoryPage = { items: HistoryItem[]; nextCursor: string | null }
type Host = "CODEX" | "WORKBUDDY"
const aiState = { QUEUED: "等待处理", DISPATCHED: "AI 正在生成待核稿", SUCCEEDED: "已生成待核稿", FAILED: "处理失败", UNCERTAIN: "上次调用状态不明" }
const aiError = { UNAVAILABLE: "模型配置不可用。", PROVIDER: "模型未正常响应，请检查已保存的配置。", RESULT: "结果格式或引文无法核对。", PERMISSION: "案卷、材料权限或研究基线已变化。", INTERRUPTED: "运行中断，请确认模型用量后另行发起。" }
type Grant = { id: string; host: Host; expiresAt: string }
type Decision = { candidate: number; value: string; reason: string; disposition: keyof typeof dispositions }
type IssueSupplement = { id: string; name: string; version: number }
type Detail = Summary & {
  issue: string; baselineCurrent: boolean; canWrite: boolean; method: { version: string }
  fragments: { index: number; name: string; version: number; documentId: string; location: string }[]
  aiProvider: { model: string; origin: string } | null;
  aiExecution: { state: keyof typeof aiState; model: string; error?: keyof typeof aiError; sentCharacters?: number;
    usage?: { inputTokens: number; outputTokens: number } } | null
  result: { host: Host | "INTERNAL_AI"; candidates: {
    kind: keyof typeof kindLabels; assessment: keyof typeof statusLabels; finding: string
    citations: { fragment: number; start: number; end: number; quote: string; relation: keyof typeof relations }[]
  }[] } | null
  decisions: Decision[] | null
  grants: Grant[]
  continuation: { researchId: string; items: { kind: CommissionKind; commissionId: string; newerMaterials: {
    previous: { id: string; name: string; version: number }; latest: { id: string; name: string; version: number };
  }[] }[]; issueSupplements: (IssueSupplement & { eligibleKinds: CommissionKind[] })[] } | null
  pendingIssueUpdate: { researchId: string; expectedVersion: number; issue: CommissionIssue; materials: IssueSupplement[] } | null
  issueUpdateRequiresReview: boolean
  followUp: { priorId: string; kind: CommissionKind; newFragments: number;
    carried: { kind: CommissionKind; commissionId: string; disposition: keyof typeof dispositions; value: string; reason: string }[] } | null
}

export type CommissionRange = { documentId: string; parseRunId: string; anchorId: string; start: number; end: number }

export function signoffRequest<T>(payload: object) {
  return readPersonal<T>(workspaceEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
}

function label(row: Summary) {
  return row.adoptedResearchId ? "已保存取舍" : row.submittedAt ? "待律师核对" : row.aiState ? aiState[row.aiState] : row.exportedAt ? "已生成输入包" : "已固定范围"
}

export function SkillCommissionDesk({ matterId, scope, initialId, close, onAdopted }: {
  matterId: string; scope: { kind: "issue" | "research"; id: string }; initialId?: string; close(): void; onAdopted?(id: string): void
}) {
  const [active, setActive] = useState(initialId ?? "")
  const [page, setPage] = useState<HistoryPage>()
  const [cursors, setCursors] = useState<string[]>([])
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const { kind, id: scopeId } = scope
  const before = cursors.at(-1)

  function changePage(cursor?: string) {
    setPage(undefined)
    setError("")
    setCursors(previous => cursor ? [...previous, cursor] : previous.slice(0, -1))
  }

  useEffect(() => {
    if (active) return
    const controller = new AbortController()
    const query = new URLSearchParams({ matter: matterId, section: "skill-commissions", [kind]: scopeId })
    if (before) query.set("before", before)
    readPersonal<HistoryPage>(workspaceEndpoint + "?" + query, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setPage(result) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId, kind, scopeId, before, active, attempt])

  return <Sheet open onOpenChange={open => { if (!open) close() }}>
    <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-4xl motion-reduce:transition-none">
      <SheetHeader className="pe-12">
        <SheetTitle>对照签收与验收</SheetTitle>
        <SheetDescription>固定材料、待核稿与律师取舍</SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-5">
        {active ? <>
          <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => { setPage(undefined); setError(""); setActive("") }}>返回委托记录</Button>
          <CommissionDetail key={active} matterId={matterId} id={active} onAdopted={onAdopted} onOpenRecord={setActive} />
        </> : <>
          {error && <p role="alert">{error} <Button variant="outline" size="sm" onClick={() => { setError(""); setAttempt(n => n + 1) }}>重试</Button></p>}
          {!page && !error && <p role="status">正在读取委托记录…</p>}
          {page?.items.length === 0 && <p className="text-muted-foreground">当前没有可读取的委托记录。</p>}
          {page && page.items.length > 0 && <ul className="divide-y rounded-lg border">
            {page.items.map(row => <li className="flex flex-wrap items-center justify-between gap-2 p-3" key={row.id}>
              <div className="space-y-1">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{label(row)}</Badge>
                  {!row.baselineCurrent && !row.adoptedResearchId && <Badge variant="secondary">历史基线</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">争点 V{row.issueRevision} · 研究 V{row.researchVersion} · {stamp.format(new Date(row.createdAt))}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setActive(row.id)}>打开委托</Button>
            </li>)}
          </ul>}
          {(before || page?.nextCursor) && <div className="flex justify-end gap-2">
            {before && <Button size="sm" variant="outline" onClick={() => changePage()}>上一页</Button>}
            {page?.nextCursor && <Button size="sm" variant="outline" onClick={() => changePage(page.nextCursor!)}>下一页</Button>}
          </div>}
        </>}
      </div>
    </SheetContent>
  </Sheet>
}

function CommissionDetail({ matterId, id, onAdopted, onOpenRecord }: {
  matterId: string; id: string; onAdopted?(id: string): void; onOpenRecord(id: string): void
}) {
  const [data, setData] = useState<Detail>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [approved, setApproved] = useState(false)
  const [aiApproved, setAiApproved] = useState(false)
  const [file, setFile] = useState<File>()
  const [host, setHost] = useState<Host>("CODEX")
  const [grant, setGrant] = useState<Grant & { endpoint: string; token: string }>()
  const [copied, setCopied] = useState("")
  const [openCitation, setOpenCitation] = useState<string>()
  const issueUpdateRequest = useRef<{ target: string; key: string }>(undefined)
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ matter: matterId, section: "skill-commissions", record: id })
    readPersonal<Detail>(workspaceEndpoint + "?" + query, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result) })
      .catch(cause => { if (!controller.signal.aborted) { setData(undefined); setError(cause.message) } })
    return () => controller.abort()
  }, [matterId, id, attempt])

  const waitingOnAi = data?.aiExecution?.state === "QUEUED" || data?.aiExecution?.state === "DISPATCHED"
  useEffect(() => {
    if (!waitingOnAi) return
    const timer = window.setTimeout(() => setAttempt(n => n + 1), 2400)
    return () => window.clearTimeout(timer)
  }, [waitingOnAi, attempt])

  function acceptIssueSupplements() {
    const update = data?.pendingIssueUpdate
    if (!update) return
    const target = JSON.stringify([update.researchId, update.issue])
    if (issueUpdateRequest.current?.target !== target) issueUpdateRequest.current = { target, key: crypto.randomUUID() }
    const requestKey = issueUpdateRequest.current.key
    return mutate(async () => {
      await signoffRequest({ action: "accept-issue-supplements", matterId, researchId: update.researchId,
        expectedVersion: update.expectedVersion, issue: update.issue, requestKey })
    })
  }

  function runAi() {
    if (!data?.aiProvider) return
    const provider = data.aiProvider
    return mutate(async () => {
      await signoffRequest({ action: "run-signoff-ai", matterId, id, confirmed: aiApproved, ...provider })
      setAiApproved(false)
    })
  }
  async function mutate(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await work()
      setAttempt(value => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "委托操作失败。") }
    finally { setBusy(false) }
  }
  function exportPacket() {
    return mutate(async () => {
      const packet = await signoffRequest<object>({ action: "export-signoff", matterId, id, confirmed: approved })
      const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }))
      const link = document.createElement("a")
      link.href = url
      link.download = "LexOrder-委托-" + id + ".json"
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setApproved(false)
    })
  }
  function grantHost() {
    return mutate(async () => {
      const next = await signoffRequest<Grant & { endpoint: string; token: string }>({ action: "grant-signoff-host", matterId, id, host, confirmed: approved })
      setGrant(next)
      setCopied("")
      setApproved(false)
    })
  }
  function revokeHost(grantId: string) {
    return mutate(async () => {
      await signoffRequest({ action: "revoke-signoff-host", matterId, id, grantId })
      if (grant?.id === grantId) setGrant(undefined)
      setCopied("")
    })
  }
  async function copy(value: string, name: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied("已复制" + name)
    } catch { setError("无法访问系统剪贴板。") }
  }
  function importResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return
    const selected = file
    return mutate(async () => {
      if (selected.size > 128_000) throw new Error("结果 JSON 不能超过 128 KB。")
      let result: unknown
      try { result = JSON.parse(await selected.text()) } catch { throw new Error("请选择有效的结果 JSON。") }
      await signoffRequest({ action: "submit-signoff", matterId, id, result })
      setFile(undefined)
    })
  }
  function adopt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data?.result) return
    const fields = new FormData(event.currentTarget)
    const decisions = data.result.candidates.map((_, candidate) => ({
      candidate, disposition: fields.get("status-" + candidate),
      value: fields.get("value-" + candidate), reason: fields.get("reason-" + candidate),
    }))
    return mutate(async () => {
      const saved = await signoffRequest<{ id: string }>({ action: "adopt-signoff", matterId, id, decisions })
      onAdopted?.(saved.id)
    })
  }

  const continuation = data?.continuation
  return <>
    {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-destructive">{error}
      {!data && <Button variant="outline" size="sm" onClick={() => { setError(""); setAttempt(n => n + 1) }}>重试</Button>}
    </div>}
    {!data && !error && <p role="status">正在读取委托与固定来源…</p>}
    {data && <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{data.issue}</h3><Badge variant="outline">{label(data)}</Badge>
        <span className="text-xs text-muted-foreground">{data.method.version}</span>
      </div>
      {!data.baselineCurrent && !data.adoptedResearchId && <p role="status" className="rounded-md bg-muted p-3">研究或争点已更新。本委托的候选可回查，请从当前版本办理采用。</p>}
      {data.adoptedResearchId && <Button variant="outline" size="sm" className="justify-self-start" nativeButton={false}
        render={<Link href={`/matters/${matterId}/research/${data.adoptedResearchId}`} />}>查看保存的研究修订</Button>}
      {data.followUp && <Card>
        <CardHeader><CardTitle>补件复核 · {kindLabels[data.followUp.kind]}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p>本次 {data.fragments.length} 个片段 · 新选区 {data.followUp.newFragments} 个 · 沿用 {data.followUp.carried.length} 项律师取舍</p>
          {data.followUp.carried.map(item => <div key={item.kind} className="grid gap-1 border-t pt-2">
            <p className="font-medium">{kindLabels[item.kind]} · {dispositions[item.disposition]}</p>
            <p className="whitespace-pre-wrap break-words">{item.value}</p>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">{item.reason}</p>
            <Button type="button" size="xs" variant="outline" className="justify-self-start" onClick={() => onOpenRecord(item.commissionId)}>查看原取舍及出处</Button>
          </div>)}
        </CardContent>
      </Card>}
      {data.pendingIssueUpdate && <Card>
        <CardHeader><CardTitle>争点有新增出处</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>确认后将争点 V{data.pendingIssueUpdate.issue.revision} 纳入一版新研究，再选择要复核的判断。</p>
          <ul className="list-disc ps-5">{data.pendingIssueUpdate.materials.map(item => <li key={item.id}>{item.name} · V{item.version}</li>)}</ul>
          <Button variant="outline" size="sm" className="justify-self-start" disabled={busy}
            onClick={() => void acceptIssueSupplements()}>纳入新增出处</Button>
        </CardContent>
      </Card>}
      {data.issueUpdateRequiresReview && <p role="status" className="rounded-md bg-muted p-3">
        当前争点的正文、日期、核对状态或既有出处已变化，请先核对研究基线。
      </p>}
      {continuation && <Card>
        <CardHeader><CardTitle>补件后复核</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {continuation.issueSupplements.length > 0 && <div className="grid gap-2 border-b pb-3">
            <p className="font-medium">争点新增出处</p>
            {continuation.issueSupplements.map(item => <div key={item.id} className="grid gap-2 rounded-md bg-muted p-2.5">
              <p className="break-words text-sm">{item.name} · V{item.version}</p>
              <div className="flex flex-wrap gap-2">
                {item.eligibleKinds.map(kind => <Link key={kind} className={buttonVariants({ variant: "outline", size: "xs" })}
                  href={{ pathname: `/matters/${matterId}/materials`,
                    query: { research: continuation.researchId, priorCommission: id, focus: kind, suggestedMaterial: item.id },
                  }}>选入{kindLabels[kind]}复核</Link>)}
              </div>
            </div>)}
          </div>}
          {continuation.items.map(item => {
            const query = { research: continuation.researchId, priorCommission: id, focus: item.kind }
            return <div key={item.kind} className="grid gap-2 border-b pb-3 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{kindLabels[item.kind]}</span>
                <Link className={buttonVariants({ variant: "outline", size: "sm" })}
                  href={{ pathname: `/matters/${matterId}/materials`, query }}>复核{kindLabels[item.kind]}</Link>
              </div>
              {item.newerMaterials.map(({ previous, latest }) => <div key={latest.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-2.5">
                <div className="min-w-0 break-words text-sm">
                  <span>所引材料有新版</span>
                  <p className="text-xs text-muted-foreground">{previous.name} · V{previous.version} → {latest.name} · V{latest.version}</p>
                </div>
                <Link className={buttonVariants({ variant: "outline", size: "xs" })}
                  href={{ pathname: `/matters/${matterId}/materials`, query: { ...query, suggestedMaterial: latest.id } }}>选此新版复核</Link>
              </div>)}
            </div>
          })}
        </CardContent>
      </Card>}
      {(data.aiExecution || (data.canWrite && data.baselineCurrent && !data.result && !data.exportedAt && !data.grants.length)) && <Card>
        <CardHeader><CardTitle>应用 AI 核对</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {data.aiExecution ? <>
            <p role="status">{aiState[data.aiExecution.state]} · {data.aiExecution.model}</p>
            {data.aiExecution.error && <p className="text-muted-foreground">{aiError[data.aiExecution.error]}</p>}
            {typeof data.aiExecution.sentCharacters === "number" && <p>本次提供 {data.aiExecution.sentCharacters.toLocaleString("zh-CN")} 个片段字符</p>}
            {data.aiExecution.usage && <p>模型回执 · 输入 {data.aiExecution.usage.inputTokens.toLocaleString("zh-CN")} Token · 输出 {data.aiExecution.usage.outputTokens.toLocaleString("zh-CN")} Token</p>}
          </> : data.aiProvider ? <>
            <p>{data.aiProvider.model} · {data.aiProvider.origin}</p>
            <label className="flex items-start gap-2"><Checkbox checked={aiApproved} onCheckedChange={setAiApproved} disabled={busy} />
              <span>确认把冻结范围内的 {data.fragments.length} 个片段交给此模型处理。</span>
            </label>
            <Button size="sm" className="justify-self-start" disabled={busy || !aiApproved} onClick={() => void runAi()}>生成待核稿</Button>
          </> : <p>应用 AI 尚未配置。<Link href="/practice/profile/ai" className="underline">打开应用 AI 配置</Link></p>}
        </CardContent>
      </Card>}
      {data.canWrite && !data.result && !data.aiExecution && <Card>
        <CardHeader><CardTitle>可选宿主交接</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {data.baselineCurrent && <>
            <label className="flex items-start gap-2 text-sm"><Checkbox checked={approved} onCheckedChange={setApproved} disabled={busy} />
              <span>确认允许所选宿主读取下列固定片段。也可导出为 JSON 自行交接。</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect aria-label="选择宿主" value={host} onChange={event => setHost(event.target.value === "WORKBUDDY" ? "WORKBUDDY" : "CODEX")}>
                <NativeSelectOption value="CODEX">Codex</NativeSelectOption>
                <NativeSelectOption value="WORKBUDDY">WorkBuddy</NativeSelectOption>
              </NativeSelect>
              <Button size="sm" disabled={busy || !approved} onClick={() => void grantHost()}>生成本机授权</Button>
              <Button size="sm" variant="outline" disabled={busy || !approved} onClick={() => void exportPacket()}>导出输入 JSON</Button>
            </div>
          </>}
          {data.exportedAt && <form className="grid gap-2 border-t pt-3" onSubmit={importResult}>
            <label className="grid gap-2 text-sm">导入宿主返回的结果 JSON
              <Input type="file" accept=".json,application/json" disabled={busy} onChange={event => setFile(event.target.files?.[0])} />
            </label>
            <Button className="justify-self-start" size="sm" disabled={!file || busy}>{busy ? "正在处理…" : "校验并保存待核稿"}</Button>
          </form>}
        </CardContent>
      </Card>}
      {data.canWrite && (grant || data.grants.length > 0) && <Card>
        <CardHeader><CardTitle>本机 MCP 授权</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {grant && <div className="grid gap-2 rounded-md border p-3">
            <p>将地址和 Bearer 凭据交给获准的本机宿主。授权 30 分钟内有效。</p>
            <code className="break-all">{grant.endpoint}</code>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void copy(grant.endpoint, "地址")}>复制地址</Button>
              <Button variant="outline" size="sm" onClick={() => void copy(grant.token, "Bearer 凭据")}>复制 Bearer 凭据</Button>
            </div>
            {copied && <p role="status">{copied}</p>}
          </div>}
          {data.grants.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{row.host === "CODEX" ? "Codex" : "WorkBuddy"} · {stamp.format(new Date(row.expiresAt))} 到期</span>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void revokeHost(row.id)}>撤回授权</Button>
          </div>)}
        </CardContent>
      </Card>}
      <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">固定授权范围 · {data.fragments.length} 个片段</summary>
        <ol className="mt-2 grid gap-1 ps-5 text-sm">{data.fragments.map(fragment => <li key={fragment.index} className="list-decimal">
          {fragment.name} · V{fragment.version} · {fragment.location}
        </li>)}</ol>
      </details>
      {data.result && <form onSubmit={adopt} className="grid gap-3">
        {data.result.host !== "INTERNAL_AI" && <p className="text-xs text-muted-foreground">宿主为 {data.result.host === "CODEX" ? "Codex" : "WorkBuddy"}。当前回执没有可核实的 Token 用量。</p>}
        {data.result.candidates.map((candidate, index) => {
          const saved = data.decisions?.find(decision => decision.candidate === index)
          return <Card key={candidate.kind}>
            <CardHeader><CardTitle>{kindLabels[candidate.kind]} <Badge variant="outline">{statusLabels[candidate.assessment]}</Badge></CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p>{candidate.finding}</p>
              <ul className="grid gap-2">{candidate.citations.map((citation, position) => {
                const fragment = data.fragments[citation.fragment - 1]
                return <li key={position} className="grid gap-1 border-s-2 ps-3">
                  <p className="text-xs text-muted-foreground">{relations[citation.relation]} · {fragment.name} · V{fragment.version} · {fragment.location}</p>
                  <blockquote className="whitespace-pre-wrap break-words">{citation.quote}</blockquote>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="xs" variant="outline" aria-expanded={openCitation === index + "/" + position}
                      onClick={() => setOpenCitation(current => current === index + "/" + position ? undefined : index + "/" + position)}>
                      {openCitation === index + "/" + position ? "收起片段" : "查看固定片段"}
                    </Button>
                    <a className="text-xs underline" href={"/api/documents/" + fragment.documentId + "/download"} download>下载固定原件</a>
                  </div>
                  {openCitation === index + "/" + position && <CommissionExcerpt matterId={matterId} id={id}
                    index={fragment.index} start={citation.start} end={citation.end} />}
                </li>
              })}</ul>
              {saved ? <p className="whitespace-pre-wrap">{dispositions[saved.disposition]} · {saved.value}<br />{saved.reason}</p>
                : data.canWrite && data.baselineCurrent && <fieldset className="grid gap-2" disabled={busy}>
                  <label className="grid gap-1">律师取舍
                    <NativeSelect name={"status-" + index} required defaultValue="">
                      <NativeSelectOption value="">选择取舍</NativeSelectOption>
                      {Object.entries(dispositions).filter(([key]) => candidate.citations.length || key === "NEEDS_SOURCE").map(([key, text]) =>
                        <NativeSelectOption key={key} value={key}>{text}</NativeSelectOption>)}
                    </NativeSelect>
                  </label>
                  <label className="grid gap-1">采用值或待核问题<Textarea name={"value-" + index} required maxLength={1000} defaultValue={candidate.finding} /></label>
                  <label className="grid gap-1">取舍理由<Textarea name={"reason-" + index} required maxLength={1400} /></label>
                </fieldset>}
            </CardContent>
          </Card>
        })}
        {data.canWrite && data.baselineCurrent && !data.adoptedResearchId &&
          <Button className="justify-self-start" disabled={busy}>{busy ? "正在保存…" : "另存研究修订"}</Button>}
      </form>}
    </>}
  </>
}

function CommissionExcerpt({ matterId, id, index, start, end }: {
  matterId: string; id: string; index: number; start: number; end: number
}) {
  const [excerpt, setExcerpt] = useState<string>()
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ matter: matterId, section: "skill-commissions", record: id, fragment: String(index) })
    readPersonal<{ text: string }>(workspaceEndpoint + "?" + query, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setExcerpt(result.text) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId, id, index])

  if (error) return <p role="alert" className="text-destructive">{error}</p>
  if (excerpt === undefined) return <p role="status">正在读取固定片段…</p>
  return <blockquote className="whitespace-pre-wrap break-words rounded-md bg-muted p-3">
    {excerpt.slice(0, start)}<mark className="bg-accent text-accent-foreground font-semibold underline decoration-2 underline-offset-2">{excerpt.slice(start, end)}</mark>{excerpt.slice(end)}
  </blockquote>
}
