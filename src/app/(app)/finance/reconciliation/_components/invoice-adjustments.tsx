"use client";

import { Button, Input, Modal, Select, TextArea } from "@douyinfe/semi-ui";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { adjustInvoice, type getFinanceLedger } from "@/server/finance/ledger-actions";
import { shDayKey } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";

type Data = Awaited<ReturnType<typeof getFinanceLedger>>;
const kinds = { RED: "红冲", VOID: "作废", REPLACE: "换开" };

export function InvoiceAdjustments({ data, canCorrect }: { data: Data; canCorrect: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, start] = useTransition();
  const [id, setId] = useState(""), [kind, setKind] = useState<keyof typeof kinds>("RED");
  const [amount, setAmount] = useState(""), [date, setDate] = useState(shDayKey(new Date()));
  const [reference, setReference] = useState(""), [reason, setReason] = useState("");
  const [doc, setDoc] = useState(""), [replacement, setReplacement] = useState("");
  const [reversals, setReversals] = useState<Record<string, string>>({});
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const popupContainer = useRef<HTMLDivElement>(null);
  const invoice = data.invoices.find(item => item.id === id);
  const selectProps = { disabled: busy, motion: false as const, style: { width: "100%" }, getPopupContainer: () => popupContainer.current!, onDropdownVisibleChange: setDropdownOpen };

  function begin() {
    const first = data.invoices.find(item => Number(item.amount) > 0);
    setId(first?.id ?? ""); setAmount(first?.amount ?? ""); setReversals({});
    setDoc(""); setReplacement(""); setReference(""); setReason(""); setDropdownOpen(false); setOpen(true);
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !id || !doc || (kind === "REPLACE" && !replacement)) return;
    start(async () => {
      try {
        const result = await adjustInvoice({
          invoiceId: id, kind, amount, occurredAt: new Date(`${date}T00:00:00+08:00`), reference, reason,
          documentId: doc, replacementInvoiceId: kind === "REPLACE" ? replacement : undefined,
          reversals: Object.entries(reversals).filter(([, value]) => value.trim()).map(([linkId, value]) => ({ id: linkId, amount: value })),
        });
        if (!result.ok) throw new Error(result.message);
        toast.success("发票更正已留痕"); setOpen(false); router.refresh();
      } catch (error) { toast.error(error instanceof Error ? actionErrorMessage(error) : "登记失败"); }
    });
  }

  return <section className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">已开票更正</h2>
    <p className="text-sm">记录已完成的红冲、作废或换开，保留原票。不改变收款与应收；退款另行办理。</p>
    {canCorrect && <Button htmlType="button" theme="outline" type="tertiary" onClick={begin}>登记发票更正</Button>}
    {data.invoiceAdjustments.map(item => <p className="text-sm" key={item.id}>
      {kinds[item.kind as keyof typeof kinds] ?? item.kind} ¥{item.amount} · {item.reference} · {item.reason} · <a className="underline" href={`/api/documents/${item.documentId}/download`}>处理依据</a>
    </p>)}
    <Modal visible={open} title="登记外部发票处理结果" footer={null} width={640} motion={false}
      closeOnEsc={!busy && !dropdownOpen} maskClosable={!busy} closable={!busy} onCancel={() => { if (!busy) setOpen(false); }}
      bodyStyle={{ maxHeight: "75vh", overflowY: "auto" }}>
      <div ref={popupContainer}>
        <p className="mb-4 text-sm text-muted-foreground">须具备开票执行和财务更正确认权限。按实际外部凭证登记。</p>
        <form className="space-y-3" onSubmit={submit}>
          <fieldset disabled={busy} className="space-y-3">
            <div><label id="adjustment-invoice-label" htmlFor="adjustment-invoice">原发票</label><Select<string> {...selectProps} id="adjustment-invoice" aria-labelledby="adjustment-invoice-label" aria-required value={id}
              onChange={value => { setId(String(value ?? "")); setReversals({}); setDoc(""); }}
              optionList={data.invoices.filter(item => Number(item.amount) > 0).map(item => ({ value: item.id, label: `${item.invoiceNo ?? "未编号发票"} · 剩余票面 ¥${item.amount}` }))} /></div>
            <div><label id="adjustment-kind-label" htmlFor="adjustment-kind">处理类型</label><Select<string> {...selectProps} id="adjustment-kind" aria-labelledby="adjustment-kind-label" value={kind}
              onChange={value => setKind(value as keyof typeof kinds)} optionList={Object.entries(kinds).map(([value, label]) => ({ value, label }))} /></div>
            <label className="block">处理金额<Input required value={amount} onChange={setAmount} inputMode="decimal" /></label>
            <label className="block">实际处理日期<Input required type="date" value={date} onChange={setDate} /></label>
            <label className="block">外部凭证编号<Input required value={reference} onChange={setReference} /></label>
            <label className="block">处理说明<TextArea required value={reason} onChange={setReason} /></label>
            <div><label id="adjustment-document-label" htmlFor="adjustment-document">本案处理依据文件</label><Select<string> {...selectProps} id="adjustment-document" aria-labelledby="adjustment-document-label" aria-required
              value={doc || undefined} placeholder="请先上传本案处理凭证，再选择" onChange={value => setDoc(String(value ?? ""))}
              optionList={data.documents.filter(item => item.matterId === invoice?.matterId).map(item => ({ value: item.id, label: item.name }))} /></div>
            {kind === "REPLACE" && <div><label id="adjustment-replacement-label" htmlFor="adjustment-replacement">换开的新票</label><Select<string> {...selectProps} id="adjustment-replacement" aria-labelledby="adjustment-replacement-label" aria-required
              value={replacement || undefined} placeholder="请选择同案新票" onChange={value => setReplacement(String(value ?? ""))}
              optionList={data.invoices.filter(item => item.id !== id && item.matterId === invoice?.matterId).map(item => ({ value: item.id, label: `${item.invoiceNo ?? "未编号发票"} · ¥${item.amount}` }))} /></div>}
            {data.invoiceLinks.filter(link => link.invoiceId === id && Number(link.amount) > 0).map(link => <label key={link.id} className="block">
              解除票款关联（当前 ¥{link.amount}）<Input inputMode="decimal" value={reversals[link.id] ?? ""} onChange={value => setReversals({ ...reversals, [link.id]: value })} />
            </label>)}
            <Button htmlType="submit" theme="solid" disabled={busy || !id || !doc || (kind === "REPLACE" && !replacement)}>确认登记外部处理结果</Button>
          </fieldset>
        </form>
      </div>
    </Modal>
  </section>;
}
