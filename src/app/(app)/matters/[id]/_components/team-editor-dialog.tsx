"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspaceDialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/patterns/workspace-dialog";
import { FormDialogBody, FormDialogContent } from "@/components/patterns/form-dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { MatterBasicEditor } from "./matter-basic-editor";
import { MatterTeamEditor } from "./matter-team-editor";
import { ProcedureInfoEditor } from "./procedure-info-editor";
import type { MatterEditorSection, TeamEditorDialogProps } from "./matter-editor-types";
export type { MatterEditorSection, TeamEditorDialogProps } from "./matter-editor-types";

const editorSectionTitle: Record<MatterEditorSection, string> = {
  matter: "编辑案件信息", procedure: "编辑程序与当事人", parties: "编辑程序与当事人", team: "管理承办成员"
};

export function TeamEditorDialog(props: TeamEditorDialogProps) {
  // Each opening starts one task. Server refreshes while it is open never replace its draft or expected values.
  return props.open ? <OpenEditor {...props} /> : null;
}

function OpenEditor(props: TeamEditorDialogProps) {
  const [initial] = useState(() => props);
  const [state, setState] = useState({ dirty: false, pending: false });
  const contentRef = useRef<HTMLDivElement>(null);
  const askingToDiscard = useRef(false);
  const section = initial.initialSection ?? "matter";
  const permitted = section === "matter" ? props.canEditMatterInfo : section === "team" ? props.canManageTeam : !!props.canManageProcedure && !!initial.currentProcedure;

  useEffect(() => {
    if (!state.dirty && !state.pending) return;
    const warnOnLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnOnLeave);
    return () => window.removeEventListener("beforeunload", warnOnLeave);
  }, [state]);

  async function leave(openHandover = false) {
    if (state.pending || askingToDiscard.current) return;
    if (state.dirty) {
      askingToDiscard.current = true;
      const discard = await confirmDialog({ title: "放弃未保存的修改？", confirmText: "放弃修改", cancelText: "继续编辑", initialFocus: "cancel", danger: true });
      askingToDiscard.current = false;
      if (!discard) return;
    }
    props.onOpenChange(false);
    if (openHandover) props.onOpenHandover?.();
  }

  const actions = { onStateChange: setState, onSaved: () => props.onOpenChange(false), onCancel: () => { void leave(); } };
  return <WorkspaceDialog open onOpenChange={open => { if (!open) void leave(); }}>
    <FormDialogContent ref={contentRef} className="max-w-3xl"
      onOpenAutoFocus={event => {
        const target = contentRef.current?.querySelector<HTMLElement>('[data-editor-autofocus="true"]');
        if (target) { event.preventDefault(); target.focus({ preventScroll: true }); target.scrollIntoView({ block: "start" }); }
      }}
      onCloseAutoFocus={event => { if (props.onReturnFocus) { event.preventDefault(); props.onReturnFocus(); } }}>
      <DialogHeader>
        <DialogTitle>{editorSectionTitle[section]}</DialogTitle>
        <DialogDescription className="sr-only">{editorSectionTitle[section]}，保存后返回原位置。</DialogDescription>
      </DialogHeader>
      {!permitted ? <FormDialogBody><p role="alert" className="text-sm text-destructive">当前对象不存在或已无权修改，请关闭后重新选择。</p></FormDialogBody> :
        section === "matter" ? <MatterBasicEditor {...actions} matterId={initial.matterId} matterMeta={initial.matterMeta} procedureType={initial.currentProcedure?.type} /> :
        section === "team" ? <MatterTeamEditor {...actions} matterId={initial.matterId} currentOwnerId={initial.currentOwnerId} currentMembers={initial.currentMembers} userOptions={props.userOptions}
          onOpenHandover={props.onOpenHandover ? () => { void leave(true); } : undefined} /> :
        initial.currentProcedure ? <ProcedureInfoEditor {...actions} currentProcedure={initial.currentProcedure} parties={initial.parties} category={initial.matterMeta.category} initialSection={section} /> : null}
    </FormDialogContent>
  </WorkspaceDialog>;
}
