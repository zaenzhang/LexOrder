"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { CaseForm } from "./case-management"
import { readPersonal } from "./personal-client"

const ep = "/api/personal-runtime/document-review"
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
  carried: Selection[]
  status: string
  isLatest: boolean
  canSubmit: boolean
  canReject: boolean
  canReview: boolean
  canVersion: boolean
  expected: {
    matterId: string
    version: number
    sha256: string | null
    updatedAt: string
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
const download = (id: string) => "/api/personal-runtime/documents/" + id + "/download"
function fixed(d: Doc) {
  return (
    <a className="underline" href={download(d.id)} download>
      {d.name} · V{d.version}
    </a>
  )
}

export function DocumentReviewDesk({ matterId }: { matterId: string }) {
  const [before, setBefore] = useState("")
  const [selected, setSelected] = useState("")
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
        <CardTitle>成果送审与人工复核</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {list.isPending && <p role="status">正在读取案内文书…</p>}
        {list.error && (
          <p role="alert">
            {list.error.message}{" "}
            <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
              重试
            </Button>
          </p>
        )}
        {list.data && !list.data.items.length && <p>本页没有可读的自制文书。</p>}
        {list.data?.items.map((r) => (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b py-1" key={r.id}>
            <span>
              {r.name} · V{r.version} · {r.isLatest ? "当前版" : "历史版"} · {statuses[r.status] ?? r.status}
            </span>
            <Button size="sm" variant="outline" onClick={() => setSelected(r.id)}>
              查看与办理
            </Button>
          </div>
        ))}
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
        {selected && (
          <ReviewSheet
            key={selected}
            matterId={matterId}
            id={selected}
            close={() => setSelected("")}
            refresh={() => void list.refetch()}
            select={(id) => {
              setBefore("")
              setSelected(id)
              void list.refetch()
            }}
          />
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
function ReviewSheet({
  matterId,
  id,
  close,
  refresh,
  select,
}: {
  matterId: string
  id: string
  close: () => void
  refresh: () => void
  select: (s: string) => void
}) {
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
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !action) close()
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>固定版本复核</SheetTitle>
        </SheetHeader>
        <div className="grid gap-3 px-4 pb-4 text-sm">
          {detail.isPending && <p role="status">正在读取文书…</p>}
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
                    refresh()
                    if (newId) select(newId)
                    else void detail.refetch()
                  }}
                />
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
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
