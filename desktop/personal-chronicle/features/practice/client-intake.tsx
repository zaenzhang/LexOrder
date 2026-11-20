"use client"

import { usePageLoading } from "@/kit/ui-patterns/page-loading"

import Link from "@/features/shell/workspace-link"
import { useRouter } from "@/kit/framework"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { DataTable, type DataColumn } from "@/kit/data-table/data-table"
import { chinaDate, usePractice, writePractice } from "./data"

type Catalog = "clients" | "intakes"
type Row = {
  id: string
  name: string
  description: string
  detail: string
  state: string
}
type List = {
  items: Row[]
  pageSize: number
  total: number
  categories?: Record<string, string>
  standings?: Record<string, string>
}
type Hits = { id: string; severity: string; reason: string }[]
type Intake = {
  title: string
  label: string
  status: string
  description?: string
  client?: string
  reason?: string
  matter?: { id: string; title: string }
  check?: { id: string; conclusion: string; note?: string; hits: Hits }
}
type Client = {
  name: string
  phone?: string
  email?: string
  contacts: { id: string; name: string; title?: string; phone?: string }[]
  matters: { id: string; title: string }[]
  relationship?: {
    canWrite: boolean
    activities: { id: string; content: string; occurredAt: string }[]
    followUps: { id: string; title: string; dueAt: string; canClose: boolean }[]
  }
}
const names = { clients: "客户", intakes: "收案" }

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const client = useQueryClient()
  async function run(work: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await work()
      await client.invalidateQueries({ queryKey: ["practice"] })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function field(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim()
}
const fieldClass = "grid gap-1.5 text-sm"

export function CatalogPage({
  view,
  creatingIntake = false,
}: {
  view: Catalog
  creatingIntake?: boolean
}) {
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState({ q: "", page: "1" })
  const [addingClient, setAddingClient] = useState(false)
  const adding = view === "intakes" ? creatingIntake : addingClient
  const [category, setCategory] = useState("CIVIL_COMMERCIAL")
  const [useExisting, setUseExisting] = useState(false)
  const [clientSearch, setClientSearch] = useState("")
  const [clientQuery, setClientQuery] = useState("")
  const { data, error } = usePractice<List>(view, query)
  usePageLoading(!data && !error && !query.q && query.page === "1")
  const options = usePractice<List>(
    "clients",
    { q: clientQuery },
    view === "intakes" && adding && useExisting
  )
  const router = useRouter()
  const mutation = useAction()
  const isClient = view === "clients"
  const litigation = [
    "CIVIL_COMMERCIAL",
    "LABOR_ARBITRATION",
    "COMMERCIAL_ARBITRATION",
    "CRIMINAL",
    "ADMINISTRATIVE",
  ].includes(category)
  const columns: DataColumn<Row>[] = [
    {
      id: "name",
      header: names[view],
      cell: (row) => (
        <Link
          href={`/practice/${view}/${row.id}`}
          className="font-medium hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    { id: "description", header: "类别", cell: (row) => row.description },
    {
      id: "detail",
      header: isClient ? "电话" : "委托方",
      cell: (row) => row.detail || "—",
    },
    { id: "state", header: "状态", cell: (row) => row.state },
  ]
  async function create(form: FormData) {
    const input = isClient
      ? {
          name: field(form, "name"),
          type: field(form, "clientType"),
          phone: field(form, "phone"),
          email: field(form, "email"),
        }
      : {
          title: field(form, "name"),
          category,
          ...(useExisting
            ? { clientId: field(form, "clientId") }
            : {
                clientName: field(form, "clientName"),
                clientType: field(form, "clientType"),
              }),
          description: field(form, "description"),
          ...(litigation ? { ourStanding: field(form, "standing") } : {}),
          parties: field(form, "opponent")
            ? [
                {
                  role: "OPPOSING_PARTY",
                  name: field(form, "opponent"),
                  ...(litigation
                    ? { standing: field(form, "opposingStanding") }
                    : {}),
                },
              ]
            : [],
        }
    const result = await writePractice<{ id: string }>({
      action: isClient ? "create-client" : "create-intake",
      input,
    })
    router.push(`/practice/${view}/${result.id}`)
  }
  return (
    <section className="flex flex-col gap-5">
      <PageHeader
        title={creatingIntake ? "新建收案" : names[view]}
        actions={
          isClient ? (
            <Button onClick={() => setAddingClient(!addingClient)} disabled={mutation.busy}>
              {adding ? "返回列表" : "新建客户"}
            </Button>
          ) : (
            <Link
              className={buttonVariants({ variant: creatingIntake ? "outline" : "default" })}
              href={creatingIntake ? "/practice/intakes" : "/practice/intakes?create=1"}
              aria-disabled={mutation.busy}
              onClick={(event) => {
                if (mutation.busy) event.preventDefault()
              }}
            >
              {creatingIntake ? "返回列表" : "新建收案"}
            </Link>
          )
        }
      />
      {adding ? (
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            void mutation.run(() => create(form))
          }}
        >
          <label className={fieldClass}>
            {isClient ? "客户名称" : "案件名称"}
            <Input name="name" required maxLength={isClient ? 120 : 200} />
          </label>
          {!isClient && (
            <>
              <label className={fieldClass}>
                案件类别
                <NativeSelect
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {Object.entries(data?.categories ?? {}).map(([k, v]) => (
                    <NativeSelectOption key={k} value={k}>
                      {v}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useExisting}
                  onChange={(e) => setUseExisting(e.target.checked)}
                />
                关联已有客户
              </label>
              {useExisting ? (
                <>
                  <div className="flex gap-2">
                    <Input
                      aria-label="检索已有客户"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setClientQuery(clientSearch.trim())}
                    >
                      查找
                    </Button>
                  </div>
                  <label className={fieldClass}>
                    委托方
                    <NativeSelect name="clientId" required defaultValue="">
                      <NativeSelectOption value="">选择客户</NativeSelectOption>
                      {options.data?.items.map((c) => (
                        <NativeSelectOption key={c.id} value={c.id}>
                          {c.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                </>
              ) : (
                <label className={fieldClass}>
                  新委托方名称
                  <Input name="clientName" required maxLength={120} />
                </label>
              )}
            </>
          )}
          {(isClient || !useExisting) && (
            <label className={fieldClass}>
              客户类型
              <NativeSelect name="clientType">
                <NativeSelectOption value="INDIVIDUAL">
                  自然人
                </NativeSelectOption>
                <NativeSelectOption value="COMPANY">企业</NativeSelectOption>
                <NativeSelectOption value="ORGANIZATION">
                  其他组织
                </NativeSelectOption>
              </NativeSelect>
            </label>
          )}
          {isClient ? (
            <>
              <label className={fieldClass}>
                电话
                <Input name="phone" type="tel" />
              </label>
              <label className={fieldClass}>
                邮箱
                <Input name="email" type="email" />
              </label>
            </>
          ) : (
            <>
              {litigation && (
                <label className={fieldClass}>
                  委托方诉讼地位
                  <NativeSelect name="standing" required defaultValue="">
                    <NativeSelectOption value="">请选择</NativeSelectOption>
                    {Object.entries(data?.standings ?? {}).map(([k, v]) => (
                      <NativeSelectOption key={k} value={k}>
                        {v}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              )}
              <label className={fieldClass}>
                对方当事人
                <Input name="opponent" maxLength={120} />
              </label>
              {litigation && (
                <label className={fieldClass}>
                  对方诉讼地位
                  <NativeSelect
                    name="opposingStanding"
                    defaultValue="DEFENDANT"
                  >
                    {Object.entries(data?.standings ?? {}).map(([k, v]) => (
                      <NativeSelectOption key={k} value={k}>
                        {v}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              )}
              <label className={fieldClass}>
                案情简述
                <Textarea name="description" maxLength={2000} />
              </label>
            </>
          )}
          <Button type="submit" className="justify-self-start" disabled={mutation.busy}>
            保存{names[view]}
          </Button>
        </form>
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setQuery({ q: search.trim(), page: "1" })
            }}
          >
            <Input
              aria-label={"搜索" + names[view]}
              placeholder={"搜索" + names[view]}
              className="max-w-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button variant="outline">搜索</Button>
          </form>
          {!error && (
            <DataTable
              rows={data?.items}
              loading={!data}
              columns={columns}
              getRowId={(row) => row.id}
              sort={[]}
              onSortChange={() => {}}
              label={names[view]}
              empty={<p>没有匹配记录。</p>}
            />
          )}
          {data && data.total > data.pageSize && (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={+query.page <= 1}
                onClick={() =>
                  setQuery({ ...query, page: String(+query.page - 1) })
                }
              >
                上一页
              </Button>
              <span>
                {query.page} / {Math.ceil(data.total / data.pageSize)}
              </span>
              <Button
                variant="outline"
                disabled={+query.page * data.pageSize >= data.total}
                onClick={() =>
                  setQuery({ ...query, page: String(+query.page + 1) })
                }
              >
                下一页
              </Button>
            </div>
          )}
        </>
      )}
      {(error || mutation.error) && (
        <p role="alert">{error?.message || mutation.error}</p>
      )}
    </section>
  )
}

export function ClientPage({ id }: { id: string }) {
  const { data, error } = usePractice<Client>("client", { id })
  usePageLoading(!data && !error)
  const mutation = useAction()
  const [requestKey, setKey] = useState(() => crypto.randomUUID())
  if (!data)
    return (
      <p role={error ? "alert" : "status"}>
        {error?.message ?? "正在读取客户…"}
      </p>
    )
  const relationship = data.relationship
  return (
    <section className="flex max-w-3xl flex-col gap-5">
      <Link className="text-sm underline" href="/practice/clients">
        返回客户
      </Link>
      <PageHeader
        title={data.name}
        description={
          [data.phone, data.email].filter(Boolean).join(" · ") || undefined
        }
      />
      <section className="grid gap-3">
        <h2 className="font-medium">客户联系人</h2>
        {data.contacts.map((c) => (
          <p key={c.id}>
            {[c.name, c.title, c.phone].filter(Boolean).join(" · ")}
          </p>
        ))}
        <details>
          <summary className="cursor-pointer">添加联系人</summary>
          <form
            className="mt-3 grid max-w-md gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const node = event.currentTarget,
                input = Object.fromEntries(new FormData(node))
              void mutation.run(async () => {
                await writePractice({ action: "client-contact", id, input })
                node.reset()
              })
            }}
          >
            <label>
              姓名
              <Input name="name" required maxLength={40} />
            </label>
            <label>
              职务
              <Input name="title" maxLength={40} />
            </label>
            <label>
              电话
              <Input name="phone" type="tel" maxLength={30} />
            </label>
            <Button disabled={mutation.busy} className="justify-self-start">
              保存联系人
            </Button>
          </form>
        </details>
      </section>
      <div>
        <h2 className="mb-2 font-medium">关联案件</h2>
        {data.matters.length ? (
          data.matters.map((m) => (
            <Link
              className="mr-3 underline"
              key={m.id}
              href={`/matters/${m.id}/overview`}
            >
              {m.title}
            </Link>
          ))
        ) : (
          <p>暂无关联案件。</p>
        )}
      </div>
      {relationship?.followUps.length ? (
        <div>
          <h2 className="font-medium">待跟进</h2>
          {relationship.followUps.map((r) => (
            <p key={r.id}>
              {chinaDate(r.dueAt)} · {r.title}
            </p>
          ))}
        </div>
      ) : null}
      {relationship?.canWrite && (
        <form
          className="grid max-w-xl gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const node = e.currentTarget,
              f = new FormData(node)
            void mutation.run(async () => {
              await writePractice({
                action: "client-activity",
                input: {
                  clientId: id,
                  requestKey,
                  content: field(f, "content"),
                  channel: field(f, "channel"),
                  occurredAt: new Date().toISOString(),
                  followUpId: field(f, "followUpId") || undefined,
                  ...(field(f, "nextTitle")
                    ? {
                        nextFollowUp: {
                          title: field(f, "nextTitle"),
                          dueAt: new Date(
                            field(f, "dueAt") + ":00+08:00"
                          ).toISOString(),
                        },
                      }
                    : {}),
                },
              })
              node.reset()
              setKey(crypto.randomUUID())
            })
          }}
        >
          <label className={fieldClass}>
            沟通记录
            <Textarea name="content" required maxLength={8000} />
          </label>
          <label className={fieldClass}>
            渠道
            <NativeSelect name="channel">
              {Object.entries({
                PHONE: "电话",
                WECHAT: "微信",
                EMAIL: "邮件",
                MEETING: "面谈",
                COURT: "庭审",
                OTHER: "其他",
              }).map(([k, v]) => (
                <NativeSelectOption key={k} value={k}>
                  {v}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {relationship.followUps.some((v) => v.canClose) && (
            <label className={fieldClass}>
              本次办结
              <NativeSelect name="followUpId">
                <NativeSelectOption value="">单独记录</NativeSelectOption>
                {relationship.followUps
                  .filter((v) => v.canClose)
                  .map((v) => (
                    <NativeSelectOption key={v.id} value={v.id}>
                      {v.title}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </label>
          )}
          <label className={fieldClass}>
            下次跟进事项
            <Input name="nextTitle" maxLength={200} />
          </label>
          <label className={fieldClass}>
            下次跟进时间（上海）
            <Input type="datetime-local" name="dueAt" />
          </label>
          <Button className="justify-self-start" disabled={mutation.busy}>
            保存沟通记录
          </Button>
        </form>
      )}
      {mutation.error && <p role="alert">{mutation.error}</p>}
      <div>
        <h2 className="font-medium">最近沟通</h2>
        {relationship?.activities.map((a) => (
          <p key={a.id} className="border-b py-2">
            {chinaDate(a.occurredAt)} · {a.content}
          </p>
        ))}
      </div>
    </section>
  )
}

function IntakeRevision({ id }: { id: string }) {
  const { data, error } = usePractice<{
    title: string
    description?: string
    revision: number
  }>("intake-edit", { id })
  const mutation = useAction()
  const [saved, setSaved] = useState(false)
  if (!data)
    return (
      <p role={error ? "alert" : "status"}>
        {error?.message ?? "正在读取本轮资料…"}
      </p>
    )
  return (
    <form
      key={data.revision}
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        const f = new FormData(event.currentTarget)
        setSaved(false)
        void mutation.run(async () => {
          await writePractice({
            action: "revise-intake",
            id,
            revision: data.revision,
            title: field(f, "title"),
            description: field(f, "description"),
          })
          setSaved(true)
        })
      }}
    >
      <label>
        案件名称
        <Input
          name="title"
          defaultValue={data.title}
          required
          maxLength={200}
        />
      </label>
      <label>
        案情简述
        <Textarea
          name="description"
          defaultValue={data.description ?? ""}
          maxLength={2000}
        />
      </label>
      <Button
        className="justify-self-start"
        variant="outline"
        disabled={mutation.busy}
      >
        保存本轮资料
      </Button>
      {saved && <p role="status">已保存收案资料。</p>}
      {mutation.error && <p role="alert">{mutation.error}</p>}
    </form>
  )
}

export function IntakePage({ id }: { id: string }) {
  const [revise, setRevise] = useState(false)
  const { data, error } = usePractice<Intake>("intake", { id })
  usePageLoading(!data && !error)
  const mutation = useAction()
  const router = useRouter()
  if (!data)
    return (
      <p role={error ? "alert" : "status"}>
        {error?.message ?? "正在读取收案…"}
      </p>
    )
  const editable = ["INTAKE", "NEEDS_REVISION"].includes(data.status)
  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <Link href="/practice/intakes" className="text-sm underline">
        返回收案
      </Link>
      <PageHeader
        title={data.title}
        description={[data.client, data.label].filter(Boolean).join(" · ")}
      />
      {editable && (
        <>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => setRevise(!revise)}
          >
            {revise ? "收起编辑" : "补正名称与案情"}
          </Button>
          {revise && <IntakeRevision id={id} />}
        </>
      )}
      {data.status === "PENDING_CONFIRMATION" && (
        <details>
          <summary className="cursor-pointer">撤回本轮并补正</summary>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              const reason = field(new FormData(e.currentTarget), "reason")
              void mutation.run(() =>
                writePractice({ action: "withdraw-intake", id, reason })
              )
            }}
          >
            <label>
              撤回原因
              <Textarea name="reason" required maxLength={1000} />
            </label>
            <Button
              className="justify-self-start"
              variant="outline"
              disabled={mutation.busy}
            >
              确认撤回本轮
            </Button>
          </form>
        </details>
      )}
      {data.description && <p>{data.description}</p>}
      {data.reason && <p>补正意见 · {data.reason}</p>}
      {data.matter && (
        <Link
          className="underline"
          href={`/matters/${data.matter.id}/overview`}
        >
          打开案卷 · {data.matter.title}
        </Link>
      )}
      <div>
        <h2 className="font-medium">利益冲突核查</h2>
        <p>{data.check?.conclusion ?? "尚未检索"}</p>
        {data.check?.note && <p>{data.check.note}</p>}
        {data.check?.hits.map((h) => (
          <p key={h.id}>
            {h.severity} · {h.reason}
          </p>
        ))}
      </div>
      {editable && (
        <Button
          variant="outline"
          className="self-start"
          disabled={mutation.busy}
          onClick={() =>
            mutation.run(() => writePractice({ action: "check-intake", id }))
          }
        >
          按本案当事人检索
        </Button>
      )}
      {editable && data.check && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            void mutation.run(() =>
              writePractice({
                action: "decide-conflict",
                id: data.check!.id,
                conclusion: field(f, "conclusion"),
                note: field(f, "note"),
              })
            )
          }}
        >
          <label className={fieldClass}>
            人工结论
            <NativeSelect name="conclusion" required defaultValue="">
              <NativeSelectOption value="">请选择</NativeSelectOption>
              <NativeSelectOption value="DIFFERENT">
                可排除冲突
              </NativeSelectOption>
              <NativeSelectOption value="SAME_SUBJECT">
                存在冲突
              </NativeSelectOption>
              <NativeSelectOption value="NEED_INFO">
                需补充信息
              </NativeSelectOption>
            </NativeSelect>
          </label>
          <label className={fieldClass}>
            核查依据
            <Textarea name="note" required maxLength={500} />
          </label>
          <Button
            type="submit"
            variant="outline"
            className="justify-self-start"
            disabled={mutation.busy}
          >
            登记核查结论
          </Button>
        </form>
      )}
      {editable && (
        <Button
          className="self-start"
          disabled={mutation.busy}
          onClick={() =>
            mutation.run(() => writePractice({ action: "submit-intake", id }))
          }
        >
          提交本轮收案
        </Button>
      )}
      {data.status === "PENDING_CONFIRMATION" && (
        <Button
          className="self-start"
          disabled={mutation.busy}
          onClick={() =>
            mutation.run(async () => {
              const result = await writePractice<{ matterId: string }>({
                action: "convert-intake",
                id,
              })
              router.push(`/matters/${result.matterId}/overview`)
            })
          }
        >
          本人确认并转为案件
        </Button>
      )}
      {mutation.error && <p role="alert">{mutation.error}</p>}
    </section>
  )
}

export function ConflictPrecheck() {
  const [result, setResult] = useState<{ hits: Hits; sameName: number }>()
  const mutation = useAction()
  return (
    <section className="grid max-w-2xl gap-4">
      <PageHeader title="利益冲突预检" />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const name = field(new FormData(e.currentTarget), "name")
          setResult(undefined)
          void mutation.run(async () =>
            setResult(await writePractice({ action: "precheck", name }))
          )
        }}
      >
        <Input
          name="name"
          aria-label="当事人姓名或名称"
          placeholder="当事人姓名或名称"
          required
          maxLength={120}
        />
        <Button disabled={mutation.busy}>预检</Button>
      </form>
      {result && (
        <div role="status">
          <p>
            提示 {result.hits.length} 项，同名客户 {result.sameName} 项。
          </p>
          {result.hits.map((h) => (
            <p key={h.id}>
              {h.severity} · {h.reason}
            </p>
          ))}
          <Link href="/practice/intakes" className="underline">
            到具体收案登记正式核查
          </Link>
        </div>
      )}
      {mutation.error && <p role="alert">{mutation.error}</p>}
    </section>
  )
}

const contactTypes: Record<string, string> = {
  COURT: "法院",
  PROSECUTOR: "检察院",
  POLICE: "公安",
  NOTARY: "公证",
  ARBITRATION: "仲裁",
  OTHER_FIRM: "其他律所",
  EXPERT: "鉴定专家",
  OTHER: "其他",
}
export function ContactsPage() {
  const [q, setQ] = useState(""),
    [adding, setAdding] = useState(false)
  const { data, error } = usePractice<
    {
      id: string
      name: string
      category: string
      organization?: string
      phone?: string
      status: string
    }[]
  >("contacts", { q })
  const mutation = useAction()
  return (
    <section className="grid gap-4">
      <PageHeader
        title="外部联系人"
        actions={
          <Button onClick={() => setAdding(!adding)}>
            {adding ? "收起表单" : "添加联系人"}
          </Button>
        }
      />
      {adding && (
        <form
          className="grid max-w-lg gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const input = Object.fromEntries(new FormData(e.currentTarget))
            void mutation.run(async () => {
              await writePractice({ action: "create-contact", ...input })
              setQ("")
              setAdding(false)
            })
          }}
        >
          <label>
            姓名
            <Input required name="name" maxLength={60} />
          </label>
          <label>
            类别
            <NativeSelect name="category">
              {Object.entries(contactTypes).map(([key, label]) => (
                <NativeSelectOption key={key} value={key}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label>
            单位
            <Input name="organization" maxLength={120} />
          </label>
          <label>
            电话
            <Input type="tel" name="phone" maxLength={30} />
          </label>
          <Button className="justify-self-start" disabled={mutation.busy}>
            保存联系人
          </Button>
        </form>
      )}
      <form
        className="flex max-w-sm gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setQ(field(new FormData(e.currentTarget), "q"))
        }}
      >
        <Input
          name="q"
          aria-label="姓名、单位或电话"
          placeholder="姓名、单位或电话"
        />
        <Button variant="outline">搜索</Button>
      </form>
      {data && (
        <ul className="divide-y">
          {data.map((row) => (
            <li key={row.id} className="py-3">
              <strong>{row.name}</strong>
              <p>
                {[
                  contactTypes[row.category],
                  row.organization,
                  row.phone,
                  row.status === "PENDING_REVIEW" ? "待审核" : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {data?.length === 0 && <p>没有匹配的联系人。</p>}
      {(error || mutation.error) && (
        <p role="alert">{error?.message || mutation.error}</p>
      )}
    </section>
  )
}
