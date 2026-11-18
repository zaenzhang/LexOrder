"use client";
import { Select, Button, Input, RadioGroup, TextArea, Toast } from "@douyinfe/semi-ui";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { contractHref } from "./contract-location";
import { WorkspaceDialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/patterns/workspace-dialog";

import { formatDate } from "@/lib/utils";
import { moneyKinds, moneyKindLabels, type MoneyKind } from "@/lib/finance/ledger-labels";
import { registerExpense, registerBilling, registerReceipt, confirmReceipt, rejectReceipt, signBilling, confirmDueCondition, type getFinanceLedger } from "@/server/finance/ledger-actions";
import { actionErrorMessage } from "@/lib/action-error";
import { matterHref } from "@/lib/matters/route";
type Data=Awaited<ReturnType<typeof getFinanceLedger>>;
type Part={title:string;amount:string;dueState:"UNKNOWN"|"DATE_SET"|"CONDITIONAL";dueDate:string;dueCondition:string};
const newPart=():Part=>({title:"第一期",amount:"",dueState:"UNKNOWN",dueDate:"",dueCondition:""});
const date=(v:string)=>new Date(`${v}T00:00:00+08:00`);
const yuan=(v:string)=>`¥${Number(v).toLocaleString("zh-CN",{minimumFractionDigits:2})}`;
export type ContractEntry = { kind: "create" } | { kind: "sign"; id: string };
export function RegistrationWorkspace({data,canWrite,canConfirm,selectedMatterId,returnTo,contractEntry,onContractClose,onContractSaved}:{data:Data;canWrite:boolean;canConfirm:boolean;selectedMatterId?:string;returnTo?:string;contractEntry?:ContractEntry;onContractClose?:()=>void;onContractSaved?:(id:string,matterId:string)=>void}) {
  const router=useRouter();
  const popupContainer = useRef<HTMLDivElement>(null);
  const openDropdown = useRef(false);
  const initialBilling=contractEntry?.kind==="sign"?data.billings.find(b=>b.id===contractEntry.id):undefined;
  const [mode,setMode]=useState<"billing"|"receipt"|"expense"|"sign"|"reject"|"condition"|null>(contractEntry?.kind==="create"?"billing":contractEntry?.kind==="sign"?"sign":null);
  const [dialogOpen,setDialogOpen]=useState(Boolean(contractEntry));
  const [target,setTarget]=useState(initialBilling?.id??"");
  const [matterId,setMatterId]=useState(selectedMatterId??initialBilling?.matterId??"");
  const [title,setTitle]=useState(initialBilling?.title??"");
  const [amount,setAmount]=useState(initialBilling?.contractAmount??"");
  const [moneyKind,setMoneyKind]=useState<MoneyKind>(initialBilling?.moneyKind??"LAWYER_FEE");
  const [day,setDay]=useState(formatDate(new Date()));
  const [draft,setDraft]=useState(false);
  const [parts,setParts]=useState<Part[]>(initialBilling?(Number(initialBilling.contractAmount)===0?[]:[{...newPart(),amount:initialBilling.contractAmount}]):[newPart()]);
  const [counterparty,setCounterparty]=useState("");
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const matters=new Map(data.matters.map(m=>[m.id,m]));
  // 归档案件默认只读；本案指定的财务收尾人（tailWritable）仍可确认/退回实收
  const canChange=(id:string)=>matters.get(id)?.status!=="ARCHIVED"||matters.get(id)?.tailWritable===true;
  function open(next:"receipt"|"expense"|"reject"|"condition",id="") {
    setError("");setDialogOpen(true);setMode(next);setTarget(id);setMatterId(selectedMatterId??"");setTitle("");setAmount("");setMoneyKind(next==="expense"?"OTHER":"LAWYER_FEE");setDay(formatDate(new Date()));setDraft(false);setNote("");setCounterparty("");setParts([newPart()]);
  }
  async function run(work:()=>Promise<{ok:boolean;message?:string}>,success:string) {
    setBusy(true);setError("");try{const result=await work();if(!result.ok)throw new Error(result.message);Toast.success(success);setDialogOpen(false);
      // M-3e（D 批）：从案件入口进入时，保存成功后留在案件上下文并回原案页，不再停在全局对账页
      if(contractEntry)return;
      if(returnTo){router.push(returnTo);return;}
      if(selectedMatterId){router.push(matterHref(matters.get(selectedMatterId)!));return;}router.refresh();}catch(e){setError(actionErrorMessage(e));}finally{setBusy(false);}
  }
  const installments=()=>parts.map(p=>({...p,dueDate:p.dueState==="DATE_SET" && p.dueDate?date(p.dueDate):undefined}));
  function submit(e:React.FormEvent) {
    e.preventDefault();
    if (busy || ((mode === "billing" || mode === "receipt" || mode === "expense") && !matterId)) return;
    if(mode==="expense")void run(()=>registerExpense({matterId,amount,moneyKind,occurredAt:date(day),note,payerOrPayee:counterparty}),"支出已登记");
    if(mode==="receipt")void run(()=>registerReceipt({matterId,amount,moneyKind,occurredAt:date(day),note,payerOrPayee:counterparty}),"实收已登记，等待财务确认到账");
    if(mode==="billing")void run(async()=>{const result=await registerBilling({matterId,title,amount,moneyKind,signedAt:draft?undefined:date(day),installments:draft?[]:installments()});if(result.ok)onContractSaved?.(result.id,result.matterId);return result;},draft?"合同草稿已保存":"合同及分期应收已创建");
    if(mode==="sign") {const b=data.billings.find(b=>b.id===target)!;void run(async()=>{const result=await signBilling({id:target,revision:b.revision,signedAt:date(day),installments:installments()});if(result.ok)onContractSaved?.(result.id,result.matterId);return result;},"已确认签署并生成应收");}
    if(mode==="reject")void run(()=>rejectReceipt(target,note),"已退回并通知登记人");
    if(mode==="condition") {const r=data.receivables.find(r=>r.id===target)!;void run(()=>confirmDueCondition({id:target,revision:r.revision,satisfiedAt:date(day),note}),"已确认条件成就日期");}
  }
  const fields=mode==="billing"||mode==="sign";
  return <>
    {!contractEntry&&canWrite?<div className="flex gap-2"><Link className="text-sm text-primary underline" href={contractHref({matterId:selectedMatterId,action:"create",returnTo})}>登记合同</Link><Button  onClick={()=>open("receipt")} size="small" theme="outline" type="tertiary" htmlType="button">登记实收</Button><Button  onClick={()=>open("expense")} size="small" theme="outline" type="tertiary" htmlType="button">登记支出</Button></div>:null}
    {!contractEntry&&data.pending.length?<section className="rounded-xl border border-[var(--semi-color-warning-light-active)] bg-[var(--semi-color-warning-light-default)] p-4"><h2 className="font-semibold">待确认实收</h2><p className="text-sm text-muted-foreground">以下登记尚未计入实收、分成或应收核销。</p><ul className="divide-y">{data.pending.map(p=><li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span>{matters.get(p.matterId)?.internalCode} · {moneyKindLabels[p.moneyKind]} · {yuan(p.amount)} · {p.name}登记 · {formatDate(p.occurredAt)}{p.payerOrPayee?` · 付款人：${p.payerOrPayee}`:""}{p.note?<span className="block pt-1 text-muted-foreground">{p.note}</span>:null}</span>{canConfirm && canChange(p.matterId)?<span className="flex gap-2"><Button  disabled={busy} onClick={()=>void run(()=>confirmReceipt(p.id),"到账已确认，实收与计提已入账")} size="small" theme="solid" type="primary" htmlType="button">确认到账</Button><Button  disabled={busy} onClick={()=>open("reject",p.id)} size="small" theme="outline" type="tertiary" htmlType="button">退回</Button></span>:null}</li>)}</ul></section>:null}
    {!contractEntry&&canWrite && data.receivables.some(r=>r.dueState==="CONDITIONAL"&&!r.conditionSatisfiedAt&&r.status!=="CANCELLED")?<section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">待成就条件</h2>{data.receivables.filter(r=>r.dueState==="CONDITIONAL"&&!r.conditionSatisfiedAt&&r.status!=="CANCELLED").map(r=><div className="flex justify-between gap-3 py-3 text-sm" key={r.id}><span>{r.title} · {r.dueCondition}</span>{canChange(r.matterId)?<Button  onClick={()=>open("condition",r.id)} size="small" theme="outline" type="tertiary" htmlType="button">条件已成就</Button>:null}</div>)}</section>:null}
    {!dialogOpen&&error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <WorkspaceDialog open={dialogOpen} onOpenChange={open=>{if(!busy){setDialogOpen(open);if(!open)onContractClose?.();}}}><DialogContent ref={popupContainer} onEscapeKeyDown={event => { if (busy || openDropdown.current) event.preventDefault(); }} className="max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>{{billing:"登记合同",receipt:"登记实收",expense:"登记支出",sign:"确认签署与分期",reject:"退回实收",condition:"确认到期条件"}[mode??"billing"]}</DialogTitle><DialogDescription>{mode==="receipt"?"登记后须由有权财务确认到账，才计入实收。":fields?"签署时按收费总额生成分期应收；各期合计须等于总额。":"填写实际日期及依据，操作将记录审计。"}</DialogDescription></DialogHeader><form onSubmit={submit}><fieldset disabled={busy} className="space-y-4">
      {mode==="billing"||mode==="receipt"||mode==="expense"?<><label id="register-matter-label" htmlFor="register-matter">案件{selectedMatterId?"（案件入口锁定）":""}</label><Select<string> getPopupContainer={() => popupContainer.current!} onDropdownVisibleChange={visible => { openDropdown.current = visible; }} aria-labelledby="register-matter-label" id="register-matter" value={matterId} disabled={busy || Boolean(selectedMatterId)} onChange={value => (e=>setMatterId(e))(String(value ?? ""))} aria-required={true} style={{ width: "100%" }} motion={false}><Select.Option value="">请选择案件</Select.Option>{/* 2026-09-20 P3 修复：新增收费安排（billing）服务端对归档案恒拒（allowTail:false），下拉不再提供「归档收尾」选项 */}{data.matters.filter(m=>m.status!=="ARCHIVED"||(m.tailWritable===true&&(mode==="receipt"||mode==="expense"))).map(m=><Select.Option key={m.id} value={m.id}>{m.internalCode} · {m.title}{m.status==="ARCHIVED"?"（归档收尾）":""}</Select.Option>)}</Select><label>款项性质</label><RadioGroup options={moneyKinds.map(value=>({value,label:moneyKindLabels[value]}))} value={moneyKind} onChange={event => (v=>setMoneyKind(v as MoneyKind))(String(event.target.value))} disabled={busy} type="button"/></>:null}
      {fields?<><label htmlFor="billing-title">合同名称</label><Input id="billing-title" value={title} onChange={e=>setTitle(e)} required disabled={mode==="sign"}/></>:null}
      {fields||mode==="receipt"||mode==="expense"?<><label htmlFor="register-amount">{fields?"合同金额":mode==="expense"?"本次支出":"本次实收"}（元）</label><Input id="register-amount" inputMode="decimal" value={amount} onChange={e=>setAmount(e)} required disabled={mode==="sign"}/></>:null}
      {mode==="billing"?<RadioGroup options={[{value:"signed",label:"已签署"},{value:"draft",label:"未签署草稿"}]} value={draft?"draft":"signed"} onChange={event => (v=>setDraft(v==="draft"))(String(event.target.value))} disabled={busy} type="button"/>:null}
      {mode!=="reject"&&!draft?<><label htmlFor="register-day">{fields?"签署日期":mode==="condition"?"条件成就日期":mode==="expense"?"支出日期":"到账日期"}</label><Input id="register-day" type="date" value={day} onChange={e=>setDay(e)} required/></>:null}
      {fields&&!draft?<fieldset className="space-y-3"><legend className="mb-2 font-semibold">分期应收</legend>{parts.map((p,i)=><div key={i} className="space-y-2 rounded border p-3"><label htmlFor={`part-title-${i}`}>第 {i+1} 期名称</label><Input id={`part-title-${i}`} value={p.title} onChange={e=>setParts(parts.map((v,n)=>n===i?{...v,title:e}:v))} required/><label htmlFor={`part-amount-${i}`}>金额（元）</label><Input id={`part-amount-${i}`} inputMode="decimal" value={p.amount} onChange={e=>setParts(parts.map((v,n)=>n===i?{...v,amount:e}:v))} required/><RadioGroup options={[{value:"UNKNOWN",label:"未约定日期"},{value:"DATE_SET",label:"确定日期"},{value:"CONDITIONAL",label:"条件成就时"}]} value={p.dueState} onChange={event => (v=>setParts(parts.map((part,n)=>n===i?{...part,dueState:v as Part["dueState"]}:part)))(String(event.target.value))} disabled={busy} type="button"/>{p.dueState==="DATE_SET"?<><label htmlFor={`part-date-${i}`}>到期日</label><Input id={`part-date-${i}`} type="date" required value={p.dueDate} onChange={e=>setParts(parts.map((v,n)=>n===i?{...v,dueDate:e}:v))}/></>:null}{p.dueState==="CONDITIONAL"?<><label htmlFor={`part-condition-${i}`}>到期条件</label><Input id={`part-condition-${i}`} required value={p.dueCondition} onChange={e=>setParts(parts.map((v,n)=>n===i?{...v,dueCondition:e}:v))}/></>:null}<Button htmlType="button" className="text-sm text-destructive" onClick={()=>setParts(parts.filter((_,n)=>n!==i))} theme="borderless" type="tertiary">移除此期</Button></div>)}<Button htmlType="button"  onClick={()=>setParts([...parts,{...newPart(),title:`第${parts.length+1}期`}])} size="small" theme="outline" type="tertiary">添加一期</Button><p className="text-xs text-muted-foreground">零收费安排请移除所有分期。</p></fieldset>:null}
      {mode==="receipt"||mode==="expense"?<><label htmlFor="register-counterparty">{mode==="receipt"?"付款人":"收款人"}</label><Input id="register-counterparty" value={counterparty} onChange={e=>setCounterparty(e)} maxLength={80}/></>:null}
      {mode==="receipt"||mode==="expense"||mode==="reject"||mode==="condition"?<><label htmlFor="register-note">{mode==="receipt"||mode==="expense"?"备注":mode==="reject"?"退回原因":"条件成就依据"}</label><TextArea id="register-note" value={note} onChange={e=>setNote(e)} required={mode!=="receipt"&&mode!=="expense"} maxLength={mode==="receipt"||mode==="expense"?500:1000}/></>:null}
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button  disabled={busy || ((mode === "billing" || mode === "receipt" || mode === "expense") && !matterId)} htmlType="submit" theme="solid" type="primary">{busy?"保存中…":mode==="billing"?"登记合同":mode==="sign"?"确认签署":"确认保存"}</Button>
    </fieldset></form></DialogContent></WorkspaceDialog>
  </>;
}
