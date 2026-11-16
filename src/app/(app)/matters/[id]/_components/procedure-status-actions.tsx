"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { updateProcedure } from "@/server/procedures/actions";
import { actionErrorMessage } from "@/lib/action-error";
import { shDayKey } from "@/lib/ui/sh-time";

type Procedure = { id: string; status: "PENDING" | "IN_PROGRESS" | "CONCLUDED"; updatedAt: Date; concludedAt: Date | null; engagement: string };
type Target = { procedure: Procedure; label: string; status: "IN_PROGRESS" | "CONCLUDED" };

export function ProcedureStatusActions({ procedure, label }: { procedure: Procedure; label: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<Target | null>(null);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const restoring = target?.status === "IN_PROGRESS" && target.procedure.status === "CONCLUDED";
  const unverifiedInformation = procedure.engagement === "INFORMATIONAL" && procedure.status === "CONCLUDED" && !procedure.concludedAt;
  const recordingUnknownState = restoring && target.procedure.engagement === "INFORMATIONAL" && !target.procedure.concludedAt;
  const title = target?.status === "CONCLUDED" ? "终结程序" : restoring && !recordingUnknownState ? "恢复办理" : (target?.procedure ?? procedure).engagement === "INFORMATIONAL" ? "记录办理中" : "开始办理";
  function open(status: Target["status"]) { setTarget({ procedure, label, status }); setDate(""); setReason(""); setError(""); }
  async function close() {
    if (busy) return;
    if ((date || reason) && !await confirmDialog({ title: "放弃未保存的状态记录？", confirmText: "放弃修改", cancelText: "继续编辑", initialFocus: "cancel" })) return;
    setTarget(null);
  }
  async function save() {
    if (!target || busy) return;
    if (target.status === "CONCLUDED" && !date) { setError("请填写程序实际终结日期"); return; }
    if (restoring && !reason.trim()) { setError(recordingUnknownState ? "请说明核对后的程序状态" : "请说明恢复办理的原因"); return; }
    setBusy(true); setError("");
    try {
      await updateProcedure({ id: target.procedure.id, expectedUpdatedAt: target.procedure.updatedAt, status: target.status,
        ...(target.status === "CONCLUDED" ? { concludedAt: new Date(`${date}T00:00:00+08:00`) } : {}), changeReason: reason.trim() || undefined });
      toast.success("程序状态已保存"); setTarget(null); router.refresh();
    } catch (cause) { setError(actionErrorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <>
    <div className="flex flex-wrap gap-2 border-t px-3 py-2">
      {procedure.status !== "IN_PROGRESS" && <Button size="sm" variant="outline" onClick={() => open("IN_PROGRESS")}>{procedure.status === "CONCLUDED" && !unverifiedInformation ? "恢复办理" : procedure.engagement === "INFORMATIONAL" ? "记录办理中" : "开始办理"}</Button>}
      {(procedure.status !== "CONCLUDED" || !procedure.concludedAt) && <Button size="sm" variant="outline" onClick={() => open("CONCLUDED")}>终结程序</Button>}
    </div>
    <Dialog open={Boolean(target)} onOpenChange={open => { if (!open) void close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{target?.label}</DialogDescription></DialogHeader>
        {target?.status === "CONCLUDED" && <div className="space-y-2"><Label htmlFor="procedure-concluded-at">实际终结日期</Label><Input id="procedure-concluded-at" type="date" max={shDayKey(new Date())} value={date} disabled={busy} onChange={event => setDate(event.target.value)} /></div>}
        <div className="space-y-2"><Label htmlFor="procedure-status-reason">{recordingUnknownState ? "状态核对说明" : restoring ? "恢复原因" : "说明（可选）"}</Label><Textarea id="procedure-status-reason" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></div>
        {restoring && <p className="text-sm text-muted-foreground">{recordingUnknownState ? "此信息记录尚未核实实际终结，本次记录核对后的状态；原数据保留在审计历史。" : "恢复后清除当前终结日期和结果，原记录保留在审计历史。"}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => void close()}>取消</Button><Button disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存状态"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
