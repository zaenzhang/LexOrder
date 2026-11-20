"use client"

import { WorkspaceLoading } from "@/kit/ui-patterns/workspace-loading"
import Link from "@/features/shell/workspace-link"
import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/kit/ui-patterns/page-header"
import { readPersonal } from "@/features/matters/personal-client"

import { ContractWorkspace, type ContractLedger } from "./finance-contracts"

const endpoint = "/api/personal/finance-desk"
const kinds = { LAWYER_FEE: "律师费", CLIENT_FUNDS: "代收款", EXPENSE_RECOVERY: "代垫回收", OTHER: "其他款项" }
const labels: Record<string, string> = { RECEIVED: "实收", COST: "支出", RECEIVABLE: "应收", COMMISSION: "分成", REFUND: "退款", PENDING: "待确认", CONFIRMED: "已确认" }
const money = (v: string | number) => Number(v).toLocaleString("zh-CN", { style: "currency", currency: "CNY" })
const date = (v: string) => new Date(v).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
type Matter = { id: string; title: string; internalCode: string }
type Receipt = { id: string; matterId: string; amount: number | string; date: string; payer?: string | null; matterTitle?: string; actionable: boolean }
type Entry = { id: string; amount: number | string; date: string; state: string; type: string; matterId?: string; matterTitle?: string }
type Data = ContractLedger & { ready?: boolean; canWrite?: boolean; matters?: Matter[]; metrics: [string, string | number][]; pending: Receipt[]; entries: Entry[];
}
type Dialog = { kind: "register" } | { kind: "review"; receipt: Receipt }

async function post(body: object) {
  return readPersonal(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

function Register({ matterId, data, saved, busy, setBusy }: { matterId: string; data: Data; saved: (text: string) => void; busy: boolean; setBusy: (v: boolean) => void }) {
  const [type, setType] = useState("receipt")
  const [kind, setKind] = useState("LAWYER_FEE")
  const [billingId, setBillingId] = useState("")
  const [key] = useState(() => crypto.randomUUID())
  const [error, setError] = useState("")
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    const form = new FormData(e.currentTarget)
    setBusy(true); setError("")
    try {
      await post({ action: type, matterId, amount: form.get("amount"), moneyKind: kind, occurredAt: form.get("day") + "T00:00:00+08:00",
        billingId: type === "receipt" && billingId ? billingId : undefined, payerOrPayee: String(form.get("payer") ?? "").trim() || undefined,
        note: String(form.get("note") ?? "").trim() || undefined, requestKey: key })
      saved(type === "receipt" ? "实收已登记，请核对实际到账后确认。" : "支出已登记。")
    } catch (err) { setError(err instanceof Error ? err.message : "登记失败，请核对流水后重试。") } finally { setBusy(false) }
  }
  if (!data.ready || !data.canWrite) return <p className="text-sm">此案件当前不能登记收支。</p>
  return <form onSubmit={submit} className="grid gap-4">
    <fieldset disabled={busy} className="grid gap-4 text-sm">
      <label className="grid gap-1">登记类型<NativeSelect value={type} onChange={e => {setType(e.target.value); setBillingId("")}}>
        <NativeSelectOption value="receipt">实收</NativeSelectOption><NativeSelectOption value="expense">支出</NativeSelectOption></NativeSelect></label>
      <label className="grid gap-1">款项性质<NativeSelect value={kind} onChange={e => {setKind(e.target.value); setBillingId("")}}>
        {Object.entries(kinds).map(([value, text]) => <NativeSelectOption key={value} value={value}>{text}</NativeSelectOption>)}</NativeSelect></label>
      <label className="grid gap-1">金额（元）<Input name="amount" type="number" min="0.01" max="9999999999.99" step="0.01" required /></label>
      <label className="grid gap-1">发生日期<Input name="day" type="date" defaultValue={today()} max={today()} required /></label>
      {type === "receipt" && <label className="grid gap-1">来源合同<NativeSelect value={billingId} onChange={e => setBillingId(e.target.value)}>
        <NativeSelectOption value="">未关联合同</NativeSelectOption>{data.billings?.filter(b => b.moneyKind === kind).map(b => <NativeSelectOption key={b.id} value={b.id}>{b.title}</NativeSelectOption>)}</NativeSelect></label>}
      <label className="grid gap-1">{type === "receipt" ? "付款方" : "收款方"}<Input name="payer" maxLength={80} /></label>
      <label className="grid gap-1">备注<Textarea name="note" maxLength={500} /></label>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button type="submit">{busy ? "正在登记…" : "保存登记"}</Button>
    </fieldset>
  </form>
}

export function FinanceDesk({ matterId }: { matterId?: string }) {
  const [data, setData] = useState<Data>()
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [dialog, setDialog] = useState<Dialog>()
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<Matter[]>([])
  const [selected, setSelected] = useState<Matter>()
  const [selectedData, setSelectedData] = useState<Data>()
  const [reason, setReason] = useState("")
  const [dialogError, setDialogError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    readPersonal<Data>(endpoint + (matterId ? "?matter=" + matterId : ""), { signal: controller.signal })
      .then(r => { if (!controller.signal.aborted) { setData(r); setError("") } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [matterId, revision])
  useEffect(() => {
    if (matterId || dialog?.kind !== "register" || selected) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      readPersonal<{ matters: Matter[] }>(endpoint + "?q=" + encodeURIComponent(query), { signal: controller.signal })
        .then(r => { if (!controller.signal.aborted) setOptions(r.matters) })
        .catch(e => { if (!controller.signal.aborted) setDialogError(e.message) })
    }, 200)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [dialog, matterId, query, selected])
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    readPersonal<Data>(endpoint + "?matter=" + selected.id, { signal: controller.signal })
      .then(r => { if (!controller.signal.aborted) setSelectedData(r) })
      .catch(e => { if (!controller.signal.aborted) setDialogError(e.message) })
    return () => controller.abort()
  }, [selected])
  function show(value: Dialog) {
    setSelected(undefined); setSelectedData(undefined); setOptions([]); setQuery(""); setReason(""); setDialogError(""); setDialog(value)
  }
  function saved(text: string) { setNotice(text); setDialog(undefined); setRevision(r => r + 1) }
  async function decide(receipt: Receipt, action: "confirm" | "reject") {
    if (busy) return
    setBusy(true); setDialogError("")
    try { await post({ action, matterId: receipt.matterId, id: receipt.id, reason: reason.trim() }); saved(action === "confirm" ? "已确认到账。" : "已退回该笔登记。") }
    catch (e) { setDialogError(e instanceof Error ? e.message : "操作失败。"); setRevision(r => r + 1) }
    finally { setBusy(false) }
  }

  return <section className="grid min-w-0 gap-4">
    {!matterId && <PageHeader title="财务台账" />}
    {error && <p role="alert">{error} <Button size="sm" variant="outline" onClick={() => setRevision(r => r + 1)}>重试</Button></p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!data && !error && <WorkspaceLoading label="正在读取财务台账…" />}
    {data && <>
      <div className="grid gap-3 sm:grid-cols-3">{data.metrics.map(([label, value]) => <Card key={label}><CardContent><p className="text-sm text-muted-foreground">{label}</p><p className="num text-xl font-semibold">{money(value)}</p></CardContent></Card>)}</div>
      {data.ready === false && <p role="status" className="text-sm">当前工作区尚未启用收支台账。</p>}
      {(!matterId || data.canWrite) && <Button className="justify-self-start" onClick={() => show({ kind: "register" })}>登记收支</Button>}
      <Tabs defaultValue="pending"><TabsList><TabsTrigger value="pending">待确认到账</TabsTrigger><TabsTrigger value="entries">已登记流水</TabsTrigger>
        {matterId && <><TabsTrigger value="dues">应收</TabsTrigger><TabsTrigger value="contracts">合同与分期</TabsTrigger><TabsTrigger value="allocation">收款与票据分配</TabsTrigger></>}</TabsList>
        <TabsContent value="pending"><ul className="divide-y">{data.pending.map(p => <li key={p.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <strong>{money(p.amount)}</strong>{p.matterTitle && <Link className="underline" href={'/matters/'+p.matterId+'/finance'}>{p.matterTitle}</Link>}
          <span>{p.payer || "付款方未填"} · {date(p.date)}</span>{p.actionable && <Button variant="outline" size="sm" onClick={() => show({ kind: "review", receipt: p })}>核对到账</Button>}
        </li>)}</ul>{!data.pending.length && <p className="py-3 text-sm text-muted-foreground">暂无待确认实收。</p>}</TabsContent>
        <TabsContent value="entries">{!matterId && <p className="text-xs text-muted-foreground">最近 100 笔流水</p>}<ul className="divide-y">{data.entries.map(e => <li key={e.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <span>{labels[e.type] || e.type}</span><strong>{money(e.amount)}</strong>{e.matterTitle && <Link className="underline" href={'/matters/'+e.matterId+'/finance'}>{e.matterTitle}</Link>}<span>{date(e.date)} · {labels[e.state] || e.state}</span>
        </li>)}</ul>{!data.entries.length && <p className="py-3 text-sm text-muted-foreground">暂无流水。</p>}</TabsContent>
        {matterId && <TabsContent value="dues"><ul className="divide-y">{data.receivables?.map(r => <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><strong>{r.title}</strong>应收 {money(r.amount)} · 余额 {money(r.outstanding)}</li>)}</ul>
          {!data.receivables?.length && <p className="py-3 text-sm text-muted-foreground">暂无应收。</p>}</TabsContent>}
        {matterId && <><TabsContent value="contracts"><ContractWorkspace matterId={matterId} data={data} tab="contracts" reload={()=>setRevision(r=>r+1)}/></TabsContent><TabsContent value="allocation"><ContractWorkspace matterId={matterId} data={data} tab="allocation" reload={()=>setRevision(r=>r+1)}/></TabsContent></>}
      </Tabs>
    </>}
    <Sheet open={!!dialog} onOpenChange={open => { if (!busy && !open) setDialog(undefined) }}><SheetContent className="overflow-y-auto motion-reduce:transition-none">
      <SheetHeader><SheetTitle>{dialog?.kind === "review" ? "核对实际到账" : "登记收支"}</SheetTitle></SheetHeader>
      <div className="grid gap-4 px-4 pb-4">
        {dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}
        {dialog?.kind === "register" && !matterId && !selected && <><Input aria-label="搜索案件" placeholder="搜索案件名称或编号" value={query} onChange={e => { setQuery(e.target.value); setOptions([]) }} />
          <ul>{options.map(m => <li key={m.id}><Button variant="ghost" onClick={() => {setSelected(m); setDialogError("")}}>{m.internalCode} · {m.title}</Button></li>)}</ul>{!options.length && <p className="text-sm text-muted-foreground">暂无匹配案件。</p>}</>}
        {dialog?.kind === "register" && (matterId || selected) && <>{selected && <p className="text-sm font-medium">{selected.internalCode} · {selected.title}</p>}
          {(selectedData || (matterId && data)) ? <Register key={matterId || selected!.id} matterId={matterId || selected!.id} data={(selectedData || data)!} saved={saved} busy={busy} setBusy={setBusy} /> : <p role="status">正在读取案件台账…</p>}</>}
        {dialog?.kind === "review" && <><p className="font-medium">{money(dialog.receipt.amount)} · {dialog.receipt.payer || "付款方未填"}</p><p className="text-sm">{dialog.receipt.matterTitle} {date(dialog.receipt.date)}</p>
          <Button disabled={busy} onClick={() => decide(dialog.receipt, "confirm")}>已核对，确认到账</Button>
          <label className="grid gap-2 text-sm">退回原因<Textarea maxLength={1000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
          <Button variant="outline" disabled={busy || !reason.trim()} onClick={() => decide(dialog.receipt, "reject")}>退回登记</Button></>}
      </div></SheetContent></Sheet>
  </section>
}
