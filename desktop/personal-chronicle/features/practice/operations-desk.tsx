"use client"

import { usePageLoading } from "@/kit/ui-patterns/page-loading"

import Link from "@/features/shell/workspace-link"
import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { readPersonal, type Matter } from "@/features/matters/personal-client"

const endpoint = "/api/personal/practice-operations"
const tabs = { express: "快递收寄", preservation: "财产保全", closure: "归档检查" }
const types = { PRE_LITIGATION: "诉前保全", LITIGATION: "诉讼保全", ENFORCEMENT: "执行保全" }
const propertyTypes = { BANK_DEPOSIT: "银行存款", REAL_ESTATE: "不动产", VEHICLE: "车辆", EQUITY: "股权", IP: "知识产权", OTHER: "其他财产" }
const states: Record<string, string> = { ACTIVE: "生效中", RENEWED: "已续期", EXPIRED: "已到期", LIFTED: "已解除", APPROVED: "已归档", REJECTED: "已退回", PENDING_REVIEW: "待审核" }
type Property = { id: string; type: keyof typeof propertyTypes; detail?: string; expiry: string; status: string; amount?: number; renewals: { id: string; date: string; note?: string }[] }
type Preservation = { id: string; court?: string; rulingNumber?: string; type: keyof typeof types; status: string; note?: string; targets: { id: string; name: string; properties: Property[] }[] }
type Express = { id: string; direction: string; purpose: string; trackingNo: string; company?: string; recipient?: string; state?: string; traces?: { time: string; desc: string }[] }
type Plan = { date: string; reason: string; personalFinance: boolean; revision: number; current: boolean }
type Data = { matter: Matter; writable: boolean; items?: (Preservation | Express)[]; blockers?: string[]; financeOpen?: boolean; plan?: Plan; archives?: { id: string; no: string; status: string }[] }
type Dialog = { kind: "express" | "preserve" | "closure" } | { kind: "renew"; property: Property }
const day = (v: string | Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v))
const href = (id: string, section: keyof typeof tabs) => "/practice/operations?matter=" + encodeURIComponent(id) + "&section=" + section

function Select({ name, options, optional = false }: { name: string; options: Record<string, string>; optional?: boolean }) {
  return <NativeSelect name={name} required={!optional}>{optional && <NativeSelectOption value="">暂不登记</NativeSelectOption>}
    {Object.entries(options).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect>
}

function OperationForm({ matterId, dialog, data, busy, submit }: { matterId: string; dialog: Dialog; data: Data; busy: boolean; submit: (body: object) => Promise<void> }) {
  const [property, setProperty] = useState(false)
  const [self, setSelf] = useState(data.plan?.personalFinance ?? !!data.financeOpen)
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const text = (k: string) => String(f.get(k) ?? "").trim() || undefined
    const date = (k: string) => text(k) ? text(k) + "T00:00:00+08:00" : undefined
    const start = date("start"), expiry = date("expiry")
    const days = start && expiry ? Math.round((Date.parse(expiry) - Date.parse(start)) / 86400000) : undefined
    let fields
    if (dialog.kind === "express") fields = { trackingNo: text("trackingNo"), companyCode: text("company"), purpose: text("purpose"), recipient: text("recipient"), recipientPhone: text("phone"), direction: text("direction") }
    else if (dialog.kind === "preserve") fields = { type: text("type"), rulingNumber: text("ruling"), court: text("court"), appliedAt: date("applied"), guaranteeType: text("guarantee"), note: text("note"), firstTarget: text("target"),
      ...(property ? { firstPropertyType: text("property"), firstPropertyDetail: text("detail"), firstAmount: text("amount"), firstStartDate: start, firstExpiryDate: expiry, firstDuration: days } : {}) }
    else if (dialog.kind === "renew") fields = { propertyId: dialog.property.id, newExpiryDate: expiry, renewalDuration: expiry ? Math.round((Date.parse(expiry) - Date.parse(day(dialog.property.expiry) + "T00:00:00+08:00")) / 86400000) : undefined, note: text("note") }
    else fields = { revision: data.plan?.revision ?? null, reason: text("reason"), serviceCompletedAt: date("completed"), personalFinance: self }
    void submit({ action: dialog.kind, matterId, ...fields })
  }
  return <form onSubmit={save}><fieldset disabled={busy} className="grid gap-3 text-sm">
    {dialog.kind === "express" && <>
      <label>方向<Select name="direction" options={{ OUTBOUND: "寄出", INBOUND: "收件" }} /></label>
      <label>运单号<Input name="trackingNo" minLength={6} maxLength={40} required /></label>
      <label>快递公司<Input name="company" maxLength={20} placeholder="可按运单号识别" /></label>
      <label>用途<Input name="purpose" maxLength={200} required /></label>
      <label>收件人或单位<Input name="recipient" maxLength={80} /></label>
      <label>联系电话<Input name="phone" maxLength={20} /></label>
    </>}
    {dialog.kind === "preserve" && <>
      <label>保全类型<Select name="type" options={types} /></label>
      <label>法院<Input name="court" maxLength={80} /></label><label>裁定书号<Input name="ruling" maxLength={80} /></label>
      <label>担保方式<Select name="guarantee" options={{ CASH_DEPOSIT: "保证金", GUARANTEE_LETTER: "保函", PROPERTY: "财产担保", NONE: "无担保" }} optional /></label>
      <label>申请日期<Input name="applied" type="date" /></label><label>被保全人<Input name="target" required={property} maxLength={200} /></label>
      <label className="flex items-center gap-2"><Checkbox checked={property} onCheckedChange={setProperty} />登记首笔保全财产</label>
      {property && <><label>财产类别<Select name="property" options={propertyTypes} /></label><label>财产详情<Input name="detail" maxLength={500} /></label>
        <label>金额（元）<Input name="amount" type="number" min="0" step="0.01" /></label>
        <label>生效日期<Input name="start" type="date" required /></label><label>到期日期<Input name="expiry" type="date" required /></label></>}
      <label>备注<Textarea name="note" maxLength={500} /></label>
    </>}
    {dialog.kind === "renew" && <><p>原到期日 {day(dialog.property.expiry)}</p><label>新到期日<Input name="expiry" type="date" required /></label><label>续期说明<Textarea name="note" maxLength={300} /></label></>}
    {dialog.kind === "closure" && <>
      <label>服务完成日期<Input name="completed" type="date" required max={day(new Date())} defaultValue={data.plan ? day(data.plan.date) : ""} /></label>
      <label>服务完成及未结事项安排<Textarea name="reason" defaultValue={data.plan?.reason} required maxLength={2000} /></label>
      <label className="flex items-center gap-2"><Checkbox checked={self} onCheckedChange={setSelf} />由本人负责后续财务收尾</label>
    </>}
    <Button type="submit" disabled={busy}>{busy ? "正在保存…" : "保存"}</Button>
  </fieldset></form>
}

export function OperationsDesk({ matterId, section }: { matterId?: string; section: keyof typeof tabs }) {
  const [query, setQuery] = useState("")
  const [matters, setMatters] = useState<Matter[]>()
  const [data, setData] = useState<Data>()
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [dialogError, setDialogError] = useState("")
  const [dialog, setDialog] = useState<Dialog>()
  const [busy, setBusy] = useState(false)

  usePageLoading(!error && (matterId ? !data : !matters))

  useEffect(() => {
    const c = new AbortController()
    const t = window.setTimeout(() => {
      const load = matterId ? readPersonal<Data>(endpoint + "?matter=" + encodeURIComponent(matterId) + "&section=" + section, { signal: c.signal })
        .then(r => { if (!c.signal.aborted) setData(r) })
        : readPersonal<{ matters: Matter[] }>(endpoint + "?q=" + encodeURIComponent(query), { signal: c.signal }).then(r => { if (!c.signal.aborted) setMatters(r.matters) })
      load.catch(e => { if (!c.signal.aborted) setError(e.message) })
    }, matterId || !query ? 0 : 150)
    return () => { c.abort(); window.clearTimeout(t) }
  }, [matterId, section, query, refresh])
  function show(form: Dialog) { setDialogError(""); setDialog(form) }
  async function submit(body: object) {
    if (busy) return
    setBusy(true); setDialogError(""); setError("")
    try {
      await readPersonal(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      setDialog(undefined); setFeedback("已保存。"); setRefresh(n => n + 1)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "操作失败。"
      if (dialog) setDialogError(msg); else setError(msg)
    } finally { setBusy(false) }
  }
  return <section className="grid min-w-0 gap-4"><PageHeader title="办案事务" description={data ? data.matter.internalCode + " · " + data.matter.title : undefined} />
    {!matterId && <><Button className="justify-self-start" variant="outline" nativeButton={false} render={<Link href="/practice/operations/court-inbox" />}>法院来件</Button><Input aria-label="搜索案件" placeholder="按案件名称或编号搜索" value={query} onChange={e => {setQuery(e.target.value);setError("");setMatters(undefined)}} />
      <ul className="divide-y">{matters?.map(m => <li key={m.id} className="py-3"><Link className="font-medium hover:underline" href={href(m.id,section)}>{m.internalCode} · {m.title}</Link></li>)}</ul>{matters?.length === 0 && <p>暂无匹配案件。</p>}</>}
    {matterId && <><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" nativeButton={false} render={<Link href="/practice/operations" />}>切换案件</Button>
      {(Object.keys(tabs) as (keyof typeof tabs)[]).map(k => <Button key={k} size="sm" variant={section === k ? "secondary" : "ghost"} nativeButton={false} render={<Link href={href(matterId,k)} aria-current={section === k ? "page" : undefined} />}>{tabs[k]}</Button>)}</div>
      {feedback && <p role="status" className="text-sm">{feedback}</p>}
      {data?.writable && <Button className="justify-self-start" onClick={() => show({ kind: section === "express" ? "express" : section === "preservation" ? "preserve" : "closure" })}>
        {section === "express" ? "登记快递" : section === "preservation" ? "登记保全" : "填写收尾安排"}</Button>}
      {data && section === "express" && <ul className="grid gap-3">{(data.items as Express[]).map(item => <li key={item.id}><Card><CardContent className="grid gap-2">
        <strong>{item.direction === "INBOUND" ? "收件" : "寄出"} · {item.purpose}</strong><p className="text-sm">{item.company} {item.trackingNo} · {item.state || "暂无轨迹"}</p>
        {item.recipient && <p className="text-sm">收件人 {item.recipient}</p>}{item.traces?.map((r,i) => <p key={i} className="text-sm">{r.time} {r.desc}</p>)}
        <Button size="sm" variant="outline" className="justify-self-start" disabled={busy} onClick={() => submit({ action: "track", matterId, id: item.id })}>查询轨迹</Button>
      </CardContent></Card></li>)}</ul>}
      {data && section === "preservation" && <ul className="grid gap-3">{(data.items as Preservation[]).map(item => <li key={item.id}><Card><CardContent className="grid gap-2">
        <strong>{types[item.type]} · {states[item.status] || item.status}</strong><p className="text-sm">{[item.court,item.rulingNumber,item.note].filter(Boolean).join(" · ")}</p>
        {item.targets.map(t => <div key={t.id} className="text-sm"><strong>{t.name}</strong>{t.properties.map(p => <div className="grid gap-1 py-1" key={p.id}>
          <span>{propertyTypes[p.type]} · {p.detail} {p.amount != null && '¥'+p.amount} · {day(p.expiry)} 到期 · {states[p.status]}</span>
          {p.renewals.map(r => <p className="text-muted-foreground" key={r.id}>续至 {day(r.date)} {r.note}</p>)}
          {data.writable && p.status !== "LIFTED" && <Button size="sm" variant="outline" className="justify-self-start" onClick={() => show({ kind: "renew", property: p })}>登记续期</Button>}</div>)}</div>)}
      </CardContent></Card></li>)}</ul>}
      {data?.items?.length === 0 && <p className="text-sm text-muted-foreground">本案暂无{tabs[section]}记录。</p>}
      {data && section === "closure" && <Card><CardContent className="grid gap-2 text-sm"><strong>归档前待处理事项</strong>
        <Button size="sm" variant="outline" className="justify-self-start" nativeButton={false} render={<Link href={"/practice/archive?matter="+data.matter.id} />}>办理归档与导出</Button>
        {data.blockers?.length ? <ul className="list-disc ps-5">{data.blockers.map(b => <li key={b}>{b}</li>)}</ul> : <p>当前检查未发现阻断事项。</p>}
        <p>{data.financeOpen ? "仍有未结财务。" : "当前无未结财务。"}</p>
        {data.plan && <p>收尾安排 V{data.plan.revision} · {data.plan.current ? "与当前案况一致" : "案况已变，请重新核对"} · {day(data.plan.date)}<br />{data.plan.reason}</p>}
        {data.archives?.map(a => <p key={a.id}>{a.no} · {states[a.status] || a.status}</p>)}</CardContent></Card>}
    </>}
    {error && <p role="alert">{error} <Button variant="outline" size="sm" onClick={() => {setError("");setRefresh(n=>n+1)}}>重新读取</Button></p>}
    <Sheet open={!!dialog} onOpenChange={open => { if (!open && !busy) setDialog(undefined) }}><SheetContent className="overflow-y-auto motion-reduce:transition-none">
      <SheetHeader><SheetTitle>{dialog?.kind === "renew" ? "登记保全续期" : tabs[section]}</SheetTitle></SheetHeader>
      {dialog && data && matterId && <div className="grid gap-3 px-4 pb-4">{dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}
        <OperationForm matterId={matterId} dialog={dialog} data={data} busy={busy} submit={submit} /></div>}
    </SheetContent></Sheet>
  </section>
}
