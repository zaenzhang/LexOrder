"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { FormDialogContent, FormDialogBody } from "@/components/patterns/form-dialog";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioChips } from "@/components/ui/radio-chips";
import { createInvoiceRequest, getMatterInvoiceContext, prepareInvoiceRequestUpload, searchMattersForInvoice } from "@/server/finance/actions";
import { uploadDocument } from "@/server/documents/actions";
import type { InvoiceRequestInput } from "@/server/invoices/request-service";
import { actionErrorMessage } from "@/lib/action-error";
import { matterHref } from "@/lib/matters/route";

type Context = Awaited<ReturnType<typeof getMatterInvoiceContext>>;
type Matter = Awaited<ReturnType<typeof searchMattersForInvoice>>[number];
type Buyer = { clientId: string; name: string; taxNo: string; address: string; phone: string; bank: string; bankAccount: string };
type Attachment = { key: string; file: File; documentId?: string; status: "queued" | "uploading" | "saved" | "failed"; error?: string };
const emptyBuyer = (): Buyer => ({ clientId: "", name: "", taxNo: "", address: "", phone: "", bank: "", bankAccount: "" });
const buyerFor = (client: Context["clientOptions"][number]): Buyer => ({ ...emptyBuyer(), clientId: client.id, name: client.name, taxNo: client.taxNo ?? "" });
const invoiceItems = [{ value: "LAWYER_FEE", label: "律师服务费" }, { value: "CONSULTING_FEE", label: "法律咨询费" }, { value: "AGENCY_FEE", label: "代理费" }, { value: "OTHER", label: "其他法律服务" }];

/** 案件与财务入口共用同一份申请草稿、附件状态和提交身份。 */
export function InvoiceRequestForm({ matterId: fixedMatterId, onOpenChange, canCreateUnlinkedInvoice = false, onSubmitted }: {
  matterId?: string;
  onOpenChange: (open: boolean) => void;
  canCreateUnlinkedInvoice?: boolean;
  onSubmitted?: (id: string) => void;
}) {
  const router = useRouter(), pathname = usePathname(), searchParams = useSearchParams(), prefix = useId();
  const [selectedMatter, setSelectedMatter] = useState<Matter | null>(null);
  const [noMatter, setNoMatter] = useState(false);
  const matterId = fixedMatterId ?? (noMatter ? null : selectedMatter?.id ?? null);
  const [query, setQuery] = useState("");
  const [matters, setMatters] = useState<Matter[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchVersion = useRef(0);
  const [context, setContext] = useState<Context | null>(null);
  const [contextLoading, setContextLoading] = useState(Boolean(fixedMatterId));
  const [contextError, setContextError] = useState("");
  const contextVersion = useRef(0);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [buyer, setBuyer] = useState<Buyer>(emptyBuyer);
  const [amount, setAmount] = useState("");
  const [invoiceType, setInvoiceType] = useState<InvoiceRequestInput["invoiceType"] | "">("");
  const [invoiceItem, setInvoiceItem] = useState<InvoiceRequestInput["invoiceItem"]>("LAWYER_FEE");
  const [noMatterReason, setNoMatterReason] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileError, setFileError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const ready = noMatter || Boolean(matterId && context?.matterId === matterId && !contextLoading && !contextError);

  const loadSearch = useCallback(async (value: string) => {
    const version = ++searchVersion.current;
    setSearchLoading(true); setSearchError("");
    try {
      const rows = await searchMattersForInvoice(value);
      if (version === searchVersion.current) setMatters(rows);
    } catch (error) {
      if (version === searchVersion.current) setSearchError(actionErrorMessage(error));
    } finally {
      if (version === searchVersion.current) setSearchLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!fixedMatterId) void loadSearch("");
    return () => { searchVersion.current += 1; };
  }, [fixedMatterId, loadSearch]);

  const loadContext = useCallback(async (id: string, version: number) => {
    setContextLoading(true); setContextError("");
    try {
      const result = await getMatterInvoiceContext(id);
      if (version !== contextVersion.current) return;
      setContext(result);
      if (result.clientOptions.length === 1) setBuyer(buyerFor(result.clientOptions[0]));
    } catch (error) {
      if (version === contextVersion.current) setContextError(actionErrorMessage(error));
    } finally {
      if (version === contextVersion.current) setContextLoading(false);
    }
  }, []);
  useEffect(() => {
    const version = ++contextVersion.current;
    setContext(null); setContextError(""); setBuyer(emptyBuyer()); setSelectedDocuments([]); setAttachments([]);
    setAmount(""); setInvoiceType(""); setInvoiceItem("LAWYER_FEE"); setNoMatterReason(""); setRequestNote("");
    setFileError(""); setSubmitError(""); setRequestKey(crypto.randomUUID());
    if (matterId) void loadContext(matterId, version); else setContextLoading(false);
    return () => { contextVersion.current = version + 1; };
  }, [matterId, noMatter, loadContext]);

  function pickClient(id: string) {
    const client = context?.clientOptions.find(option => option.id === id);
    if (client) setBuyer(buyerFor(client));
  }
  function addFiles(files: FileList | null) {
    if (!files) return;
    const valid = Array.from(files).filter(file => file.size <= 20 * 1024 * 1024);
    setFileError(valid.length < files.length ? "超过 20MB 的文件未添加，请压缩后重新选择。" : "");
    setAttachments(current => [...current, ...valid.map(file => ({ key: crypto.randomUUID(), file, status: "queued" as const }))]);
    if (fileInput.current) fileInput.current.value = "";
  }
  function input(): InvoiceRequestInput {
    if (!ready) throw new Error("请先选择案件并完成资料加载");
    if (!amount.trim()) throw new Error("请填写开票金额");
    if (!invoiceType) throw new Error("请选择开票类型");
    if (!buyer.name.trim()) throw new Error("请选择或填写开票抬头");
    if (noMatter && !noMatterReason.trim()) throw new Error("请填写无关联案件的原因");
    if (invoiceType === "SPECIAL") {
      for (const [field, label] of [["taxNo", "纳税人识别号"], ["address", "购方地址"], ["phone", "购方电话"], ["bank", "开户银行"], ["bankAccount", "银行账号"]] as const) {
        if (!buyer[field].trim()) throw new Error(`请填写${label}`);
      }
    }
    if (matterId && !selectedDocuments.length && !attachments.length) throw new Error("请选择或上传至少一份开票依据");
    return { requestKey, matterId, noMatterReason, amount, invoiceType, invoiceItem, buyerName: buyer.name, buyerTaxNo: buyer.taxNo, buyerAddress: buyer.address, buyerPhone: buyer.phone, buyerBank: buyer.bank, buyerBankAccount: buyer.bankAccount, requestNote, evidenceDocIds: [...selectedDocuments, ...attachments.flatMap(item => item.documentId ? [item.documentId] : [])] };
  }
  async function uploadPending(data: InvoiceRequestInput, version: number, onlyKey?: string) {
    const pending = attachments.filter(item => !item.documentId && (!onlyKey || item.key === onlyKey));
    if (!pending.length) return data.evidenceDocIds;
    await prepareInvoiceRequestUpload(data);
    const ids = [...data.evidenceDocIds];
    let failed = false;
    for (const item of pending) {
      if (version !== contextVersion.current) return null;
      setAttachments(current => current.map(value => value.key === item.key ? { ...value, status: "uploading", error: undefined } : value));
      const form = new FormData();
      form.set("requestKey", item.key); form.set("matterId", data.matterId!); form.set("name", item.file.name);
      form.set("category", "OTHER"); form.set("encrypted", "true"); form.set("tags", "开票依据"); form.set("file", item.file);
      try {
        const document = await uploadDocument(form);
        if (!document.ok) throw new Error(document.message);
        ids.push(document.id);
        if (version === contextVersion.current) setAttachments(current => current.map(value => value.key === item.key ? { ...value, documentId: document.id, status: "saved", error: undefined } : value));
      } catch (error) {
        failed = true;
        if (version === contextVersion.current) setAttachments(current => current.map(value => value.key === item.key ? { ...value, status: "failed", error: actionErrorMessage(error) } : value));
      }
    }
    return failed ? null : ids;
  }
  async function retryAttachment(key: string) {
    setBusy(true); setSubmitError("");
    const version = contextVersion.current;
    try { await uploadPending(input(), version, key); }
    catch (error) { if (version === contextVersion.current) setSubmitError(actionErrorMessage(error)); }
    finally { if (version === contextVersion.current) setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setSubmitError("");
    const version = contextVersion.current;
    try {
      const data = input();
      const evidenceDocIds = await uploadPending(data, version);
      if (version !== contextVersion.current) return;
      if (!evidenceDocIds) { setSubmitError("部分附件尚未保存，请在失败项重试后提交。已保存的附件无需重新上传。"); return; }
      const created = await createInvoiceRequest({ ...data, evidenceDocIds });
      if (version !== contextVersion.current) return;
      toast.success(created.status === "APPROVED" ? "已定位申请：已批准，待开票" : created.status === "ISSUED" ? "已定位申请：已开票" : created.status === "REJECTED" ? "已定位申请：已驳回" : "开票申请已提交");
      onOpenChange(false);
      if (onSubmitted) onSubmitted(created.id);
      else {
        const target = new URLSearchParams({ type: "INVOICE_APPROVE", id: created.id, tab: "mine" });
        if (fixedMatterId && context && pathname === matterHref(context)) {
          target.set("returnTo", `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`);
        }
        router.push(`/approvals?${target}`);
      }
    } catch (error) {
      if (version === contextVersion.current) setSubmitError(actionErrorMessage(error));
    } finally {
      if (version === contextVersion.current) setBusy(false);
    }
  }
  const field = (name: string) => `${prefix}-${name}`;
  return <Dialog open onOpenChange={open => { if (!busy) onOpenChange(open); }}>
    <FormDialogContent className="max-w-2xl">
      <DialogHeader className="border-b px-5 py-3"><DialogTitle>申请开票</DialogTitle><DialogDescription className="sr-only">填写购方资料并选择本次开票依据。</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <FormDialogBody className="space-y-5 px-5 py-4">
          {!fixedMatterId && <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><Label>关联案件</Label>{canCreateUnlinkedInvoice && <label className="flex items-center gap-2 text-sm"><Checkbox checked={noMatter} disabled={busy} onCheckedChange={value => { setNoMatter(value === true); setSelectedMatter(null); }} />无关联案件</label>}</div>
            {!noMatter && (selectedMatter ? <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"><span>{selectedMatter.internalCode} · {selectedMatter.title}</span><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setSelectedMatter(null)}>更换案件</Button></div> : <>
              <Input aria-label="搜索关联案件" value={query} onChange={event => { setQuery(event.target.value); void loadSearch(event.target.value); }} placeholder="案名、系统编号或所内案号" />
              {searchLoading ? <p role="status" className="text-sm text-muted-foreground">正在查找案件…</p> : searchError ? <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive"><span>{searchError}</span><Button type="button" variant="outline" size="sm" onClick={() => void loadSearch(query)}>重试搜索</Button></div> : <ul className="max-h-40 overflow-y-auto">{matters.map(matter => <li key={matter.id}><Button type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => setSelectedMatter(matter)}>{matter.internalCode} · {matter.title}</Button></li>)}{!matters.length && <li className="py-2 text-sm text-muted-foreground">{query.trim() ? "无匹配案件" : "暂无可关联案件"}</li>}</ul>}
            </>)}
          </section>}
          {contextLoading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取案件资料…</p>}
          {contextError && <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive"><span>{contextError}</span><Button type="button" variant="outline" size="sm" onClick={() => matterId && void loadContext(matterId, contextVersion.current)}>重试加载</Button></div>}
          {fixedMatterId && context && <p className="text-sm">{context.internalCode} · {context.matterTitle}</p>}
          {ready && <fieldset disabled={busy} className="space-y-5">
            {noMatter && <div className="space-y-1.5"><Label htmlFor={field("reason")}>无关联案件原因 *</Label><Textarea id={field("reason")} required maxLength={1000} value={noMatterReason} onChange={event => setNoMatterReason(event.target.value)} /></div>}
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor={field("amount")}>开票金额（元） *</Label><Input id={field("amount")} type="number" step="0.01" min="0.01" max="999999999999.99" required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor={field("type")}>开票类型 *</Label><Select value={invoiceType} disabled={busy} onValueChange={value => { setInvoiceType(value as InvoiceRequestInput["invoiceType"]); if (value === "PLAIN") setBuyer(current => ({ ...current, address: "", phone: "", bank: "", bankAccount: "" })); }}><SelectTrigger id={field("type")}><SelectValue placeholder="请选择" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="PLAIN">普通发票</SelectItem><SelectItem value="SPECIAL">增值税专用发票</SelectItem></SelectGroup></SelectContent></Select></div></div>
            <div className="space-y-1.5"><Label>开票名目 *</Label><RadioChips items={invoiceItems} value={invoiceItem} onChange={value => setInvoiceItem(value as InvoiceRequestInput["invoiceItem"])} /></div>
            <section className="space-y-3 border-t pt-4">
              <div className="space-y-1.5"><Label htmlFor={field("buyer")}>开票抬头 *</Label>{context?.clientOptions.length ? <Select value={buyer.clientId} disabled={busy} onValueChange={pickClient}><SelectTrigger id={field("buyer")}><SelectValue placeholder="选择本案客户" /></SelectTrigger><SelectContent><SelectGroup>{context.clientOptions.map(client => <SelectItem key={client.id} value={client.id}>{client.name}{client.isPrimary ? "（主要客户）" : ""}</SelectItem>)}</SelectGroup></SelectContent></Select> : <Input id={field("buyer")} required maxLength={200} value={buyer.name} onChange={event => setBuyer({ ...buyer, name: event.target.value })} />}</div>
              <div className="space-y-1.5"><Label htmlFor={field("taxNo")}>纳税人识别号{invoiceType === "SPECIAL" ? " *" : "（选填）"}</Label><Input id={field("taxNo")} required={invoiceType === "SPECIAL"} maxLength={80} value={buyer.taxNo} onChange={event => setBuyer({ ...buyer, taxNo: event.target.value })} /></div>
              {invoiceType === "SPECIAL" && <div className="grid gap-3 sm:grid-cols-2">{([ ["bank", "开户银行", 200], ["bankAccount", "银行账号", 100], ["address", "购方地址", 500], ["phone", "购方电话", 80] ] as const).map(([name, label, maxLength]) => <div key={name} className="space-y-1.5"><Label htmlFor={field(name)}>{label} *</Label><Input id={field(name)} required maxLength={maxLength} value={buyer[name]} onChange={event => setBuyer({ ...buyer, [name]: event.target.value })} /></div>)}</div>}
            </section>
            {matterId && context && <section className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between gap-3"><Label>开票依据 *</Label><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}><Paperclip className="mr-1.5 size-4" />添加文件</Button></div>
              {context.evidenceDocuments.length > 0 && <ul className="max-h-44 space-y-2 overflow-y-auto">{context.evidenceDocuments.map(document => <li key={document.id} className="flex items-center gap-2 text-sm"><Checkbox id={field(document.id)} disabled={busy} checked={selectedDocuments.includes(document.id)} onCheckedChange={checked => setSelectedDocuments(current => checked === true ? [...current, document.id] : current.filter(id => id !== document.id))} /><Label htmlFor={field(document.id)} className="flex-1 font-normal">{document.name} <span className="text-muted-foreground">v{document.version}</span></Label><a href={`/api/documents/${document.id}/download`} target="_blank" rel="noreferrer" className="text-xs text-primary underline">查看</a></li>)}</ul>}
              <input ref={fileInput} type="file" multiple accept="image/*,application/pdf,.doc,.docx" aria-label="添加开票依据" className="hidden" onChange={event => addFiles(event.target.files)} />
              {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
              {attachments.length > 0 && <ul className="space-y-2">{attachments.map(item => <li key={item.key} className="rounded-md border p-3 text-sm"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 break-all">{item.file.name}</span><span className="shrink-0 text-xs text-muted-foreground">{{ queued: "待上传", uploading: "上传中…", saved: "已保存", failed: "上传失败" }[item.status]}</span><Button type="button" variant="ghost" size="icon" className="size-7" disabled={busy} aria-label={`移出本次申请：${item.file.name}`} onClick={() => setAttachments(current => current.filter(value => value.key !== item.key))}><X className="size-3.5" /></Button></div>{item.error && <div role="alert" className="mt-2 flex items-center justify-between gap-3"><span className="text-destructive">{item.error}</span><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void retryAttachment(item.key)}>重试上传</Button></div>}</li>)}</ul>}
              {!context.evidenceDocuments.length && !attachments.length && <p className="text-sm text-muted-foreground">本案暂无可选材料，请添加开票依据。单文件不超过 20MB。</p>}
            </section>}
            <div className="space-y-1.5"><Label htmlFor={field("note")}>申请备注（选填）</Label><Textarea id={field("note")} rows={2} maxLength={500} value={requestNote} onChange={event => setRequestNote(event.target.value)} /></div>
          </fieldset>}
        </FormDialogBody>
        <DialogFooter className="flex-col gap-3 border-t px-5 py-3 sm:flex-col">
          {submitError && <div role="alert" className="w-full space-y-1 text-sm"><p className="text-destructive">{submitError}</p><Link href="/approvals?type=INVOICE_APPROVE&tab=mine" className="text-primary underline">查看我的开票申请</Link></div>}
          <div className="flex w-full justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={busy || !ready}>{busy && <Loader2 className="mr-1.5 size-4 animate-spin" />}提交申请</Button></div>
        </DialogFooter>
      </form>
    </FormDialogContent>
  </Dialog>;
}
