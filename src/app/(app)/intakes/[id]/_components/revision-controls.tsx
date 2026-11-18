"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TextArea } from "@douyinfe/semi-ui";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from "@/components/ui/dialog";
import { IntakeWizard, type ClientOption } from "../../_components/intake-wizard";
import { getIntakeEditForm, withdrawIntake } from "@/server/intakes/revision-actions";
import { resubmitIntake, voidIntake } from "@/server/intakes/actions";
import { listClients } from "@/server/clients/actions";
import { listActiveColleagues } from "@/server/users/actions";
import { actionErrorMessage } from "@/lib/action-error";

export function RevisionControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const reasonTrigger = useRef<HTMLButtonElement | null>(null);
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
      toast.error(actionErrorMessage(error));
    } finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true);
    try {
      await resubmitIntake(id);
      toast.success("本轮申请已固定并送审");
      router.refresh();
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally { setBusy(false); }
  }

  async function confirmWithdraw() {
    setBusy(true);
    try {
      await withdrawIntake(id, reason);
      setWithdraw(false);
      router.refresh();
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally { setBusy(false); }
  }

  async function confirmVoid() {
    setBusy(true);
    try {
      await voidIntake({ id, reason });
      setVoiding(false);
      toast.success("草稿已作废");
      router.refresh();
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally { setBusy(false); }
  }

  return <div className="flex flex-wrap gap-2">
    {["INTAKE", "NEEDS_REVISION"].includes(status) && <>
      <Button disabled={busy} size="small" onClick={() => void edit()}>编辑收案资料</Button>
      <Button disabled={busy} theme="solid" size="small" onClick={() => void submit()}>复核并送审</Button>
    </>}
    {status === "PENDING_CONFIRMATION" && <Button disabled={busy} size="small" onClick={(event) => { reasonTrigger.current = event.currentTarget; setReason(""); setWithdraw(true); }}>撤回补正</Button>}
    {status === "INTAKE" && <Button disabled={busy} theme="outline" size="small" onClick={(event) => { reasonTrigger.current = event.currentTarget; setReason(""); setVoiding(true); }}>作废草稿</Button>}
    {data && <IntakeWizard key={`${id}-${data.revision}`} open={open} onOpenChange={setOpen} editing={{ id, ...data }} clientOptions={clients} colleagues={people} onSubmitted={() => router.refresh()} />}
    <Dialog open={withdraw} onOpenChange={(next) => { if (!busy) setWithdraw(next); }}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); reasonTrigger.current?.focus(); }}>
        <DialogHeader><DialogTitle>撤回补正</DialogTitle><DialogDescription>原送审内容保留。撤回成功后才能编辑资料和补充材料。</DialogDescription></DialogHeader>
        <TextArea aria-label="撤回原因" value={reason} onChange={setReason} disabled={busy} />
        <Button theme="solid" disabled={busy || !reason.trim()} loading={busy} onClick={() => void confirmWithdraw()}>撤回申请</Button>
      </DialogContent>
    </Dialog>
    <Dialog open={voiding} onOpenChange={(next) => { if (!busy) setVoiding(next); }}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); reasonTrigger.current?.focus(); }}>
        <DialogHeader><DialogTitle>作废收案草稿</DialogTitle><DialogDescription>作废后不再出现在「收案中」页签，记录与审计保留可追溯。如有紧急事项须先处置。</DialogDescription></DialogHeader>
        <TextArea aria-label="作废原因" value={reason} onChange={setReason} disabled={busy} placeholder="如：重复登记／当事人放弃委托" />
        <Button type="danger" theme="solid" disabled={busy || !reason.trim()} loading={busy} onClick={() => void confirmVoid()}>确认作废</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
