"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TextArea, Notification, Toast } from "@douyinfe/semi-ui";
import { IntakeWizard, type ClientOption } from "../../_components/intake-wizard";
import { getIntakeEditForm, withdrawIntake } from "@/server/intakes/revision-actions";
import { resubmitIntake, voidIntake } from "@/server/intakes/actions";
import { listClients } from "@/server/clients/actions";
import { listActiveColleagues } from "@/server/users/actions";
import { actionErrorMessage } from "@/lib/action-error";
import { confirmDiscardChanges } from "@/components/patterns/confirm-dialog";
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, WorkspaceDialog } from "@/components/patterns/workspace-dialog";

export function RevisionControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"withdraw" | "void" | null>(null);
  const confirmingClose = useRef(false);
  const [reason, setReason] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof getIntakeEditForm>> | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [people, setPeople] = useState<Awaited<ReturnType<typeof listActiveColleagues>>>([]);

  async function edit() {
    setBusy(true);
    try {
      const [form, clients, users] = await Promise.all([getIntakeEditForm(id), listClients({ pageSize: 100 }), listActiveColleagues()]);
      setData(form);
      setClients(clients.items.map(client => ({ id: client.id, name: client.name, type: client.type })));
      setPeople(users);
      setOpen(true);
    } catch (error) {
      Notification.error({ title: error instanceof Error ? actionErrorMessage(error) : "无法打开补正", duration: 6 });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      await resubmitIntake(id);
      Toast.success("本轮申请已固定并送审");
      router.refresh();
    } catch (error) {
      Notification.error({ title: error instanceof Error ? actionErrorMessage(error) : "送审失败", duration: 6 });
    } finally {
      setBusy(false);
    }
  }

  async function withdrawRequest() {
    setBusy(true);
    try {
      await withdrawIntake(id, reason);
      setAction(null);
      router.refresh();
    } catch (error) {
      Notification.error({ title: error instanceof Error ? actionErrorMessage(error) : "撤回失败", duration: 6 });
    } finally {
      setBusy(false);
    }
  }

  async function voidDraft() {
    setBusy(true);
    try {
      await voidIntake({ id, reason });
      setAction(null);
      Toast.success("草稿已作废");
      router.refresh();
    } catch (error) {
      Notification.error({ title: error instanceof Error ? actionErrorMessage(error) : "作废失败", duration: 6 });
    } finally {
      setBusy(false);
    }
  }

  async function closeAction() {
    if (busy || confirmingClose.current) return;
    if (reason.trim()) {
      confirmingClose.current = true;
      try {
        if (!await confirmDiscardChanges()) return;
      } finally {
        confirmingClose.current = false;
      }
    }
    setAction(null);
  }

  const withdrawing = action === "withdraw";
  const actionTitle = withdrawing ? "撤回补正" : "作废收案草稿";

  return <div className="flex flex-wrap gap-2">
    {["INTAKE", "NEEDS_REVISION"].includes(status) && <>
      <Button htmlType="button" theme="outline" size="small" disabled={busy} onClick={() => void edit()}>编辑收案资料</Button>
      <Button htmlType="button" theme="solid" size="small" disabled={busy} onClick={() => void submit()}>复核并送审</Button>
    </>}
    {status === "PENDING_CONFIRMATION" && <Button htmlType="button" theme="outline" size="small" disabled={busy} onClick={() => { setReason(""); setAction("withdraw"); }}>撤回补正</Button>}
    {status === "INTAKE" && <Button htmlType="button" theme="outline" type="danger" size="small" disabled={busy} onClick={() => { setReason(""); setAction("void"); }}>作废草稿</Button>}
    {data && <IntakeWizard key={`${id}-${data.revision}`} open={open} onOpenChange={setOpen} editing={{ id, ...data }} clientOptions={clients} colleagues={people} onSubmitted={() => router.refresh()} />}
    <WorkspaceDialog open={action !== null} dismissOnBackdrop onOpenChange={open => { if (!open) void closeAction(); }}>
      <DialogContent className="max-w-md" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>{actionTitle}</DialogTitle>
          <DialogDescription>{withdrawing
            ? "原送审内容保留。撤回成功后才能编辑资料和补充材料。"
            : "作废后不再出现在「收案中」页签，记录与审计保留可追溯。如有紧急事项须先处置。"}</DialogDescription>
        </DialogHeader>
        <TextArea
          aria-label={withdrawing ? "撤回原因" : "作废原因"}
          value={reason}
          onChange={setReason}
          disabled={busy}
          placeholder={withdrawing ? undefined : "如：重复登记／当事人放弃委托"}
        />
        <DialogFooter>
          <Button htmlType="button" type="tertiary" theme="outline" disabled={busy} onClick={() => void closeAction()}>取消</Button>
          <Button htmlType="button" type={withdrawing ? "primary" : "danger"} theme="solid"
            loading={busy} disabled={busy || !reason.trim()} onClick={withdrawing ? withdrawRequest : voidDraft}>
            {withdrawing ? "撤回申请" : "确认作废"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  </div>;
}
