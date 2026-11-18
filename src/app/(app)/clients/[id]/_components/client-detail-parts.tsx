"use client";

import { Button, Checkbox, Input, Radio, Notification, Toast } from "@douyinfe/semi-ui";

/** 墨案 10 客户详情的交互零件：疑似重复横幅 + 合并向导、添加联系人 */
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Loader2, Plus, ScanSearch } from "lucide-react";
import { mergeClientsByCode } from "@/server/clients/dedup";
import { addContact } from "@/server/clients/actions";
import { WorkspaceDialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/patterns/workspace-dialog";

import { actionErrorMessage } from "@/lib/action-error";

export function MergeBanner({
  keepId,
  keepName,
  suspects,
  canMerge
}: {
  keepId: string;
  keepName: string;
  suspects: { id: string; name: string; internalCode: string | null; reason: string }[];
  canMerge: boolean;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(suspects[0]?.internalCode ?? "");
  const [basis, setBasis] = useState("");
  const [pending, start] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  if (!canMerge || dismissed) {
    return canMerge ? null : null;
  }
  const s = suspects[0];

  function submit() {
    if (!code.trim() || !basis.trim()) {
      Toast.warning("请填写被合并客户编号与合并依据");
      return;
    }
    start(async () => {
      try {
        await mergeClientsByCode({ keepId, mergeCode: code.trim(), basis: basis.trim() });
        Toast.success("合并完成：被合并档案已停用并保留映射");
        setOpen(false);
        router.refresh();
      } catch (e) {
        Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "合并失败", duration: 6 });
      }
    });
  }

  return (
    <>
      {s ? (
        <div className="merge-banner">
          <div className="ic-wrap"><ScanSearch /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="merge-t">发现疑似同一主体的客户档案</div>
            <div className="merge-d">
              「{keepName}」与「{s.name}」{s.reason}{s.internalCode ? `（${s.internalCode}）` : ""}。本所采用身份持续唯一策略：合并只调整当前关联，<b>不改写历史身份快照</b>，保留原记录映射与合并依据；被合并档案转为已合并状态。
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Button theme="borderless" size="small" htmlType="button"  onClick={() => setDismissed(true)}>忽略本次</Button>
            <Button theme="solid" size="small" htmlType="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId}
              onClick={event => { trigger.current = event.currentTarget; setOpen(true); }}>查看合并建议</Button>
          </div>
        </div>
      ) : null}
      {!s ? (
        <Button theme="borderless" size="small" htmlType="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId}
          onClick={event => { trigger.current = event.currentTarget; setOpen(true); }} data-merge-trigger>
          <GitMerge />
          合并重复档案
        </Button>
      ) : null}
      <WorkspaceDialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
        <DialogContent id={dialogId} className="sm:max-w-[520px]" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus({ preventScroll: true }); }}>
          <DialogHeader>
            <DialogTitle>合并客户档案</DialogTitle>
            <DialogDescription>将另一档案并入「{keepName}」。联系人、收案与案件关联转移至本档案；历史冲突核查、审批与正式成果中的身份快照保持原貌。</DialogDescription>
          </DialogHeader>
          <fieldset disabled={pending} className="space-y-3">
            {suspects.length > 0 ? (
              <div className="space-y-1.5">
                <label>疑似重复档案</label>
                {suspects.map((x) => (
                  <Radio key={x.id} className="flex items-center gap-2" name="merge-suspect" checked={code === (x.internalCode ?? "")} onChange={() => setCode(x.internalCode ?? "")} disabled={pending || !x.internalCode}>
                    <span className="min-w-0 flex-1 truncate font-[550]">{x.name}</span>
                    <span className="badge b-amber">{x.reason}</span>
                    <span className="font-mono text-[11px] text-[var(--t-muted)]">{x.internalCode ?? "无编号"}</span>
                  </Radio>
                ))}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label htmlFor="merge-code">被合并客户编号</label>
              <Input id="merge-code" value={code} onChange={value => setCode(value)} placeholder="KH-2026-0001" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="merge-basis">合并依据（记入审计）</label>
              <Input id="merge-basis" value={basis} onChange={value => setBasis(value)} placeholder="如：统一社会信用代码一致，同一主体重复建档" />
            </div>
          </fieldset>
          <DialogFooter>
            <Button theme="outline" size="small" htmlType="button"  onClick={() => setOpen(false)} disabled={pending}>取消</Button>
            <Button theme="solid" size="small" htmlType="button"  onClick={submit} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <GitMerge />}
              确认合并
            </Button>
          </DialogFooter>
        </DialogContent>
      </WorkspaceDialog>
    </>
  );
}

export function AddContactButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState({ name: "", title: "", phone: "", email: "", isPrimary: false });
  function submit() {
    if (!form.name.trim()) {
      Toast.warning("请填写联系人姓名");
      return;
    }
    start(async () => {
      try {
        await addContact(clientId, { ...form, wechat: "", notes: "" });
        Toast.success("联系人已添加");
        setOpen(false);
        setForm({ name: "", title: "", phone: "", email: "", isPrimary: false });
        router.refresh();
      } catch (e) {
        Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "添加失败", duration: 6 });
      }
    });
  }
  return (
    <WorkspaceDialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
        <Button htmlType="button" theme="borderless" size="small" aria-haspopup="dialog" aria-expanded={open} aria-controls={`${formId}-dialog`}
          onClick={event => { trigger.current = event.currentTarget; setOpen(true); }}>
          <Plus />
          添加联系人
        </Button>
        <DialogContent id={`${formId}-dialog`} className="sm:max-w-[460px]" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus({ preventScroll: true }); }}>
          <DialogHeader>
            <DialogTitle>添加联系人</DialogTitle>
          </DialogHeader>
          <fieldset disabled={pending} className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><label htmlFor={`${formId}-name`}>姓名 *</label><Input id={`${formId}-name`} value={form.name} onChange={value => setForm({ ...form, name: value })} /></div>
            <div className="space-y-1.5"><label htmlFor={`${formId}-title`}>职务 / 对接事项</label><Input id={`${formId}-title`} value={form.title} onChange={value => setForm({ ...form, title: value })} placeholder="如：财务对接" /></div>
            <div className="space-y-1.5"><label htmlFor={`${formId}-phone`}>电话</label><Input id={`${formId}-phone`} value={form.phone} onChange={value => setForm({ ...form, phone: value })} className="font-mono" /></div>
            <div className="space-y-1.5"><label htmlFor={`${formId}-email`}>邮箱</label><Input id={`${formId}-email`} value={form.email} onChange={value => setForm({ ...form, email: value })} /></div>
            <Checkbox className="col-span-2" disabled={pending} checked={form.isPrimary} onChange={event => setForm({ ...form, isPrimary: event.target.checked === true })}>设为主要联系人</Checkbox>
          </fieldset>
          <DialogFooter>
            <Button theme="outline" size="small" htmlType="button"  onClick={() => setOpen(false)} disabled={pending}>取消</Button>
            <Button theme="solid" size="small" htmlType="button"  onClick={submit} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : null}添加</Button>
          </DialogFooter>
        </DialogContent>
    </WorkspaceDialog>
  );
}
