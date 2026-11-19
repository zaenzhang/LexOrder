"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { readPersonal } from "@/features/matters/personal-client"

const endpoint = "/api/personal-runtime/finance-desk"
const kinds: Record<string,string> = { LAWYER_FEE: "律师费", CLIENT_FUNDS: "代收款", EXPENSE_RECOVERY: "代垫回收", OTHER: "其他款项" }
const status: Record<string,string> = { DRAFT: "草稿", ACTIVE: "已生效", TERMINATED: "已终止", CANCELLED: "已取消" }
const money = (v: string) => Number(v).toLocaleString("zh-CN",{style:"currency",currency:"CNY"})
type Billing = { id:string; title:string; moneyKind:string; amount:string; status:string; revision:number; signable:boolean; signedAt:string|null }
type Payment = { id:string; revision:number; amount:string; date:string; kind:string; unallocated:string; invoiceRoom:string }
type Due = { id:string; title:string; kind:string; billingId:string|null; outstanding:string; amount:string; state:string; due:string|null; dueCondition:string|null }
type Invoice = { id:string; number:string|null; amount:string; linked:string; outstanding:string }
export type ContractLedger = { canContract?:boolean; canWrite?:boolean; billings?:Billing[]; payments?:Payment[]; receivables?:Due[]; invoices?:Invoice[];
  allocations?:{paymentId:string;receivableId:string;amount:string}[]; invoiceLinks?:{paymentId:string;invoiceId:string;amount:string}[] }
type Mode = { kind:"draft" } | {kind:"sign"; row:Billing} | {kind:"allocate"; row:Payment; target:"INVOICE"|"RECEIVABLE"} | {kind:"review"}
type Review = { needsReview:boolean; reviewReason:string|null; checks:{id:string; current:boolean; decidedAt:string|null; note:string|null; conclusion:string;
  hits:{id:string; reason:string; matchedName:string; matchedValue:string; severity:string}[]}[] }
const shDay = (date: string | Date) => new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(date))
const dayTime = (value: FormDataEntryValue | null) => value ? value+"T00:00:00+08:00" : undefined

function Installment({ index, amount }: {index:number;amount?:string}) {
  const [state, setState] = useState("UNKNOWN")
  return <fieldset className="grid gap-2 rounded-md border p-3"><legend>第 {index+1} 期</legend>
    <label>期次名称<Input name={'title-'+index} maxLength={120} defaultValue={'第 '+(index+1)+' 期'} required /></label>
    <label>本期金额（元）<Input name={'amount-'+index} type="number" step=".01" min=".01" defaultValue={amount} required /></label>
    <label>到期方式<NativeSelect name={'state-'+index} value={state} onChange={e=>setState(e.target.value)}>
      <NativeSelectOption value="UNKNOWN">尚未约定</NativeSelectOption><NativeSelectOption value="DATE_SET">约定日期</NativeSelectOption><NativeSelectOption value="CONDITIONAL">约定条件</NativeSelectOption></NativeSelect></label>
    {state==="DATE_SET" && <label>到期日<Input type="date" name={'due-'+index} required /></label>}
    {state==="CONDITIONAL" && <label>到期条件<Input name={'condition-'+index} maxLength={1000} required /></label>}
  </fieldset>
}

function Editor({ matterId, mode, data, saved, busy, setBusy }: {matterId:string;mode:Mode;data:ContractLedger;saved:(text:string,close?:boolean)=>void;busy:boolean;setBusy:(busy:boolean)=>void}) {
  const [key] = useState(()=>crypto.randomUUID())
  const [count,setCount] = useState(mode.kind==="sign" && Number(mode.row.amount)>0 ? 1 : 0)
  const [review,setReview] = useState<Review|null>()
  const [revision,setRevision] = useState(0)
  const [error,setError] = useState("")
  useEffect(()=>{
    if(mode.kind!=="review") return
    const c=new AbortController()
    readPersonal<Review|null>(endpoint+'?matter='+matterId+'&section=review',{signal:c.signal}).then(r=>{if(!c.signal.aborted)setReview(r)}).catch(e=>{if(!c.signal.aborted)setError(e.message)})
    return ()=>c.abort()
  },[matterId,mode,revision])
  const check=review?.checks[0]
  async function send(body:object,stay=false) {
    if(busy)return
    setBusy(true);setError("")
    try{
      await readPersonal(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
      saved("已保存。",!stay)
      if(stay)setRevision(n=>n+1)
    }catch(e){setError(e instanceof Error?e.message:"未保存。")}finally{setBusy(false)}
  }
  const targets = mode.kind !== "allocate" ? [] : mode.target==="RECEIVABLE"
    ? (data.receivables||[]).filter(r=>r.kind===mode.row.kind&&r.state!=="CANCELLED"&&Number(r.outstanding)>0).map(r=>({id:r.id,name:r.title,balance:r.outstanding}))
    : (data.invoices||[]).filter(i=>Number(i.outstanding)>0).map(i=>({id:i.id,name:i.number||"已开发票",balance:i.outstanding}))
  function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f=new FormData(e.currentTarget)
    if(mode.kind==="draft") void send({action:"contract",input:{matterId,title:f.get("title"),moneyKind:f.get("kind"),amount:f.get("amount"),installments:[],draftRequestKey:key}})
    if(mode.kind==="sign") void send({action:"sign",matterId,input:{id:mode.row.id,revision:mode.row.revision,signedAt:dayTime(f.get("signed")),
      installments:Array.from({length:count},(_,i)=>({title:f.get("title-"+i),amount:f.get("amount-"+i),dueState:f.get("state-"+i),dueDate:dayTime(f.get("due-"+i)),dueCondition:f.get("condition-"+i)||undefined}))}})
    if(mode.kind==="allocate") void send({action:"allocate",matterId,input:{paymentId:mode.row.id,revision:mode.row.revision,kind:mode.target,
      items:targets.filter(t=>f.get(t.id)).map(t=>({targetId:t.id,amount:f.get(t.id)}))}})
    if(mode.kind==="review" && check)void send({action:"decide-review",matterId,checkId:check.id,expectedDecidedAt:check.decidedAt,conclusion:f.get("conclusion"),note:f.get("note")},true)
  }
  return <form onSubmit={submit}><fieldset disabled={busy} className="grid gap-3 text-sm">
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {mode.kind==="draft" && <><label>合同名称<Input required maxLength={120} name="title"/></label><label>约定金额（元）<Input name="amount" type="number" min="0" step=".01" required /></label>
      <label>款项性质<NativeSelect name="kind">{Object.entries(kinds).map(([k,v])=><NativeSelectOption key={k} value={k}>{v}</NativeSelectOption>)}</NativeSelect></label></>}
    {mode.kind==="sign" && <><p>{mode.row.title} · {money(mode.row.amount)}</p><label>实际签署日期<Input name="signed" type="date" required max={shDay(new Date())} /></label>
      {Array.from({length:count},(_,i)=><Installment key={i} index={i} amount={!i ? mode.row.amount:undefined} />)}
      <div className="flex gap-2"><Button type="button" variant="outline" disabled={count>=100} onClick={()=>setCount(n=>n+1)}>新增一期</Button>
        {count>0 && <Button type="button" variant="ghost" onClick={()=>setCount(n=>n-1)}>移除末期</Button>}</div></>}
    {mode.kind==="allocate" && <><p>实收 {money(mode.row.amount)} · 本次最多 {money(mode.target==="RECEIVABLE"?mode.row.unallocated:mode.row.invoiceRoom)}</p>
      {targets.map(t=><label key={t.id}>{t.name} · 可分配 {money(t.balance)}<Input name={t.id} type="number" min=".01" max={t.balance} step=".01" placeholder="本次金额" /></label>)}
      {!targets.length&&<p>没有可匹配的{mode.target==="INVOICE"?"已开发票":"同性质应收"}。</p>}</>}
    {mode.kind==="review" && <><p>{review===undefined?"正在读取复核…":review?.reviewReason || (review?"本案当前复核已通过。":"动态复核尚未启用。")}</p>
      {review && <Button type="button" variant="outline" onClick={()=>send({action:"review",matterId},true)}>重新检索案件主体与代理范围</Button>}
      {check && <><ul>{check.hits.map(h=><li key={h.id}>{h.matchedName} · {h.matchedValue} · {h.reason}</li>)}</ul>
        {!check.hits.length&&<p>本轮检索无命中。</p>}{check.note && <p>上次判断依据 · {check.note}</p>}
        {check.current && <><label>律师判断<NativeSelect required name="conclusion" defaultValue=""><NativeSelectOption value="">请选择</NativeSelectOption>
          <NativeSelectOption value="DIFFERENT">可区分，可承接</NativeSelectOption><NativeSelectOption value="SAME_SUBJECT">涉及同一主体</NativeSelectOption><NativeSelectOption value="NEED_INFO">需要补充信息</NativeSelectOption></NativeSelect></label><label>判断依据<Textarea required maxLength={2000} name="note"/></label></>}</>}
    </>}
    {(mode.kind!=="review"||check?.current) && <Button disabled={busy||(mode.kind==="allocate"&&!targets.length)}>{busy?"正在保存…":mode.kind==="sign"?"确认签署及分期":mode.kind==="review"?"记录人工判断":"保存"}</Button>}
  </fieldset></form>
}

export function ContractWorkspace({matterId,data,tab,reload}:{matterId:string;data:ContractLedger;tab:"contracts"|"allocation";reload:()=>void}) {
  const [mode,setMode]=useState<Mode>()
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState("")
  function done(text:string,close=true){setMessage(text);if(close)setMode(undefined);reload()}
  return <div className="grid gap-3 py-2 text-sm">{message && <p role="status">{message}</p>}
    {tab==="contracts" && <><div className="flex gap-2">{data.canContract && <><Button size="sm" onClick={()=>setMode({kind:"draft"})}>登记合同草稿</Button>
      <Button size="sm" variant="outline" onClick={()=>setMode({kind:"review"})}>承接冲突复核</Button></>}</div>
      <ul className="divide-y">{data.billings?.map(b=><li key={b.id} className="grid gap-1 py-3"><strong>{b.title} · {money(b.amount)}</strong>
        <span>{kinds[b.moneyKind]} · {status[b.status]||b.status} {b.signedAt && shDay(b.signedAt)}</span>
        {data.receivables?.filter(r=>r.billingId===b.id).map(r=><p key={r.id}>{r.title} · {money(r.amount)} · {r.due?shDay(r.due):r.dueCondition||"到期日未约定"}</p>)}
        {b.signable&&data.canContract&&<Button className="justify-self-start" size="sm" variant="outline" onClick={()=>setMode({kind:"sign",row:b})}>登记实际签署与分期</Button>}</li>)}</ul>
      {!data.billings?.length&&<p>本案暂无收费合同。</p>}</>}
    {tab==="allocation" && <><ul className="divide-y">{data.payments?.map(p=><li key={p.id} className="grid gap-2 py-3"><strong>{shDay(p.date)} · {kinds[p.kind]} · {money(p.amount)}</strong>
      <span>待核销 {money(p.unallocated)}{p.kind==="LAWYER_FEE"&&" · 可关联发票 "+money(p.invoiceRoom)}</span>
      {data.allocations?.filter(a=>a.paymentId===p.id).map(a=><span key={a.receivableId}>{data.receivables?.find(r=>r.id===a.receivableId)?.title} · 已核销 {money(a.amount)}</span>)}
      {data.invoiceLinks?.filter(a=>a.paymentId===p.id).map(a=><span key={a.invoiceId}>{data.invoices?.find(i=>i.id===a.invoiceId)?.number} · 已关联 {money(a.amount)}</span>)}
      {data.canWrite&&<div className="flex gap-2">{Number(p.unallocated)>0&&<Button size="sm" variant="outline" onClick={()=>setMode({kind:"allocate",row:p,target:"RECEIVABLE"})}>分配到应收</Button>}
        {p.kind==="LAWYER_FEE"&&Number(p.invoiceRoom)>0&&<Button size="sm" variant="outline" onClick={()=>setMode({kind:"allocate",row:p,target:"INVOICE"})}>关联已开发票</Button>}</div>}</li>)}</ul>
      {!data.payments?.length&&<p>本案暂无已确认收款。</p>}
      {!!data.invoices?.length&&<><strong>已开发票</strong>{data.invoices.map(i=><p key={i.id}>{i.number||"未填票号"} · 已关联 {money(i.linked)} · 待关联 {money(i.outstanding)}</p>)}</>}</>}
    <Sheet open={!!mode} onOpenChange={open=>{if(!open&&!busy)setMode(undefined)}}><SheetContent className="overflow-y-auto motion-reduce:transition-none">
      <SheetHeader><SheetTitle>{mode?.kind==="sign"?"签署与分期":mode?.kind==="allocate"?"收款分配":mode?.kind==="review"?"案件承接冲突复核":"收费合同草稿"}</SheetTitle></SheetHeader>
      {mode&&<div className="px-4 pb-4"><Editor mode={mode} data={data} matterId={matterId} busy={busy} setBusy={setBusy} saved={done}/></div>}</SheetContent></Sheet>
  </div>
}
