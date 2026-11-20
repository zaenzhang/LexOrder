"use client"

import { usePageLoading } from "@/kit/ui-patterns/page-loading"

import { InlineLoading } from "@/kit/ui-patterns/workspace-loading"
import Link from "@/features/shell/workspace-link"
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { readPersonal } from "@/features/matters/personal-client"
import { chinaDate } from "./data"

const ep = "/api/personal/practice-resources"
const views = {
  skills: "技能方法",
  ai: "应用 AI",
  templates: "文书模板",
  resources: "资料库",
  profile: "执业资料",
  audit: "操作记录",
  reports: "业务报表",
}
type View = keyof typeof views
type Resource = {
  id: string
  name: string
  description: string | null
  category: string
  enabled?: boolean
  createdAt?: string
  updatedAt?: string
  hasNewerVersion?: boolean
}
const categories: Record<string, string> = {
  GUIDE: "办案指引",
  TEMPLATE: "参考模板",
  REFERENCE: "参考资料",
  POLICY: "制度文件",
  CONTRACT: "合同",
  LETTER: "函件",
  LICENSE: "证照",
  OTHER_FIRM: "其他资料",
}
const templates: Record<string, string> = {
  INTAKE: "收案",
  RETAINER: "委托",
  LITIGATION: "诉讼",
  EXECUTION: "执行",
  HEARING: "庭审",
  WORK_PRODUCT: "工作成果",
  ARCHIVE: "归档",
  CLOSING: "结案",
  BLANK: "通用",
}
const download = "/api/firm-files/"
function useRead<T>(view: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams({ view, ...params }).toString()
  return useQuery({
    queryKey: ["resources", query],
    queryFn: ({ signal }) => readPersonal<T>(ep + "?" + query, { signal }),
    retry: false,
  })
}
function useSave() {
  const cache = useQueryClient()
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false)
  async function save(body: object | FormData, done?: () => void) {
    setBusy(true)
    setError("")
    try {
      await readPersonal(
        ep,
        body instanceof FormData
          ? { method: "POST", body }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
      )
      done?.()
      await cache.invalidateQueries({ queryKey: ["resources"] })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { save, busy, error }
}
function FileCollection({ template }: { template: boolean }) {
  const [text, setText] = useState(""),
    [search, setSearch] = useState(""),
    [old, setOld] = useState(false)
  const [upload, setUpload] = useState(false),
    [supersedes, setSupersedes] = useState<Resource>()
  const list = useRead<Resource[]>(template ? "templates" : "resources", {
    q: search,
    old: old ? "1" : "0",
  })
  usePageLoading(!search && !old && list.isPending)
  const [history, setHistory] = useState<string>()
  const mutation = useSave()
  const rows = template
    ? list.data?.filter((row) => row.name.includes(search))
    : list.data
  const labels = template ? templates : categories
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setSearch(text.trim())
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="检索名称"
            placeholder="检索名称"
          />
          <Button variant="outline">检索</Button>
        </form>
        {!template && (
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={old}
              onChange={(e) => setOld(e.target.checked)}
            />
            含已替代资料
          </label>
        )}
        <Button
          onClick={() => {
            setSupersedes(undefined)
            setUpload(!upload)
          }}
        >
          {upload ? "返回列表" : template ? "上传 DOCX 模板" : "上传资料"}
        </Button>
      </div>
      {upload ? (
        <form
          className="grid max-w-lg gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            f.set("action", template ? "upload-template" : "upload-resource")
            if (supersedes) f.set("supersedesId", supersedes.id)
            void mutation.save(f, () => {
              setUpload(false)
              setSupersedes(undefined)
            })
          }}
        >
          {supersedes && <p>替代版本 · {supersedes.name}</p>}
          <label>
            名称
            <Input
              required
              name="name"
              maxLength={80}
              defaultValue={supersedes?.name}
            />
          </label>
          <label>
            分类
            <NativeSelect name="category">
              {Object.entries(labels)
                .filter(
                  ([k]) =>
                    template ||
                    ["GUIDE", "TEMPLATE", "REFERENCE", "POLICY"].includes(k)
                )
                .map(([k, v]) => (
                  <NativeSelectOption key={k} value={k}>
                    {v}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </label>
          <label>
            说明
            <Input name="description" maxLength={300} />
          </label>
          <label>
            文件
            <Input
              type="file"
              name="file"
              required
              accept={template ? ".docx" : undefined}
            />
          </label>
          <Button className="justify-self-start" disabled={mutation.busy}>
            上传
          </Button>
        </form>
      ) : (
        <ul className="divide-y">
          {rows?.map((row) => (
            <li
              className="flex items-center justify-between gap-4 py-3"
              key={row.id}
            >
              <div>
                <strong>{row.name}</strong>
                <p className="text-sm text-muted-foreground">
                  {labels[row.category]} ·{" "}
                  {chinaDate((row.updatedAt ?? row.createdAt)!)}
                  {row.hasNewerVersion ? " · 已有新版" : ""}
                </p>
                {row.description && <p>{row.description}</p>}
              </div>
              {template ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mutation.busy}
                  onClick={() =>
                    mutation.save({
                      action: "toggle-template",
                      id: row.id,
                      enabled: !row.enabled,
                    })
                  }
                >
                  {row.enabled ? "停用" : "启用"}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={
                      <a href={download + row.id + "/download"} download />
                    }
                  >
                    下载
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setHistory(history === row.id ? undefined : row.id)
                    }
                  >
                    版本记录
                  </Button>
                  {!row.hasNewerVersion && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSupersedes(row)
                        setUpload(true)
                      }}
                    >
                      上传新版
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {history && !upload && <ResourceHistory id={history} />}
      {!upload && rows?.length === 0 && <p>暂无匹配记录。</p>}
      {(list.error || mutation.error) && (
        <p role="alert">{list.error?.message || mutation.error}</p>
      )}
    </>
  )
}
function ResourceHistory({ id }: { id: string }) {
  const { data, error } = useRead<
    { id: string; name: string; createdAt: string }[]
  >("history", { id })
  return (
    <section>
      <h2 className="font-medium">版本记录</h2>
      {error && <p role="alert">{error.message}</p>}
      {data?.map((row) => (
        <p className="py-2" key={row.id}>
          {chinaDate(row.createdAt)} ·{" "}
          <a
            className="underline"
            href={download + row.id + "/download"}
            download
          >
            {row.name}
          </a>
        </p>
      ))}
    </section>
  )
}
function Profile() {
  const { data, error } = useRead<{
    name: string
    email: string
    phone: string | null
    updatedAt: string
  }>("profile")
  const mutation = useSave()
  const [message, setMessage] = useState("")
  usePageLoading(!data && !error)
  if (!data)
    return (
      <p role={error ? "alert" : "status"}>
        {error?.message ?? "正在读取资料…"}
      </p>
    )
  return (
    <form
      key={data.updatedAt}
      className="grid max-w-md gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        setMessage("")
        void mutation.save(
          {
            action: "profile",
            profile: {
              ...Object.fromEntries(f),
              expectedUpdatedAt: data.updatedAt,
            },
          },
          () => setMessage("执业资料已保存。")
        )
      }}
    >
      <label>
        姓名
        <Input name="name" defaultValue={data.name} maxLength={40} />
      </label>
      <label>
        邮箱
        <Input name="email" type="email" defaultValue={data.email} />
      </label>
      <label>
        联系电话
        <Input name="phone" type="tel" defaultValue={data.phone ?? ""} />
      </label>
      <Button disabled={mutation.busy} className="justify-self-start">
        保存资料
      </Button>
      {mutation.error && <p role="alert">{mutation.error}</p>}
      {message && <p role="status">{message}</p>}
    </form>
  )
}
function Audit() {
  const [q, setQ] = useState(""),
    [text, setText] = useState("")
  const { data, error } = useRead<
    {
      id: string
      author: string | null
      action: string
      targetType: string
      createdAt: string
    }[]
  >("audit", { q })
  return (
    <>
      <form
        className="flex max-w-lg gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setQ(text.trim())
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="按操作名称筛选"
          aria-label="操作名称"
        />
        <Button variant="outline">搜索</Button>
      </form>
      {error && <p role="alert">{error.message}</p>}
      {data && (
        <ul className="divide-y">
          {data.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap justify-between gap-3 py-2"
            >
              <span>
                {r.action} · {r.targetType}
              </span>
              <span>
                {r.author} · {chinaDate(r.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {data?.length === 0 && <p>最近 30 天没有匹配记录。</p>}
    </>
  )
}
function Reports() {
  const [period, setPeriod] = useState("month")
  const { data, error } = useRead<{
    label: string
    kpis: {
      newIntake: number
      inProgress: number
      closed: number
      archived: number
    }
    byCategory: { name: string; count: number }[]
    byClientReceivable: { name: string; balance: number }[]
  }>("reports", { period })
  return (
    <>
      <div className="flex gap-3">
        <NativeSelect
          aria-label="统计期间"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          {Object.entries({
            month: "本月",
            quarter: "本季度",
            year: "本年",
            lastYear: "上年",
          }).map(([k, v]) => (
            <NativeSelectOption key={k} value={k}>
              {v}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          variant="outline"
          nativeButton={false}
          render={
            <a
              href={"/api/reports/export?period=" + period}
              download
            />
          }
        >
          导出 Excel
        </Button>
      </div>
      {error && <p role="alert">{error.message}</p>}
      {data && (
        <>
          <dl className="grid grid-cols-4 gap-3">
            {Object.entries({
              newIntake: "新收",
              inProgress: "办理中",
              closed: "已结案",
              archived: "已归档",
            }).map(([k, label]) => (
              <div key={k} className="rounded-lg border p-3">
                <dt>{label}</dt>
                <dd className="text-xl font-medium">
                  {data.kpis[k as keyof typeof data.kpis]}
                </dd>
              </div>
            ))}
          </dl>
          <section>
            <h2 className="font-medium">案件类别</h2>
            {data.byCategory.length ? (
              data.byCategory.map((r) => (
                <p className="border-b py-2" key={r.name}>
                  {r.name} · {r.count}
                </p>
              ))
            ) : (
              <p>本期没有案件。</p>
            )}
          </section>
          <section>
            <h2 className="font-medium">客户应收余额</h2>
            {data.byClientReceivable.length ? (
              data.byClientReceivable.map((r, i) => (
                <p className="border-b py-2" key={i}>
                  {r.name} · ¥{r.balance.toLocaleString("zh-CN")}
                </p>
              ))
            ) : (
              <p>暂无应收余额。</p>
            )}
          </section>
        </>
      )}
    </>
  )
}
type AiSettings = { enabled: boolean; configured: boolean; credentialSaved: boolean; baseUrl: string;
  textModel: string; configurationError?: string }

function AiSettingsForm({ settings }: { settings: AiSettings }) {
  const [enabled, setEnabled] = useState(settings.enabled)
  const [key, setKey] = useState("")
  const [confirmClear, setConfirmClear] = useState(false)
  const [probe, setProbe] = useState("")
  const [probing, setProbing] = useState(false)
  const mutation = useSave()
  async function verify() {
    setProbing(true)
    setProbe("")
    try {
      const result = await readPersonal<{ ok: boolean; reply?: string; message?: string }>(ep, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "probe-ai-settings" }),
      })
      setProbe(result.ok ? result.reply ?? "文本模型已响应。" : result.message ?? "连接检查失败。")
    } catch (error) { setProbe(error instanceof Error ? error.message : "连接检查失败。") }
    finally { setProbing(false) }
  }
  return <Card className="max-w-2xl"><CardHeader><CardTitle>文本模型</CardTitle></CardHeader><CardContent className="grid gap-4">
    <form className="grid gap-3" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      setProbe("")
      void mutation.save({ action: "save-ai-settings", settings: {
        baseUrl: String(data.get("url")).trim(), textModel: String(data.get("model")).trim(), enabled, apiKey: key,
      } }, () => setKey(""))
    }}>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={enabled} onCheckedChange={setEnabled} />启用应用 AI</label>
      <label className="grid gap-2 text-sm">OpenAI 兼容 HTTPS 地址<Input name="url" type="url" required defaultValue={settings.baseUrl} /></label>
      <label className="grid gap-2 text-sm">文本模型<Input name="model" required maxLength={80} defaultValue={settings.textModel} /></label>
      <label className="grid gap-2 text-sm">API 密钥<Input type="password" autoComplete="new-password" maxLength={4096} value={key}
        placeholder={settings.credentialSaved ? "已保存。替换时填写新密钥" : "输入 API 密钥"} onChange={event => setKey(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={mutation.busy || probing}>保存配置</Button>
        <Button type="button" size="sm" variant="outline" disabled={!settings.configured || mutation.busy || probing}
          onClick={() => void verify()}>{probing ? "正在测试…" : "测试已保存的模型"}</Button>
      </div>
    </form>
    {settings.credentialSaved && <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={confirmClear} onCheckedChange={setConfirmClear} />确认清除密钥</label>
      <Button size="sm" variant="outline" disabled={!confirmClear || mutation.busy || probing}
        onClick={() => void mutation.save({ action: "clear-ai-key", confirm: true }, () => setConfirmClear(false))}>清除</Button>
    </div>}
    {(settings.configurationError || mutation.error) && <p role="alert" className="text-sm text-destructive">{mutation.error || settings.configurationError}</p>}
    {probe && <p role="status" className="text-sm">{probe}</p>}
  </CardContent></Card>
}

function AiSettingsPanel() {
  const query = useRead<AiSettings>("ai")
  usePageLoading(query.isPending)
  if (query.error) return <p role="alert">{query.error.message} <Button size="sm" variant="outline" onClick={() => void query.refetch()}>重试</Button></p>
  if (!query.data) return <InlineLoading label="正在读取应用 AI 配置…" />
  const data = query.data
  return <AiSettingsForm key={[data.enabled, data.baseUrl, data.textModel, data.credentialSaved].join("/")} settings={data} />
}

export function ResourcesDesk({ view }: { view: View }) {
  return (
    <section className="grid gap-4">
      <PageHeader title={view === "skills" ? "技能与模板" : views[view]} />
      <nav className="flex flex-wrap gap-1" aria-label="技能、模板和办案资料">
        {Object.entries(views).map(([k, v]) => (
          <Button
            size="sm"
            key={k}
            variant={k === view ? "secondary" : "ghost"}
            nativeButton={false}
            render={
              <Link
                href={`/practice/${k}`}
                aria-current={k === view ? "page" : undefined}
              />
            }
          >
            {v}
          </Button>
        ))}
      </nav>
      {view === "skills" ? <Card className="max-w-3xl">
        <CardHeader><CardTitle>对照签收与验收</CardTitle></CardHeader>
        <CardContent className="grid justify-items-start gap-3 text-sm">
          <Badge variant="outline">本机委托</Badge>
          <p>对照合同验收条款和交接清单，区分签收数量、外观核对与性能验收。</p>
          <p className="text-muted-foreground">从绑定争点的研究打开「选材发起委托」，选择固定片段，再领取宿主授权或导出输入。</p>
          <Button nativeButton={false} size="sm" variant="outline" render={<Link href="/matters/list" />}>选择案件</Button>
        </CardContent>
      </Card> : view === "ai" ? <AiSettingsPanel /> : view === "resources" || view === "templates" ? (
        <FileCollection key={view} template={view === "templates"} />
      ) : view === "profile" ? (
        <Profile />
      ) : view === "reports" ? (
        <Reports />
      ) : (
        <Audit />
      )}
    </section>
  )
}
