'use client';
import { Disclosure } from "@/components/patterns/disclosure";
import {useState,useTransition} from 'react';import {useRouter} from 'next/navigation';import { Select, Button, Input, TextArea, Toast } from "@douyinfe/semi-ui";
import {getClosureBoard,saveClosure} from '@/server/archive/closure-actions';import {ArchiveWizardDialog} from '@/app/(app)/matters/[id]/_components/archive-wizard';import {formatDate} from '@/lib/utils';import {shDayKey} from '@/lib/ui/sh-time';
import { actionErrorMessage } from "@/lib/action-error";
import { DetailSectionStatus, useDetailSection } from "@/components/patterns/detail-section-loading";

type ClosureBoard = Awaited<ReturnType<typeof getClosureBoard>>;

export function MatterClosurePanel({ matterId, refreshKey }: { matterId: string; refreshKey: number }) {
  const [expanded, setExpanded] = useState(false);
  const section = useDetailSection(getClosureBoard, matterId, refreshKey, expanded);
  const data = section.data;
  const status = data?.status === "ARCHIVED" ? "卷宗已归档" : data?.blockers.length ? "仍有待处置事项" : data ? "可核对送审" : null;
  return (
    <Disclosure heading={status ? `结案与归档核对 · ${status}` : "结案与归档核对"} onOpenChange={setExpanded}>
      {data ? <ClosureBoardContent matterId={matterId} data={data} />
        : data === null ? <p role="status" className="py-4 text-sm">当前无可读的归档核对资料。</p>
        : expanded ? <DetailSectionStatus label="归档核对" {...section} /> : null}
    </Disclosure>
  );
}

function ClosureBoardContent({ matterId, data }: { matterId: string; data: NonNullable<ClosureBoard> }) {
 const router=useRouter(),[pending,start]=useTransition(),[open,setOpen]=useState(false),[reason,setReason]=useState(data?.plan?.reason??''),[date,setDate]=useState(data?.plan?shDayKey(new Date(data.plan.serviceCompletedAt)):shDayKey(new Date())),[owner,setOwner]=useState(data?.plan?.financeOwnerId??'');
 return <div className="mt-4 space-y-4 text-sm">
 <div className="grid gap-2 sm:grid-cols-4"><span>程序与事项：{data.blockers.length?'未完成':'已处置'}</span><span>律师服务：{data.plan?`已说明 ${formatDate(data.plan.serviceCompletedAt)}`:'未确认'}</span><span>财务：{data.financeOpen?'有未结事项':'已结清'}</span><span>卷宗：{data.status==='ARCHIVED'?'已归档':'待归档'}</span></div>
 {data.blockers.length>0&&<ul className="list-disc pl-5 text-[var(--semi-color-warning)]">{data.blockers.map(b=><li key={b}>{b}</li>)}</ul>}
 {data.finance&&<p>未结应收 ¥{data.finance.outstanding} · 未分配收款 ¥{data.finance.unallocated} · 未结分成 ¥{data.finance.commissionBalance} · 发票未关联收款 ¥{data.finance.invoiceOutstanding}</p>}
 {data.plan&&!data.plan.current&&(data.status==='ARCHIVED'
   ?<p className="text-muted-foreground">归档后清单随收尾业务自然变化，属正常现象；如需变更财务收尾人请办理收尾交接，原归档包不受影响。</p>
   :<p className="text-[var(--semi-color-warning)]">清单已变化，请重新核对并保存收尾安排。已送审申请须退回后重新提交。</p>)}
 <p>未结款本身不阻止归档；未完事项须完成、取消，或在关联新案件落实后明确记录移交。原归档包保持固定，后续材料单独补充归档。</p>
 {data.canSave&&<div className="grid gap-3 sm:grid-cols-2"><label>服务完成日期<Input type="date" value={date} onChange={inputValue => setDate(inputValue)} /></label><label>财务收尾负责人<Select<string> className="w-full" aria-label="财务收尾负责人" value={owner} onChange={value => { if (typeof value === "string") setOwner(value); }}><Select.Option value="">无未结财务时可不指定</Select.Option>{data.people.map(p=><Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>)}</Select></label><label className="sm:col-span-2">服务完成说明及收尾安排<TextArea value={reason} onChange={inputValue => setReason(inputValue)} /></label><Button disabled={pending} onClick={()=>start(async()=>{try{await saveClosure({matterId,revision:data.plan?.revision??null,financeOwnerId:owner||null,serviceCompletedAt:new Date(`${date}T00:00:00+08:00`),reason});Toast.success('收尾核对已保存');router.refresh();}catch(e){Toast.error(e instanceof Error ? actionErrorMessage(e) :'保存失败');}})} type="tertiary" theme="outline">保存核对结果</Button></div>}
 {data.status==='ARCHIVED'&&data.canSupplement&&<Button onClick={()=>setOpen(true)} type="tertiary" theme="outline">提交补充归档</Button>}
 {data.archives.map(a=><div key={a.id} className="flex gap-3"><span>{a.archiveNo} · {a.status==='APPROVED'?'已批准':a.status==='REJECTED'?'已驳回':'待审批'}</span>{a.status==='APPROVED'&&<a className="underline" href={`/api/archive/${matterId}/export?archiveId=${a.id}`}>导出本次固定卷宗</a>}</div>)}
 <ArchiveWizardDialog matterId={matterId} open={open} onOpenChange={setOpen}/>
 </div>;
}
