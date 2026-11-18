"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, TextArea } from "@douyinfe/semi-ui";
import { toast } from "sonner";
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
      toast.error(error instanceof Error ? actionErrorMessage(error) : "无法打开补正");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      await resubmitIntake(id);
      toast.success("本轮申请已固定并送审");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? actionErrorMessage(error) : "送审失败");
    } finally {
      setBusy(false);
    }
  }

  async function withdrawRequest() {
    setBusy(true);
    try {
      await withdrawIntake(id, reason);
      setWithdraw(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? actionErrorMessage(error) : "撤回失败");
    } finally {
      setBusy(false);
    }
  }

  async function voidDraft() {
    setBusy(true);
    try {
      await voidIntake({ id, reason });
      setVoiding(false);
      toast.success("草稿已作废");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? actionErrorMessage(error) : "作废失败");
    } finally {
      setBusy(false);
    }
  }

  return <div className="flex flex-wrap gap-2">
    {["INTAKE", "NEEDS_REVISION"].includes(status) && <>
      <Button htmlType="button" theme="outline" size="small" disabled={busy} onClick={() => void edit()}>编辑收案资料</Button>
      <Button htmlType="button" theme="solid" size="small" disabled={busy} onClick={() => void submit()}>复核并送审</Button>
    </>}
    {status === "PENDING_CONFIRMATION" && <Button htmlType="button" theme="outline" size="small" disabled={busy} onClick={() => setWithdraw(true)}>撤回补正</Button>}
    {status === "INTAKE" && <Button htmlType="button" theme="outline" type="danger" size="small" disabled={busy} onClick={() => { setReason(""); setVoiding(true); }}>作废草稿</Button>}
    {data && <IntakeWizard key={`${id}-${data.revision}`} open={open} onOpenChange={setOpen} editing={{ id, ...data }} clientOptions={clients} colleagues={people} onSubmitted={() => router.refresh()} />}
    <Modal visible={withdraw} title="撤回补正" motion={false} okText="撤回申请" cancelText="取消"
      confirmLoading={busy} okButtonProps={{ disabled: busy || !reason.trim() }} cancelButtonProps={{ disabled: busy }}
      onCancel={() => { if (!busy) setWithdraw(false); }} onOk={withdrawRequest}>
      <p className="mb-3">原送审内容保留。撤回成功后才能编辑资料和补充材料。</p>
      <TextArea aria-label="撤回原因" value={reason} onChange={setReason} disabled={busy} />
    </Modal>
    <Modal visible={voiding} title="作废收案草稿" motion={false} okText="确认作废" cancelText="取消" okType="danger"
      confirmLoading={busy} okButtonProps={{ disabled: busy || !reason.trim() }} cancelButtonProps={{ disabled: busy }}
      onCancel={() => { if (!busy) setVoiding(false); }} onOk={voidDraft}>
      <p className="mb-3">作废后不再出现在「收案中」页签，记录与审计保留可追溯。如有紧急事项须先处置。</p>
      <TextArea aria-label="作废原因" value={reason} onChange={setReason} disabled={busy} placeholder="如：重复登记／当事人放弃委托" />
    </Modal>
  </div>;
}
