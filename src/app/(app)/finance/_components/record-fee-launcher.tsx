"use client";

import { DialogContent, DialogDescription, DialogHeader, DialogTitle, WorkspaceDialog } from "@/components/patterns/workspace-dialog";

/** 财务页「登记收付」：先选案件，再打开案件内同一张收付登记表（沿用 createFeeEntry 校验与权限） */
import { Button, Input, Notification } from "@douyinfe/semi-ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, useRef} from "react";
import { IconLoading as Loader2, IconSearch as Search } from "@douyinfe/semi-icons";
import { searchMattersForInvoice, getMatterFinance } from "@/server/finance/actions";
import { AddFeeEntrySheet } from "@/app/(app)/matters/[id]/_components/finance-forms";
import { actionErrorMessage } from "@/lib/action-error";

export function RecordFeeLauncher({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router=useRouter();
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<{ id: string; internalCode: string; title: string }[]>([]);
  const [loading, startLoading] = useTransition();
  const [picked, setPicked] = useState<{ id: string; billings: { id: string; title: string }[] } | null>(null);

  const searchSeqRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    const seq = ++searchSeqRef.current;
    const t = setTimeout(() => {
      startLoading(async () => {
        try {
          const rows = await searchMattersForInvoice(q || undefined);
          if (seq === searchSeqRef.current) setOptions(rows);
        } catch {
          if (seq === searchSeqRef.current) setOptions([]);
        }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  async function pick(id: string) {
    try {
      const fin = await getMatterFinance(id);
      onOpenChange(false);
      if(fin.ledgerReady){router.push(`/finance/reconciliation?matterId=${id}`);return;}
      setPicked({ id, billings: fin.billings.map((b) => ({ id: b.id, title: b.title })) });
    } catch (err) {
      Notification.error({ title: "无法读取该案件财务信息", content: actionErrorMessage(err), duration: 6 });
    }
  }

  return (
    <>
      <WorkspaceDialog open={open} dismissOnBackdrop onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle>登记收付</DialogTitle>
            <DialogDescription>选择案件后登记应收、实收、支出或退款；分成按案件方案自动派生。</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={q} onChange={setQ} placeholder="按案件名称或编号搜索" aria-label="搜索案件" prefix={<Search aria-hidden size="default" />} suffix={loading ? <Loader2 aria-hidden spin size="default" /> : null} />
          <div className="max-h-[320px] overflow-y-auto rounded-[10px] border border-[var(--semi-color-border)]">
            {options.length === 0 ? (
              <div className="empty mo-empty-compact"><div className="mo-empty-title">{loading ? "搜索中…" : "没有可登记收付的案件"}</div></div>
            ) : (
              options.map((m) => (
                <Button key={m.id} htmlType="button" onClick={() => pick(m.id)} className="flex w-full items-center gap-3 border-b border-[var(--semi-color-border)] px-3.5 py-2.5 text-left last:border-b-0 hover:bg-[var(--semi-color-fill-0)]" theme="borderless" type="tertiary">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-[550]">{m.title}</span>
                    <span className="block font-mono text-xs text-[var(--semi-color-text-2)]">{m.internalCode}</span>
                  </span>
                </Button>
              ))
            )}
          </div>
        </DialogContent>
      </WorkspaceDialog>
      {picked ? <AddFeeEntrySheet open={Boolean(picked)} onOpenChange={(o) => !o && setPicked(null)} matterId={picked.id} billings={picked.billings} /> : null}
    </>
  );
}
