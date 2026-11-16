"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { DocumentCategory, DocumentSourceOrigin } from "@prisma/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { documentCategoryLabel } from "@/lib/enums";
import { documentSourceChip } from "@/lib/ui/moan-tones";
import { actionErrorMessage } from "@/lib/action-error";
import { uploadDocument } from "@/server/documents/actions";

export type MaterialUploadTarget = {
  procedureId: string | null;
  stageId: string | null;
  label: string;
  category: DocumentCategory;
  sourceOptions: string[];
};

const categories: DocumentCategory[] = ["CONTRACT", "PLEADING", "EVIDENCE", "PROCEDURE", "JUDGMENT", "OTHER"];

export function CaseMaterialUpload({ matterId, target, onClose, onSaved }: {
  matterId: string;
  target: MaterialUploadTarget;
  onClose: () => void;
  onSaved: (documentId: string) => void;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState(target.category);
  const [origin, setOrigin] = useState<DocumentSourceOrigin | "">("");
  const [party, setParty] = useState("");
  const [pending, startTransition] = useTransition();
  const request = useRef<{ signature: string; key: string } | null>(null);
  const dirty = Boolean(file || name || origin || party || category !== target.category);

  useEffect(() => {
    if (!dirty && !pending) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, pending]);

  async function close() {
    if (pending) return;
    if (dirty && !(await confirmDialog({ title: "放弃本次上传？", description: "所选文件和填写内容尚未保存。", confirmText: "放弃上传", cancelText: "继续填写", initialFocus: "cancel", danger: true }))) return;
    onClose();
  }

  function submit() {
    if (!file || pending) return;
    const sourceParty = category === "PLEADING" || category === "EVIDENCE" ? party : "";
    const signature = JSON.stringify([file.name, file.size, file.lastModified, name.trim(), category, origin, sourceParty]);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    const form = new FormData();
    form.set("matterId", matterId);
    if (target.procedureId) form.set("procedureId", target.procedureId);
    if (target.stageId) form.set("stageId", target.stageId);
    form.set("file", file);
    form.set("name", name.trim() || file.name);
    form.set("category", category);
    form.set("sourceOrigin", origin);
    form.set("sourceParty", sourceParty);
    form.set("requestKey", request.current.key);
    startTransition(async () => {
      try {
        const result = await uploadDocument(form);
        toast.success("材料已保存");
        onSaved(result.id);
      } catch (error) {
        toast.error("上传失败", { description: actionErrorMessage(error) });
      }
    });
  }

  return <Dialog open onOpenChange={open => { if (!open) void close(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>上传材料</DialogTitle><DialogDescription>{target.label}</DialogDescription></DialogHeader>
      <fieldset disabled={pending} className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor={`${id}-file`}>文件</Label>
          <Input id={`${id}-file`} type="file" onChange={event => { request.current = null; setFile(event.target.files?.[0] ?? null); }} />
        </div>
        <div className="space-y-1.5"><Label htmlFor={`${id}-name`}>显示名</Label>
          <Input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} placeholder={file?.name ?? "使用文件名"} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor={`${id}-category`}>类别</Label>
            <Select value={category} onValueChange={value => setCategory(value as DocumentCategory)} disabled={pending}>
              <SelectTrigger id={`${id}-category`}><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map(value => <SelectItem key={value} value={value}>{documentCategoryLabel[value]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor={`${id}-origin`}>来源</Label>
            <Select value={origin || "none"} onValueChange={value => setOrigin(value === "none" ? "" : value as DocumentSourceOrigin)} disabled={pending}>
              <SelectTrigger id={`${id}-origin`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">不标注</SelectItem>
                {(Object.keys(documentSourceChip) as DocumentSourceOrigin[]).map(value => <SelectItem key={value} value={value}>{documentSourceChip[value].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {(category === "PLEADING" || category === "EVIDENCE") && target.sourceOptions.length > 0 ? <div className="space-y-1.5"><Label htmlFor={`${id}-party`}>提供方</Label>
          <Select value={party || "none"} onValueChange={value => setParty(value === "none" ? "" : value)} disabled={pending}>
            <SelectTrigger id={`${id}-party`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">不标注</SelectItem>{target.sourceOptions.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
          </Select>
        </div> : null}
      </fieldset>
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => void close()}>取消</Button>
        <Button disabled={pending || !file} onClick={submit}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}{pending ? "正在上传" : "上传"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
