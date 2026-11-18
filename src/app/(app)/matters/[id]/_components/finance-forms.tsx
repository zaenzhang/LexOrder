"use client";

import { FormField as Field } from "@/components/patterns/form-dialog";

import { ChoiceField } from "@/components/patterns/choice-field";
import type { z } from "zod";

import { useRouter } from "next/navigation";
import { useId, useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Select, Button, Input, InputNumber, Notification, TextArea, Toast } from "@douyinfe/semi-ui";
import { FileInput } from "@/components/patterns/file-input";
import { IconLoading as Loader2, IconAIWandLevel1 as Sparkles } from "@douyinfe/semi-icons";
import {
  WorkspaceDialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/patterns/workspace-dialog";
import {
  billingCreateSchema,
  feeEntryCreateSchema,
  type BillingCreateInput,
  type FeeEntryCreateInput
} from "@/server/finance/schemas";
import {
  getMatterFinance,
  createBilling,
  createFeeEntry,
  listMatterInvoiceRequests
} from "@/server/finance/actions";
import { uploadDocument } from "@/server/documents/actions";
import { recognizeInvoiceFromImage, type RecognizedInvoice } from "@/server/ai/actions";
import { shDayKey } from "@/lib/ui/sh-time";
import { confirmDiscardChanges } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";

// ============ AddBillingSheet ============

export function AddBillingSheet({
  open,
  onOpenChange,
  matterId
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  matterId: string;
}) {
  const router=useRouter();
  useEffect(()=>{if(!open)return;let active=true;void getMatterFinance(matterId).then(fin=>{if(active&&fin.ledgerReady){onOpenChange(false);router.push(`/finance/reconciliation?matterId=${matterId}`);}}).catch(()=>{});return()=>{active=false;};},[open,matterId,onOpenChange,router]);
  const [isPending, startTransition] = useTransition();
  const [contractFile, setContractFile] = useState<File | null>(null);
  const {
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isDirty }
  } = useForm<z.input<typeof billingCreateSchema>, unknown, BillingCreateInput>({
    resolver: zodResolver(billingCreateSchema),
    defaultValues: {
      matterId,
      title: "",
      contractAmount: 0,
      schedule: "",
      status: "ACTIVE"
    }
  });
  const billingStatus = useWatch({ control, name: "status" });

  function onSubmit(values: BillingCreateInput) {
    startTransition(async () => {
      try {
        await createBilling(values);
        if (contractFile) {
          const fd = new FormData();
          fd.set("matterId", matterId);
          fd.set("name", contractFile.name);
          fd.set("category", "CONTRACT");
          fd.set("encrypted", "true");
          fd.set("tags", `合同,${values.title}`);
          fd.set("file", contractFile);
          const uploaded = await uploadDocument(fd);
          if (!uploaded.ok) throw new Error(uploaded.message);
          Toast.success("合同已创建，附件已加密入库");
        } else {
          Toast.success("合同已创建");
        }
        reset();
        setContractFile(null);
        onOpenChange(false);
      } catch (err) {
        Notification.error({ title: "失败", content: actionErrorMessage(err) });
      }
    });
  }

  async function close() {
    if (isPending) return;
    if ((isDirty || contractFile) && !await confirmDiscardChanges()) return;
    reset();
    setContractFile(null);
    onOpenChange(false);
  }

  return (
    <WorkspaceDialog open={open} dismissOnBackdrop onOpenChange={value => { if (!value) void close(); }}>
      <DialogContent showClose={!isPending} className="flex max-h-[88vh] w-[92vw] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>新增合同</DialogTitle>
          <DialogDescription className="text-xs">
            一个案件可以有多份合同（如分阶段委托）。可同时上传合同扫描件，加密入库后归到本案材料库。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            <Field label="合同名称" required error={errors.title?.message}>
              <Controller control={control} name="title" render={({ field }) => <Input placeholder="如：委托代理合同 - 一审阶段" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>

            <Field label="合同金额（元）" required error={errors.contractAmount?.message as string | undefined}>
              <Controller control={control} name="contractAmount" render={({ field }) => (
                <InputNumber step={0.01} precision={2} hideButtons aria-label="合同金额（元）" className="w-full" name={field.name}
                  forwardedRef={field.ref} value={typeof field.value === "number" && Number.isNaN(field.value) ? "" : typeof field.value === "number" || typeof field.value === "string" ? field.value : ""}
                  onBlur={field.onBlur} onChange={value => field.onChange(value === "" ? Number.NaN : Number(value))} />
              )} />
            </Field>

            <Field label="状态">
              <ChoiceField
                ariaLabel="收费约定状态"
                options={[
                  { value: "DRAFT", label: "草稿" },
                  { value: "ACTIVE", label: "生效中" },
                  { value: "CLOSED", label: "已结清" }
                ]}
                value={billingStatus}
                onChange={(v) => setValue("status", v as BillingCreateInput["status"], { shouldDirty: true })}
              />
            </Field>

            <Field label="签订日期" error={errors.signedAt?.message}>
              {/* 留空时保持 undefined（草稿）；用字符串注册，空串会在 zod 校验报错并显示，避免 Invalid Date 静默失败 */}
              <Controller control={control} name="signedAt" render={({ field }) => <Input type="date" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>

            <Field label="阶段付款约定">
              <Controller control={control} name="schedule" render={({ field }) => <TextArea rows={3} placeholder="如：签约时收 30%，立案时收 30%，判决生效后收 40%" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>

            <Field label="合同附件（可选）">
              <FileInput
                aria-label="合同附件"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                disabled={isPending}
                onChange={event => setContractFile(event.currentTarget.files?.[0] ?? null)}
              />
            </Field>
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              onClick={() => void close()}
              disabled={isPending}
              htmlType="button"
              type="tertiary" theme="outline"
            >
              取消
            </Button>
            <Button disabled={isPending} className="gap-1.5" htmlType="submit" theme="solid">
              {isPending && <Loader2 aria-hidden size="default" spin />}
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </WorkspaceDialog>
  );
}

// ============ AddFeeEntrySheet ============

// 工厂而非内联字面量：occurredAt 须在每次打开/重置时取「现在」，常驻挂载的对话框跨天后仍会默认昨天
function feeEntryDefaults(matterId: string): z.input<typeof feeEntryCreateSchema> {
  return {
    matterId,
    billingId: "",
    type: "RECEIVED",
    amount: 0,
    // yyyy-MM-dd 字符串默认值：date input 才能正确回显，提交时由 zod coerce 成 Date（上海当日）
    occurredAt: shDayKey(new Date()),
    invoiceNo: "",
    payerOrPayee: "",
    method: "",
    note: ""
  };
}

export function AddFeeEntrySheet({
  open,
  onOpenChange,
  matterId,
  billings
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  matterId: string;
  billings: { id: string; title: string }[];
}) {
  const selectLabelId = useId();
  const [isPending, startTransition] = useTransition();
  const [invoiceRequests, setInvoiceRequests] = useState<
    Awaited<ReturnType<typeof listMatterInvoiceRequests>>
  >([]);

  useEffect(() => {
    if (!open) return;
    listMatterInvoiceRequests(matterId)
      .then(setInvoiceRequests)
      .catch(() => setInvoiceRequests([]));
  }, [open, matterId]);

  const {
    control,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors, isDirty }
  } = useForm<z.input<typeof feeEntryCreateSchema>, unknown, FeeEntryCreateInput>({
    resolver: zodResolver(feeEntryCreateSchema),
    defaultValues: feeEntryDefaults(matterId)
  });

  // 打开（变为 true）时重置默认值：defaultValues 只在首次渲染求值，跨天打开默认「发生日期」会是昨天
  useEffect(() => {
    if (open) reset(feeEntryDefaults(matterId));
  }, [open, matterId, reset]);

  const type = useWatch({ control, name: "type" });
  const billingId = useWatch({ control, name: "billingId" });

  function onSubmit(values: FeeEntryCreateInput) {
    startTransition(async () => {
      try {
        await createFeeEntry(values);
        Toast.success(
          values.type === "RECEIVED" ? "实收已录入" : "记录已创建"
        );
        reset();
        onOpenChange(false);
      } catch (err) {
        Notification.error({ title: "失败", content: actionErrorMessage(err) });
      }
    });
  }

  async function close() {
    if (isPending) return;
    if (isDirty && !await confirmDiscardChanges()) return;
    reset();
    onOpenChange(false);
  }

  return (
    <WorkspaceDialog open={open} dismissOnBackdrop onOpenChange={value => { if (!value) void close(); }}>
      <DialogContent showClose={!isPending} className="flex max-h-[88vh] w-[92vw] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>新增收付记录</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            <Field label="类型" required>
              <ChoiceField
                ariaLabel="费用类型"
                options={[
                  { value: "RECEIVABLE", label: "应收" },
                  { value: "RECEIVED", label: "实收" },
                  { value: "REFUND", label: "退款" },
                  { value: "COST", label: "成本" }
                ]}
                value={type}
                onChange={(v) => setValue("type", v as FeeEntryCreateInput["type"], { shouldDirty: true })}
              />
            </Field>

            <Field label="金额（元）" required error={errors.amount?.message}>
              <Controller control={control} name="amount" render={({ field }) => (
                <InputNumber step={0.01} precision={2} hideButtons aria-label="金额（元）" className="w-full" name={field.name}
                  forwardedRef={field.ref} value={typeof field.value === "number" && Number.isNaN(field.value) ? "" : typeof field.value === "number" || typeof field.value === "string" ? field.value : ""}
                  onBlur={field.onBlur} onChange={value => field.onChange(value === "" ? Number.NaN : Number(value))} />
              )} />
            </Field>

            <Field label="发生日期" required error={errors.occurredAt?.message}>
              <Controller control={control} name="occurredAt" render={({ field }) => <Input type="date" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>

            {billings.length > 0 && (
              <Field label="关联合同">
                <> <span className="sr-only" id={selectLabelId + "-1"}>{"关联合同"}</span><Select
                  value={billingId || "none"}
                  onChange={v => { if (typeof v === "string") setValue("billingId", v === "none" ? "" : v, { shouldDirty: true }); }}
                  aria-labelledby={selectLabelId + "-1"}
                  className="w-full"
                  motion={false}><Select.Option value="none">不关联</Select.Option>{billings.map((b) => (
                      <Select.Option key={b.id} value={b.id}>
                        {b.title}
                      </Select.Option>
                    ))}</Select></>
              </Field>
            )}

            {/* 字段联动：付款/收款方名称随类型；应收尚未发生资金往来，不填支付方式 */}
            <Field label={type === "REFUND" || type === "COST" ? "收款方" : "付款方"}>
              <Controller control={control} name="payerOrPayee" render={({ field }) => <Input placeholder={type === "COST" ? "如 法院 / 鉴定机构 / 快递公司" : "如 上海青石建设有限公司"} name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>

            {type !== "RECEIVABLE" && (
              <Field label="方式">
                <Controller control={control} name="method" render={({ field }) => <Input placeholder="转账 / 现金 / 支付宝" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
              </Field>
            )}

            {(type === "RECEIVED" || type === "RECEIVABLE") && invoiceRequests.length > 0 && (
              <Field
                label="关联申请发票"
                hint="选中后自动填金额；已开具的会填真实发票号，未开具的填占位 req:xxxxxxxx"
              >
                <> <span className="sr-only" id={selectLabelId + "-2"}>{"关联申请发票"}</span><Select
                  value="none"
                  onChange={v => { if (typeof v !== "string") return;
                    if (v === "none") return;
                    const req = invoiceRequests.find((r) => r.id === v);
                    if (!req) return;
                    setValue("amount", Number(req.amount), { shouldDirty: true });
                    // 优先用真实发票号（财务已 ISSUED 时回填），否则用占位
                    const invoiceNoValue = req.invoiceNo ?? `req:${req.id.slice(0, 8)}`;
                    setValue("invoiceNo", invoiceNoValue, { shouldDirty: true });
                    const existing = getValues("note") ?? "";
                    const noteText = req.invoiceNo
                      ? `关联申请发票 #${req.id.slice(0, 8)}${req.title ? "（" + req.title + "）" : ""}`
                      : `关联申请发票（未开具）#${req.id.slice(0, 8)}${req.title ? "（" + req.title + "）" : ""}`;
                    setValue("note", existing ? `${existing}\n${noteText}` : noteText, {
                      shouldDirty: true
                    });
                  }}
                  aria-labelledby={selectLabelId + "-2"}
                  placeholder="从已申请发票中选择"
                  className="w-full"
                  motion={false}><Select.Option value="none">不关联</Select.Option>{invoiceRequests.map((r) => (
                      <Select.Option key={r.id} value={r.id}>
                        ¥{Number(r.amount).toLocaleString()} ·{" "}
                        {r.title ?? "未命名"} ·{" "}
                        {r.invoiceNo ? `已开具 ${r.invoiceNo}` : r.status}
                      </Select.Option>
                    ))}</Select></>
              </Field>
            )}

            {type !== "RECEIVABLE" && (
            <Field label="发票号">
              <Controller control={control} name="invoiceNo" render={({ field }) => <Input className="font-mono" name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>
            )}

            {type !== "RECEIVABLE" && (
            <InvoiceOcrBlock
              onRecognized={(data) => {
                if (data.invoiceNumber)
                  setValue("invoiceNo", data.invoiceNumber, { shouldDirty: true });
                if (data.totalWithTax || data.totalAmount) {
                  setValue("amount", Number(data.totalWithTax ?? data.totalAmount), {
                    shouldDirty: true
                  });
                }
                if (data.sellerName)
                  setValue("payerOrPayee", data.sellerName, { shouldDirty: true });
                if (data.invoiceDate) {
                  const d = new Date(data.invoiceDate);
                  // 回填也用 yyyy-MM-dd 字符串：Date 对象不会被 date input 回显，用户将无法核对
                  if (!isNaN(d.getTime()))
                    setValue("occurredAt", shDayKey(d) as unknown as Date, { shouldDirty: true });
                }
              }}
            />
            )}

            <Field label="备注">
              <Controller control={control} name="note" render={({ field }) => <TextArea rows={2} name={field.name} ref={field.ref} value={field.value ?? ""} onBlur={field.onBlur} onChange={field.onChange} />} />
            </Field>
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              onClick={() => void close()}
              disabled={isPending}
              htmlType="button"
              type="tertiary" theme="outline"
            >
              取消
            </Button>
            <Button disabled={isPending} className="gap-1.5" htmlType="submit" theme="solid">
              {isPending && <Loader2 aria-hidden size="default" spin />}
              {type === "RECEIVED" ? "记录实收" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </WorkspaceDialog>
  );
}

// ============ Invoice OCR ============

function InvoiceOcrBlock({
  onRecognized
}: {
  onRecognized: (data: RecognizedInvoice) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RecognizedInvoice | null>(null);

  const recognize = async () => {
    if (!file) {
      Toast.warning("请先选择发票图片");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await recognizeInvoiceFromImage(fd);
      if (!res.ok) {
        Toast.error(res.message);
        return;
      }
      setPreview(res.data);
      onRecognized(res.data);
      Toast.success("已识别并自动填入");
    } catch (e) {
      Toast.error(e instanceof Error ? actionErrorMessage(e) : "识别失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-border bg-muted/20 p-3">
      <label className="flex items-center gap-1.5 text-xs">
        <Sparkles aria-hidden size="small" className="text-primary" />
        AI 发票识别（可选）
      </label>
      <p className="text-xs text-muted-foreground">
        上传增值税发票（JPG / PNG / PDF），识别后自动填发票号 / 金额 / 销售方 / 开票日
      </p>
      <div className="flex items-center gap-2">
        <FileInput
          className="flex-1"
          aria-label="选择发票（JPG / PNG / PDF）"
          accept="image/*,application/pdf"
          disabled={busy}
          onChange={event => {
            setFile(event.currentTarget.files?.[0] ?? null);
            setPreview(null);
          }}
        />
        <Button
          onClick={recognize}
          disabled={!file || busy}
          className="h-8 gap-1 text-xs"
          htmlType="button"
          type="tertiary" theme="outline"
          size="small"
        >
          {busy && <Loader2 aria-hidden size="small" spin />}
          识别
        </Button>
      </div>
      {preview && (
        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 rounded border border-border bg-background p-2 text-xs text-muted-foreground">
          {preview.invoiceType && <div>类型：{preview.invoiceType}</div>}
          {preview.invoiceNumber && (
            <div>
              发票号：<span className="font-mono text-foreground/85">{preview.invoiceNumber}</span>
            </div>
          )}
          {preview.invoiceDate && <div>开票日：{preview.invoiceDate}</div>}
          {preview.sellerName && <div>销售方：{preview.sellerName}</div>}
          {preview.buyerName && <div>购买方：{preview.buyerName}</div>}
          {preview.totalWithTax != null && (
            <div>
              价税合计：
              <span className="font-mono text-foreground/85">¥{preview.totalWithTax}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ Shared Field ============
