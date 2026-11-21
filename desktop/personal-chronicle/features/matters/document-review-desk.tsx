"use client"

import { PagePending } from "@/kit/ui-patterns/page-loading"

import Link from "@/features/shell/workspace-link"
import { useRouter } from "@/kit/framework"
import { FileTextIcon } from "lucide-react"
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { CaseForm } from "./case-management"
import { ResearchSourcePanel } from "./research-revision"
import { readPersonal, workspaceEndpoint } from "./personal-client"

const ep = "/api/personal/document-review"
const endpoint = (matter: string, o: Record<string, string> = {}) =>
  ep + "?" + new URLSearchParams({ matter, ...o })
const send = <T,>(v: object) =>
  readPersonal<T>(ep, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(v),
  })
type Doc = { id: string; name: string; version: number }
type Listing = Doc & { isLatest: boolean; status: string }
type Issue = {
  id: string
  version: number
  title: string
  state: string
  basis: string | null
  location: string | null
  canResolve: boolean
  basisDocument: Doc | null
  basisUnavailable: boolean
  events: {
    id: string
    note: string | null
    kind: string
    disposition: string | null
    revisionDocument: Doc | null
    revisionLocation: string | null
    resolved: boolean | null
  }[]
}
type Selection = { recordId: string; expectedCurrentRecordId: string; expectedConfirmedAt: string | null }
type Detail = {
  review: {
    document: Doc
    canCreate: boolean
    canRespond: boolean
    canCheck: boolean
    canBrowseSources: boolean
    sourceOptions: Doc[]
    sourceNextCursor: string | null
    revisionOptions: Doc[]
    issues: Issue[]
    previousIssues: { id: string; title: string; document: Doc; state: string }[]
  }
  context: { unavailable: boolean; inputs: { content: string; version: number; changed: boolean }[] }
  researchInputs: { id: string; version: number }[]
  carried: Selection[]
  status: string
  preview: "office" | "inline" | null
  isLatest: boolean
  canSubmit: boolean
  canReject: boolean
  canReview: boolean
  canVersion: boolean
  expected: {
    matterId: string
    version: number
    sha256: string | null
    status: string
    reviewedAt: string | null
    issues: { id: string; version: number }[]
  }
}
type Action =
  { kind: "submit" | "approve" | "reject" | "version" | "issue" } | { kind: "respond" | "check"; issue: Issue }
const statuses: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审批",
  APPROVED: "已批准",
  FILED: "已入卷",
  OPEN: "待处理",
  WAITING_CHECK: "待复核",
  RESOLVED: "已处理",
  ACCEPT: "接受",
  PARTIAL: "部分接受",
  REJECT: "不接受",
}
const labels = {
  submit: "提交此版本送审",
  approve: "核对并批准此版本",
  reject: "退回此版本",
  version: "登记工作稿新版本",
  issue: "提出复核问题",
  respond: "记录处理意见",
  check: "复核处理结果",
}
const download = (id: string) => "/api/documents/" + id + "/download"
function fixed(d: Doc) {
  return (
    <a className="underline" href={download(d.id)} download>
      {d.name} · V{d.version}
    </a>
  )
}

export function DocumentReviewDesk({ matterId }: { matterId: string }) {
  const [before, setBefore] = useState("")
  const list = useQuery({
    queryKey: ["doc-review-index", matterId, before],
    queryFn: ({ signal }) =>
      readPersonal<{ items: Listing[]; next: string | null }>(endpoint(matterId, before ? { before } : {}), {
        signal,
      }),
    retry: false,
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">文书列表</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {list.isPending && <p role="status"><PagePending active={!before} />正在读取案内文书…</p>}
        {list.error && (
          <p role="alert">
            {list.error.message}{" "}
            <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
              重试
            </Button>
          </p>
        )}
        {list.data && !list.data.items.length && <p>本页没有可读的自制文书。</p>}
        {Boolean(list.data?.items.length) && <div className="max-h-[24rem] min-w-0 overflow-y-auto pe-2">
        {list.data?.items.map((r) => (
          <Link className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b py-3 last:border-0 hover:text-primary" key={r.id}
            href={`/matters/${matterId}/delivery/${r.id}`}>
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground"><FileTextIcon aria-hidden className="size-4" /></span>
            <span className="min-w-0">
              <span className="block break-words font-semibold">{r.name}</span>
              <span className="text-xs text-muted-foreground">V{r.version} · {r.isLatest ? "当前版" : "历史版"} · {statuses[r.status] ?? r.status}</span>
            </span>
            <span className="text-xs">进入工作台 ›</span>
          </Link>
        ))}
        </div>}
        {(before || list.data?.next) && (
          <div className="flex gap-2">
            {before && (
              <Button size="sm" variant="outline" onClick={() => setBefore("")}>
                第一页
              </Button>
            )}
            {list.data?.next && (
              <Button size="sm" variant="outline" onClick={() => setBefore(list.data!.next!)}>
                下一页
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
function IssueText({ issue: i }: { issue: Issue }) {
  return (
    <div className="grid gap-1">
      <strong>
        {i.title} · {statuses[i.state]}
      </strong>
      {i.location && <p>位置 · {i.location}</p>}
      <p>依据 · {i.basis ?? "当前依据不可读"}</p>
      {i.basisDocument && fixed(i.basisDocument)}
      {i.basisUnavailable && <p>原依据已不可读。</p>}
      {i.events.map((e) => (
        <div className="border-l pl-2" key={e.id}>
          {e.kind === "RESPONSE"
            ? statuses[e.disposition ?? ""]
            : "复核 · " + (e.resolved ? "已处理" : "继续处理")}{" "}
          · {e.note}
          {e.revisionDocument && (
            <p>
              关联修订 · {fixed(e.revisionDocument)} · {e.revisionLocation}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
export function DocumentWorkbench({ matterId, id }: { matterId: string; id: string }) {
  const router = useRouter()
  const cache = useQueryClient()
  const parent = `/matters/${matterId}/delivery`
  const [action, setAction] = useState<Action>()
  const [previous, setPrevious] = useState("")
  const detail = useQuery({
    queryKey: ["doc-review", matterId, id],
    queryFn: ({ signal }) => readPersonal<Detail>(endpoint(matterId, { document: id }), { signal }),
    retry: false,
  })
  const history = useQuery({
    queryKey: ["doc-review-history", matterId, id, previous],
    enabled: !!previous,
    queryFn: ({ signal }) =>
      readPersonal<{ document: Doc; issue: Issue }>(endpoint(matterId, { document: id, previous }), { signal }),
    retry: false,
  })
  const data = detail.data
  const file = data?.preview === "office" ? `/api/documents/${id}/preview`
    : data?.preview === "inline" ? download(id) + "?inline=1" : undefined
  return (
    <section className="grid min-w-0 gap-4">
      <PageHeader title={data?.review.document.name ?? "文书工作台"}
        description={data ? `工作稿 V${data.review.document.version} · ${statuses[data.status]} · ${data.isLatest ? "当前版" : "历史版"}` : undefined}
        actions={<>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={parent} />}>返回文书列表</Button>
          {data?.status === "APPROVED" && <Button size="sm" nativeButton={false} render={<Link href={parent + "?prepare=" + id} />}>准备交付</Button>}
        </>} />
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="min-w-0 gap-3">
          <CardHeader><CardTitle className="text-lg">工作稿</CardTitle></CardHeader>
          <CardContent className="grid min-w-0 gap-3">
            {file && <iframe title="当前固定文书版本" src={file} className="h-[30rem] w-full rounded-md border bg-background" />}
            {data && !file && <p className="text-sm text-muted-foreground">此格式可下载后查阅。</p>}
            {data && <Button size="sm" className="justify-self-start" variant="outline" nativeButton={false}
              render={<a download href={download(id)} />}>下载固定 V{data.review.document.version}</Button>}
          </CardContent>
        </Card>
        <aside className="grid min-w-0 gap-4">
          {data && <WorkBenchSources matterId={matterId} inputs={data.researchInputs ?? []} />}
          <Card className="min-w-0 gap-3">
          <CardHeader><CardTitle className="text-lg">固定版本复核</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
          {detail.isPending && <p role="status"><PagePending />正在读取文书…</p>}
          {detail.error && (
            <p role="alert">
              {detail.error.message}{" "}
              <Button size="sm" onClick={() => void detail.refetch()}>
                重试
              </Button>
            </p>
          )}
          {data && (
            <>
              <div>
                {fixed(data.review.document)} · {statuses[data.status]} · {data.isLatest ? "当前版" : "历史版"}
              </div>
              {data.researchInputs?.length > 0 && <section aria-label="引用的研究修订" className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">引用的研究</span>
                {data.researchInputs.map(row => <Link key={row.id} className="underline" href={`/matters/${matterId}/research/${row.id}`}>研究 V{row.version}</Link>)}
              </section>}
              {data.expected.sha256 && (
                <small className="break-all text-muted-foreground">SHA-256 · {data.expected.sha256}</small>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => void detail.refetch()}>重新读取版本</Button>
                {(["submit", "approve", "reject", "version", "issue"] as const)
                  .filter((k) =>
                    k === "issue"
                      ? data.review.canCreate
                      : k === "version"
                        ? data.canVersion
                        : k === "submit"
                          ? data.canSubmit
                          : k === "reject"
                            ? data.canReject
                            : data.canReview
                  )
                  .map((k) => (
                    <Button key={k} size="sm" variant="outline" onClick={() => setAction({ kind: k })}>
                      {labels[k]}
                    </Button>
                  ))}
              </div>
              {!data.review.issues.length && <p>此版本暂无人工复核问题。</p>}
              {data.review.issues.map((i) => (
                <section className="grid gap-2 border-t py-2" key={i.id}>
                  <IssueText issue={i} />
                  <div className="flex gap-2">
                    {data.review.canRespond && i.state === "OPEN" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAction({ kind: "respond", issue: i })}
                      >
                        {labels.respond}
                      </Button>
                    )}
                    {data.review.canCheck && i.state === "WAITING_CHECK" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAction({ kind: "check", issue: i })}
                      >
                        {labels.check}
                      </Button>
                    )}
                  </div>
                </section>
              ))}
              {!!data.review.previousIssues.length && (
                <section className="grid gap-2">
                  <strong>此前版本的未结复核问题</strong>
                  {data.review.previousIssues.map((i) => (
                    <Button key={i.id} size="sm" variant="ghost" onClick={() => setPrevious(i.id)}>
                      V{i.document.version} · {i.title}
                    </Button>
                  ))}
                  {history.error && <p role="alert">{history.error.message}</p>}
                  {history.data && (
                    <div>
                      {fixed(history.data.document)}
                      <IssueText issue={history.data.issue} />
                    </div>
                  )}
                </section>
              )}
              {action && (
                <ReviewForm
                  key={action.kind}
                  matterId={matterId}
                  data={data}
                  action={action}
                  close={() => setAction(undefined)}
                  saved={(newId) => {
                    setAction(undefined)
                    void cache.invalidateQueries({ queryKey: ["doc-review-index", matterId] })
                    if (newId) router.push(parent + "/" + newId)
                    else void detail.refetch()
                  }}
                />
              )}
            </>
          )}
          </CardContent>
          </Card>
        </aside>
      </div>
    </section>
  )
}

type ResearchSourceChoice = { id: string; documentName: string | null; documentVersion?: number | null; version?: number; locationLabel: string | null }
function WorkBenchSources({ matterId, inputs }: { matterId: string; inputs: Detail["researchInputs"] }) {
  const [research, setResearch] = useState("")
  const [source, setSource] = useState("")
  const researchId = research || inputs[0]?.id
  const detail = useQuery({
    enabled: Boolean(researchId),
    queryKey: ["chronicle", "workbench-research", matterId, researchId],
    queryFn: ({ signal }) => readPersonal<{ sources: ResearchSourceChoice[]; issue?: { sources: ResearchSourceChoice[] } }>(
      workspaceEndpoint + "?" + new URLSearchParams({ matter: matterId, section: "research", record: researchId }), { signal }),
    retry: false,
  })
  const sources = [...(detail.data?.issue?.sources ?? []), ...(detail.data?.sources ?? [])].filter(row => row.documentName)
  return <Card className="gap-3">
    <CardHeader><CardTitle className="text-lg">旁读原件</CardTitle></CardHeader>
    <CardContent className="grid min-w-0 gap-3 text-sm">
      {!researchId ? <p className="text-muted-foreground">本版尚未引用研究出处。</p> : <>
        {inputs.length > 1 && <label className="grid gap-1">研究修订<NativeSelect value={researchId} onChange={event => { setResearch(event.target.value); setSource("") }}>
          {inputs.map(row => <NativeSelectOption key={row.id} value={row.id}>研究 V{row.version}</NativeSelectOption>)}
        </NativeSelect></label>}
        {detail.isPending && <p role="status">正在读取固定出处…</p>}
        {detail.error && <p role="alert">{detail.error.message}</p>}
        {detail.data && !sources.length && <p className="text-muted-foreground">此研究未记录可读的材料出处。</p>}
        {sources.length > 0 && <label className="grid gap-1">选择固定出处<NativeSelect className="w-full" value={source} onChange={event => setSource(event.target.value)}>
          <NativeSelectOption value="">请选择出处</NativeSelectOption>
          {sources.map(row => <NativeSelectOption key={row.id} value={row.id}>{row.documentName} · V{row.version ?? row.documentVersion} · {row.locationLabel}</NativeSelectOption>)}
        </NativeSelect></label>}
        {source && sources.some(row => row.id === source) && <ResearchSourcePanel key={source} matterId={matterId} researchId={researchId} sourceId={source} onClose={() => setSource("")} />}
      </>}
    </CardContent>
  </Card>
}

function ReviewForm({
  matterId,
  data: openedDetail,
  action,
  close,
  saved,
}: {
  matterId: string
  data: Detail
  action: Action
  close: () => void
  saved: (newId?: string) => void
}) {
  // A focus-triggered background refetch cannot acknowledge a newer issue revision.
  const [data] = useState(openedDetail)
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID())
  const [sources, setSources] = useState(data.review.sourceOptions)
  const [after, setAfter] = useState(data.review.sourceNextCursor)
  const [sourceError, setSourceError] = useState("")
  const [revision, setRevision] = useState("")
  const doc = data.review.document
  async function store(f: FormData) {
    const common = { action: action.kind, matterId, documentId: doc.id }
    if (action.kind === "version") {
      f.set("matterId", matterId)
      f.set("documentId", doc.id)
      f.set("requestKey", requestKey)
      f.set("contextInputs", JSON.stringify(data.carried))
      const created = await readPersonal<{ id: string }>(ep, { method: "POST", body: f })
      return created.id
    }
    if (action.kind === "issue")
      await send({
        ...common,
        data: {
          requestId: requestKey,
          documentId: doc.id,
          title: f.get("title"),
          location: f.get("location") || null,
          basis: f.get("basis"),
          basisDocumentId: f.get("source") || null,
        },
      })
    else if (action.kind === "respond")
      await send({
        ...common,
        data: {
          requestId: requestKey,
          issueId: action.issue.id,
          expectedVersion: action.issue.version,
          disposition: f.get("disposition"),
          note: f.get("note"),
          revisionDocumentId: revision || null,
          revisionLocation: f.get("revisionLocation") || null,
        },
      })
    else if (action.kind === "check")
      await send({
        ...common,
        data: {
          requestId: requestKey,
          issueId: action.issue.id,
          expectedVersion: action.issue.version,
          resolved: f.get("resolved") === "yes",
          note: f.get("note"),
        },
      })
    else
      await send({
        ...common,
        acknowledged: f.has("ack"),
        note: f.get("note") ?? "",
        expected: {
          ...data.expected,
          issues:
            action.kind === "approve"
              ? data.expected.issues.filter((i) => f.has("seen-" + i.id))
              : data.expected.issues,
        },
      })
  }
  return (
    <CaseForm
      title={labels[action.kind]}
      close={close}
      saved={() => {
        if (action.kind !== "version") saved()
      }}
      onSave={async (f) => {
        const result = await store(f)
        if (result) saved(result)
      }}
    >
      <div className="grid gap-2" onChange={() => setRequestKey(crypto.randomUUID())}>
        <p>
          {fixed(doc)} · {statuses[data.status]}
        </p>
        {action.kind === "version" && (
          <>
            <p>新文件将登记为待核对的工作稿。已经送出的清单继续固定其原版本。</p>
            {data.context.inputs.map((i, k) => (
              <p key={k}>
                沿用 · V{i.version} · {i.content}
              </p>
            ))}
            {data.carried.length > 0 && (
              <label>
                <input required type="checkbox" /> 已核对沿用的目标与指示
              </label>
            )}
            <label>
              新版文稿
              <Input type="file" name="file" required />
            </label>
          </>
        )}
        {action.kind === "issue" && (
          <>
            <label>
              问题
              <Textarea name="title" maxLength={2000} required />
            </label>
            <label>
              文书位置
              <Input name="location" maxLength={500} />
            </label>
            <label>
              依据
              <Textarea name="basis" maxLength={6000} required />
            </label>
            <label>
              关联依据版本
              <NativeSelect name="source" defaultValue="">
                <NativeSelectOption value="">仅填写依据说明</NativeSelectOption>
                {sources.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {d.name} · V{d.version}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            {sourceError && <p role="alert">{sourceError}</p>}
            {after && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const v = await readPersonal<{ items: Doc[]; nextCursor: string | null }>(
                      endpoint(matterId, { document: doc.id, sources: "1", after })
                    )
                    setSources((s) => [...new Map([...s, ...v.items].map((x) => [x.id, x])).values()])
                    setAfter(v.nextCursor)
                    setSourceError("")
                  } catch (e) {
                    setSourceError(e instanceof Error ? e.message : "读取失败。")
                  }
                }}
              >
                更多依据
              </Button>
            )}
          </>
        )}
        {action.kind === "respond" && (
          <>
            <IssueText issue={action.issue} />
            <label>
              处理决定
              <NativeSelect name="disposition" defaultValue="" required>
                <NativeSelectOption value="">请选择</NativeSelectOption>
                {["ACCEPT", "PARTIAL", "REJECT"].map((v) => (
                  <NativeSelectOption key={v} value={v}>
                    {statuses[v]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label>
              实际后续版本
              <NativeSelect value={revision} onChange={(e) => setRevision(e.target.value)}>
                <NativeSelectOption value="">仅保存处理说明</NativeSelectOption>
                {data.review.revisionOptions.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {d.name} · V{d.version}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            {revision && (
              <label>
                新版本修订位置
                <Input name="revisionLocation" required maxLength={500} />
              </label>
            )}
          </>
        )}
        {action.kind === "check" && (
          <>
            <IssueText issue={action.issue} />
            <label>
              复核结论
              <NativeSelect name="resolved" defaultValue="" required>
                <NativeSelectOption value="">请选择</NativeSelectOption>
                {action.issue.canResolve && <NativeSelectOption value="yes">已处理</NativeSelectOption>}
                <NativeSelectOption value="no">继续处理</NativeSelectOption>
              </NativeSelect>
            </label>
          </>
        )}
        {action.kind === "approve" &&
          data.review.issues.map((i) => (
            <label key={i.id} className="flex gap-2">
              <input type="checkbox" required name={"seen-" + i.id} />
              <span>
                已核对此条 · {i.title} · V{i.version} · {statuses[i.state]}
              </span>
            </label>
          ))}
        {(action.kind === "approve" || action.kind === "reject") && (
          <label>
            <input name="ack" type="checkbox" required /> 已核对本次固定文书版本
          </label>
        )}
        {["approve", "reject", "respond", "check"].includes(action.kind) && (
          <label>
            {action.kind === "reject" ? "退回原因" : "办理意见"}
            <Textarea
              name="note"
              maxLength={action.kind === "respond" || action.kind === "check" ? 6000 : 500}
              required={action.kind !== "approve"}
            />
          </label>
        )}
      </div>
    </CaseForm>
  )
}
