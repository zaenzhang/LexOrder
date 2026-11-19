"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { CaseForm, actionRequest } from "./case-management"
import { readPersonal, workspaceEndpoint } from "./personal-client"

const labels = {
  GOAL: "客户目标",
  CONSTRAINT: "约束",
  INSTRUCTION: "客户指示",
  OPTION: "备选方案",
  DECISION: "决定",
}
type Kind = keyof typeof labels
type SourceType = "DOCUMENT" | "NOTE" | "CLIENT_ACTIVITY"
const sourceLabels: Record<SourceType, string> = { DOCUMENT: "材料", NOTE: "沟通", CLIENT_ACTIVITY: "客户活动" }
type Source = { type: SourceType; id: string; label: string; available?: boolean }
type Option = { recordId: string; expectedCurrentRecordId: string; expectedConfirmedAt: string | null }
type InputChoice = {
  selection: Option
  kind: "GOAL" | "INSTRUCTION"
  version: number
  content: string
  sourceDescription: string
  historical: boolean
}
type InputPage = { choices: InputChoice[]; nextCursor: string | null }
type RecordView = {
  id: string
  kind: Kind
  version: number
  visibility: "MATTER" | "FINANCE"
  content: string | null
  reason: string | null
  occurredAt: string
  sourceDescription: string | null
  source: Source | null
  readable: boolean
  canRevise: boolean
  canConfirm: boolean
  confirmationStatus: string
  authorName: string
  contextInputs?: {
    unavailable: boolean
    inputs: (InputChoice & {
      currentRecordIdAtAdoption: string
      adoptedConfirmedAt: string | null
      changed: boolean
    })[]
  }
}
export type ContextData = {
  records: RecordView[]
  canWrite: boolean
  canReadFinance: boolean
  nextCursor: string | null
}
type Sources = { choices: Source[]; nextCursors: Record<SourceType, string | null> }
const fmt = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  dateStyle: "medium",
  timeStyle: "short",
})
const toInput = (s?: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(s ? new Date(s) : new Date())
    .replace(" ", "T")
function url(matter: string, args: Record<string, string> = {}) {
  return workspaceEndpoint + "?" + new URLSearchParams({ section: "context", matter, ...args })
}

export function ContextRecords({
  matterId,
  initial,
  reload,
}: {
  matterId: string
  initial: ContextData
  reload: () => void
}) {
  const [shown, setShown] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setShown(true)}>
        目标、指示与决定
      </Button>
      {shown && (
        <RecordsSheet matterId={matterId} initial={initial} close={() => setShown(false)} reload={reload} />
      )}
    </>
  )
}
function RecordsSheet({
  matterId,
  initial,
  close,
  reload,
}: {
  matterId: string
  initial: ContextData
  close: () => void
  reload: () => void
}) {
  const [records, setRecords] = useState(initial)
  const [edit, setEdit] = useState<"new" | RecordView>()
  const [history, setHistory] = useState<RecordView>()
  const [confirm, setConfirm] = useState<RecordView>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function load(after?: string) {
    setBusy(true)
    setError("")
    try {
      const value = await readPersonal<ContextData>(url(matterId, after ? { after } : {}))
      setRecords((old) => (after ? { ...value, records: [...old.records, ...value.records] } : value))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取失败。")
    } finally {
      setBusy(false)
    }
  }
  function saved() {
    setEdit(undefined)
    setConfirm(undefined)
    void load()
    reload()
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !edit && !confirm && !history && !busy) close()
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-xl motion-reduce:transition-none">
        <SheetHeader>
          <SheetTitle>目标、指示与决定</SheetTitle>
        </SheetHeader>
        <div className="grid gap-3 px-4 pb-4 text-sm">
          {records.canWrite && (
            <Button size="sm" className="justify-self-start" onClick={() => setEdit("new")}>
              新增记录
            </Button>
          )}
          {error && (
            <p role="alert">
              {error}
              <Button size="sm" variant="ghost" onClick={() => void load()}>
                重读
              </Button>
            </p>
          )}
          {!records.records.length && <p>暂无案情记录。</p>}
          {records.records.map((row) => (
            <section className="grid gap-1 border-b pb-3" key={row.id}>
              <h3 className="font-medium">
                {labels[row.kind]} · V{row.version} ·{" "}
                {row.confirmationStatus === "CONFIRMED" ? "已确认" : "待确认"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {fmt.format(new Date(row.occurredAt))} · {row.authorName}
              </p>
              {row.readable ? (
                <>
                  <p className="whitespace-pre-wrap">{row.content}</p>
                  <p>来源 · {[row.sourceDescription, row.source?.label].filter(Boolean).join(" · ")}</p>
                  {row.reason && <p>理由 · {row.reason}</p>}
                  {row.contextInputs?.inputs.map((input) => (
                    <p key={input.selection.recordId}>采用 · {input.content}</p>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    {row.canRevise && (
                      <Button size="sm" variant="outline" onClick={() => setEdit(row)}>
                        另存修订
                      </Button>
                    )}
                    {row.canConfirm && (
                      <Button size="sm" variant="outline" onClick={() => setConfirm(row)}>
                        核对确认
                      </Button>
                    )}
                    {row.version > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => setHistory(row)}>
                        修订历史
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <p>原记录或来源不可读。</p>
              )}
            </section>
          ))}
          {records.nextCursor && (
            <Button size="sm" disabled={busy} variant="outline" onClick={() => void load(records.nextCursor!)}>
              更多记录
            </Button>
          )}
        </div>
        {edit && (
          <ContextForm
            matterId={matterId}
            row={edit === "new" ? undefined : edit}
            finance={records.canReadFinance}
            close={() => setEdit(undefined)}
            saved={saved}
          />
        )}
        {confirm && (
          <CaseForm
            title="确认已核对本版"
            close={() => setConfirm(undefined)}
            saved={saved}
            onSave={() =>
              actionRequest("confirm-context", {
                matterId,
                id: confirm.id,
                expectedVersion: confirm.version,
                acknowledged: true,
              })
            }
          >
            <p>
              {labels[confirm.kind]} · V{confirm.version}
            </p>
            <p>{confirm.content}</p>
            <p>来源 · {confirm.sourceDescription}</p>
          </CaseForm>
        )}
        {history && <ContextHistory matterId={matterId} record={history} close={() => setHistory(undefined)} />}
      </SheetContent>
    </Sheet>
  )
}

function ContextForm({
  matterId,
  row,
  finance,
  close,
  saved,
}: {
  matterId: string
  row?: RecordView
  finance: boolean
  close: () => void
  saved: () => void
}) {
  const [kind, setKind] = useState<Kind>(row?.kind ?? "GOAL")
  const [sources, setSources] = useState<Sources>()
  const [sourceError, setSourceError] = useState("")
  const [sourceRead, setSourceRead] = useState(0)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [source, setSource] = useState(row?.source?.id ?? "")
  const [adopted, setAdopted] = useState<Option[]>(() =>
    (row?.contextInputs?.inputs ?? []).map((v) => ({
      recordId: v.selection.recordId,
      expectedCurrentRecordId: v.currentRecordIdAtAdoption,
      expectedConfirmedAt: v.adoptedConfirmedAt,
    }))
  )
  useEffect(() => {
    const c = new AbortController()
    readPersonal<Sources>(url(matterId, { sources: "1" }), { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) setSources(v)
      })
      .catch((e) => {
        if (!c.signal.aborted) setSourceError(e.message)
      })
    return () => c.abort()
  }, [matterId, sourceRead])
  async function more(type: SourceType, cursor: string) {
    try {
      const page = await readPersonal<Sources>(url(matterId, { sources: "1", type, after: cursor }))
      setSources((prev) =>
        prev
          ? {
              choices: [...new Map([...prev.choices, ...page.choices].map((v) => [v.id, v])).values()],
              nextCursors: { ...prev.nextCursors, [type]: page.nextCursors[type] },
            }
          : page
      )
      setSourceError("")
    } catch (e) {
      setSourceError(e instanceof Error ? e.message : "读取更多来源失败。")
    }
  }
  const choices = [
    ...new Map([...(row?.source ? [row.source] : []), ...(sources?.choices ?? [])].map((v) => [v.id, v])).values(),
  ]
  return (
    <CaseForm
      title={row ? "保存新修订" : "保存记录"}
      close={close}
      saved={saved}
      onSave={(fields) => {
        const selected = choices.find((v) => v.id === source)
        const occurredAt =
          fields.get("occurredAt") === toInput(row?.occurredAt) && row
            ? row.occurredAt
            : String(fields.get("occurredAt")) + ":00+08:00"
        return actionRequest("save-context", {
          matterId,
          requestKey: key,
          supersedesId: row?.id ?? null,
          kind,
          visibility: row?.visibility ?? fields.get("visibility") ?? "MATTER",
          content: fields.get("content"),
          reason: fields.get("reason") || null,
          occurredAt,
          sourceDescription: fields.get("sourceDescription"),
          sourceDocumentId: selected?.type === "DOCUMENT" ? source : null,
          sourceNoteId: selected?.type === "NOTE" ? source : null,
          sourceClientActivityId: selected?.type === "CLIENT_ACTIVITY" ? source : null,
          contextInputs: kind === "OPTION" ? adopted : [],
        })
      }}
    >
      <div className="grid gap-2" onChange={() => setKey(crypto.randomUUID())}>
        {row ? (
          <p>
            {labels[row.kind]} · 修订自 V{row.version}
          </p>
        ) : (
          <label className="grid gap-1">
            性质
            <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {Object.entries(labels).map(([id, v]) => (
                <NativeSelectOption key={id} value={id}>
                  {v}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        )}
        {kind === "OPTION" && (
          <ContextInputs
            matterId={matterId}
            old={row?.contextInputs?.inputs ?? []}
            adopted={adopted}
            change={setAdopted}
          />
        )}
        {!row && finance && (
          <label className="grid gap-1">
            可见范围
            <NativeSelect name="visibility" defaultValue="MATTER">
              <NativeSelectOption value="MATTER">案件记录</NativeSelectOption>
              <NativeSelectOption value="FINANCE">案件财务</NativeSelectOption>
            </NativeSelect>
          </label>
        )}
        <label className="grid gap-1">
          实际发生时间（北京时间）
          <Input type="datetime-local" required name="occurredAt" defaultValue={toInput(row?.occurredAt)} />
        </label>
        <label className="grid gap-1">
          内容
          <Textarea name="content" required maxLength={8000} defaultValue={row?.content ?? ""} />
        </label>
        <label className="grid gap-1">
          理由
          <Textarea name="reason" maxLength={3000} defaultValue={row?.reason ?? ""} />
        </label>
        <label className="grid gap-1">
          来源说明
          <Input name="sourceDescription" required maxLength={1200} defaultValue={row?.sourceDescription ?? ""} />
        </label>
        <label className="grid gap-1">
          关联主要来源
          <NativeSelect value={source} onChange={(e) => setSource(e.target.value)}>
            <NativeSelectOption value="">仅记录来源说明</NativeSelectOption>
            {choices.map((v) => (
              <NativeSelectOption key={v.id} value={v.id}>
                {sourceLabels[v.type]} · {v.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {sourceError && (
          <p role="alert">
            {sourceError}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSourceError("")
                setSourceRead((n) => n + 1)
              }}
            >
              重读来源
            </Button>
          </p>
        )}
        {sources &&
          Object.entries(sources.nextCursors)
            .filter(([, v]) => !!v)
            .map(([type, cursor]) => (
              <Button
                key={type}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void more(type as SourceType, cursor!)}
              >
                更多{sourceLabels[type as SourceType]}
              </Button>
            ))}
      </div>
    </CaseForm>
  )
}

function ContextInputs({
  matterId,
  old,
  adopted,
  change,
}: {
  matterId: string
  old: InputChoice[]
  adopted: Option[]
  change: (v: Option[]) => void
}) {
  const [page, setPage] = useState<InputPage>()
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const ctrl = new AbortController()
    readPersonal<InputPage>(url(matterId, { inputs: "1" }), { signal: ctrl.signal })
      .then((v) => {
        if (!ctrl.signal.aborted) setPage(v)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message)
      })
    return () => ctrl.abort()
  }, [matterId, attempt])
  async function more(after: string) {
    setBusy(true)
    try {
      const next = await readPersonal<InputPage>(url(matterId, { inputs: "1", after }))
      setPage((prev) => ({ choices: [...(prev?.choices ?? []), ...next.choices], nextCursor: next.nextCursor }))
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败。")
    } finally {
      setBusy(false)
    }
  }
  const options = [...new Map([...old, ...(page?.choices ?? [])].map((v) => [v.selection.recordId, v])).values()]
  return (
    <fieldset className="grid gap-2 border p-2">
      <legend>本方案采用的目标与指示</legend>
      {options.map((v) => {
        const selected = adopted.find((s) => s.recordId === v.selection.recordId)
        const changed =
          !!selected &&
          (selected.expectedCurrentRecordId !== v.selection.expectedCurrentRecordId ||
            selected.expectedConfirmedAt !== v.selection.expectedConfirmedAt)
        return (
          <label key={v.selection.recordId} className="flex gap-2">
            <input
              type="checkbox"
              checked={!!selected}
              onChange={(e) => {
                change(
                  e.target.checked
                    ? [...adopted, v.selection]
                    : adopted.filter((s) => s.recordId !== v.selection.recordId)
                )
              }}
            />
            <span>
              {labels[v.kind]} · V{v.version}
              {v.historical ? " · 历史版" : ""} · {v.content}
              <small className="block">
                来源 · {v.sourceDescription} · {v.selection.expectedConfirmedAt ? "已确认" : "待确认"}
              </small>
              {changed && (
                <small className="block text-destructive">
                  该版的核对状态或后续修订已有变化。重新选择可确认沿用这份历史记录。
                </small>
              )}
            </span>
          </label>
        )
      })}
      {!options.length && page && <p>暂无可采用的目标或指示。</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setError("")
              setAttempt((v) => v + 1)
            }}
          >
            重读
          </Button>
        </p>
      )}
      {page?.nextCursor && (
        <Button type="button" disabled={busy} variant="ghost" onClick={() => void more(page.nextCursor!)}>
          更多目标与指示
        </Button>
      )}
    </fieldset>
  )
}

function ContextHistory({ matterId, record, close }: { matterId: string; record: RecordView; close: () => void }) {
  const [data, setData] = useState<{ records: RecordView[]; nextBeforeVersion: number | null }>()
  const [error, setError] = useState("")
  const [before, setBefore] = useState<number>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const c = new AbortController()
    readPersonal<{ records: RecordView[]; nextBeforeVersion: number | null }>(
      url(matterId, { history: record.id, ...(before ? { before: String(before) } : {}) }),
      { signal: c.signal }
    )
      .then((v) => {
        if (!c.signal.aborted) setData(v)
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message)
      })
    return () => c.abort()
  }, [matterId, record.id, before, attempt])
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>修订历史</SheetTitle>
        </SheetHeader>
        <div className="grid gap-3 px-4 pb-4 text-sm">
          {error && (
            <p role="alert">
              {error}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError("")
                  setAttempt((n) => n + 1)
                }}
              >
                重试
              </Button>
            </p>
          )}
          {data?.records.map((v) => (
            <p key={v.id}>
              V{v.version} · {fmt.format(new Date(v.occurredAt))} · {v.readable ? v.content : "来源不可读"}
            </p>
          ))}
          {data?.nextBeforeVersion && (
            <Button
              variant="outline"
              onClick={() => {
                setBefore(data.nextBeforeVersion!)
                setData(undefined)
              }}
            >
              更早修订
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
