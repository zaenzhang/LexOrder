"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button, Checkbox, Toast } from "@douyinfe/semi-ui";
import { ColleaguePicker } from "@/components/matters/colleague-picker";
import { FormDialogBody } from "@/components/patterns/form-dialog";
import { DialogFooter } from "@/components/ui/dialog";
import { actionErrorMessage } from "@/lib/action-error";
import { updateMatterTeam } from "@/server/matters/actions";
import type { EditorFormActions, TeamEditorDialogProps } from "./matter-editor-types";

export function MatterTeamEditor({ matterId, currentOwnerId, currentMembers, userOptions, onStateChange, onSaved, onCancel, onOpenHandover }: EditorFormActions &
  Pick<TeamEditorDialogProps, "matterId" | "currentOwnerId" | "currentMembers" | "userOptions" | "onOpenHandover">) {
  const [coLeads, setCoLeads] = useState(() => currentMembers.filter(member => member.role === "CO_LEAD").map(member => member.userId));
  const [assistants, setAssistants] = useState(() => currentMembers.filter(member => member.role === "ASSISTANT").map(member => member.userId));
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const originalCoLeads = currentMembers.filter(member => member.role === "CO_LEAD").map(member => member.userId);
  const originalAssistants = currentMembers.filter(member => member.role === "ASSISTANT").map(member => member.userId);
  const dirty = coLeads.length !== originalCoLeads.length || coLeads.some(id => !originalCoLeads.includes(id)) ||
    assistants.length !== originalAssistants.length || assistants.some(id => !originalAssistants.includes(id));
  useEffect(() => onStateChange({ dirty, pending: isPending }), [dirty, isPending, onStateChange]);
  const ownerName = userOptions.find(user => user.id === currentOwnerId)?.name ?? currentMembers.find(member => member.userId === currentOwnerId)?.name;

  function save() {
    if (isPending) return;
    setError("");
    startTransition(async () => {
      try {
        await updateMatterTeam({ matterId, expectedOwnerId: currentOwnerId,
          expectedMembers: currentMembers.map(({ userId, role }) => ({ userId, role })), coLeadIds: coLeads, assistantIds: assistants });
        Toast.success("承办成员已保存");
        onSaved();
      } catch (err) { setError(actionErrorMessage(err) || "保存失败，请稍后重试"); }
    });
  }

  return <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); save(); }}>
    <FormDialogBody>
      <fieldset disabled={isPending} className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div><label className="text-sm font-medium text-[var(--semi-color-text-1)]">主办律师</label><p className="mt-1 text-sm">{ownerName ?? "姓名不可读取"}</p></div>
          {onOpenHandover && <Button onClick={onOpenHandover} htmlType="button" type="tertiary" theme="outline">办理主办交接</Button>}
        </div>
        <section aria-label="协办律师" className="space-y-2">
          <h3 className="text-sm font-medium">协办律师</h3>
          <ColleaguePicker people={userOptions.filter(user => user.id !== currentOwnerId)} selected={coLeads}
            onChange={ids => { setCoLeads(ids); setAssistants(current => current.filter(id => !ids.includes(id))); }} />
        </section>
        <section aria-label="助理" className="space-y-2">
          <h3 className="text-sm font-medium">助理</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {userOptions.filter(user => user.id !== currentOwnerId && !coLeads.includes(user.id) && (user.active !== false || assistants.includes(user.id))).map(user =>
              <div key={user.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox checked={assistants.includes(user.id)} onChange={({ target: { checked } }) => setAssistants(current => checked === true ? [...current, user.id] : current.filter(id => id !== user.id))}>
                <span>{user.name}{user.active === false ? "（账号停用）" : ""}</span>
              </Checkbox></div>)}
          </div>
        </section>
      </fieldset>
    </FormDialogBody>
    <DialogFooter className="px-6 py-4">
      {error && <p role="alert" className="basis-full text-sm text-destructive">{error}</p>}
      <Button onClick={onCancel} disabled={isPending} htmlType="button" type="tertiary" theme="outline">取消</Button>
      <Button disabled={isPending || !dirty} htmlType="submit" theme="solid">{isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存承办成员</Button>
    </DialogFooter>
  </form>;
}
