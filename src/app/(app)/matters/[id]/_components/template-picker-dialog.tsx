"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { ContextInputPicker } from "@/components/matters/context-input-picker";
import type { ContextInputSelection } from "@/lib/matters/context-inputs";
import { prepareTemplate, renderTemplate } from "@/server/document-templates/actions";
import { type TemplateSummary, type FolderPayload, TEMPLATE_CATEGORY_CN, VARIABLE_LABEL_CN } from "./folder-types";
import { actionErrorMessage } from "@/lib/action-error";
import { missingTemplateTargets, type TemplatePreparation, type TemplateSelection } from "@/lib/template-render-fields";

export function TemplatePickerDialog({ open, onOpenChange, matterId, matterCategory, folders, templates }: {
  open: boolean; onOpenChange: (open: boolean) => void; matterId: string; matterCategory: string;
  folders: FolderPayload[]; templates: TemplateSummary[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<TemplatePreparation | null>(null);
  const [targetFolderId, setTargetFolderId] = useState("auto");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [contextInputs, setContextInputs] = useState<ContextInputSelection[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const loadSequence = useRef(0);
  const applicable = useMemo(() => templates.filter(template => !template.applicableCategories.length || template.applicableCategories.includes(matterCategory)), [templates, matterCategory]);
  const selected = applicable.find(template => template.id === selectedId);
  const dirty = Object.keys(overrides).length > 0 || contextInputs.length > 0;
  const missing = preparation?.fields.filter(field => field.editable ? !(overrides[field.path] ?? field.value).trim() : field.missing) ?? [];
  const unselected = preparation ? missingTemplateTargets(preparation.fields.map(field => field.path), preparation.selection, preparation.choices) : [];

  async function canDiscard() {
    return !dirty || await confirmDialog({ title: "放弃本次补填？", description: "补填内容尚未生成文书。", confirmText: "放弃补填", cancelText: "继续编辑", initialFocus: "cancel" });
  }
  function clear() {
    loadSequence.current += 1;
    setContextInputs([]);
    setSelectedId(null); setPreparation(null); setTargetFolderId("auto"); setOverrides({}); setReviewed(false); setError(null); setLoading(false); setRequestKey(crypto.randomUUID());
  }
  async function close() {
    if (pending || !await canDiscard()) return;
    clear(); onOpenChange(false);
  }
  async function load(templateId: string, selection?: TemplateSelection) {
    if (pending || !await canDiscard()) return;
    const sequence = ++loadSequence.current;
    setContextInputs([]);
    setSelectedId(templateId); setPreparation(null); setOverrides({}); setReviewed(false); setError(null); setLoading(true); setRequestKey(crypto.randomUUID());
    try {
      const result = await prepareTemplate({ matterId, templateId, ...(selection ? { selection } : {}) });
      if (sequence === loadSequence.current) setPreparation(result);
    } catch (cause) {
      if (sequence === loadSequence.current) setError(actionErrorMessage(cause));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  function changeValue(path: string, value: string) {
    setOverrides(previous => ({ ...previous, [path]: value })); setReviewed(false); setRequestKey(crypto.randomUUID());
  }
  function submit() {
    if (!preparation || !reviewed || missing.length || unselected.length) return;
    startTransition(async () => {
      try {
        const result = await renderTemplate({ matterId, templateId: preparation.templateId, templateUpdatedAt: preparation.templateUpdatedAt,
          contextInputs,
          selection: preparation.selection, requestKey, folderId: targetFolderId === "auto" ? null : targetFolderId,
          expectedValues: Object.fromEntries(preparation.fields.map(field => [field.path, field.value])), overrides, reviewed: true });
        toast.success(`已保存「${result.fileName}」草稿`);
        window.open(`/api/documents/${result.documentId}/download`, "_blank", "noopener,noreferrer");
        clear(); onOpenChange(false);
      } catch (cause) { setError(actionErrorMessage(cause)); }
    });
  }
  const targetFields = [
    { key: "clientId", choices: "clients", label: "委托人" },
    { key: "opposingPartyId", choices: "opposing", label: "对方当事人" },
    { key: "thirdPartyId", choices: "thirds", label: "第三人" },
    { key: "procedureId", choices: "procedures", label: "程序" },
  ] as const;

  return <Dialog open={open} onOpenChange={value => { if (!value) void close(); }}>
    <DialogContent className="max-w-4xl" onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>从模板起草</DialogTitle></DialogHeader>
      <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-6">
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto" aria-label="文书模板">
          {applicable.length === 0 && <p className="text-muted-foreground">暂无适用模板</p>}
          {applicable.map(template => <Button key={template.id} aria-label={template.name} type="button" variant={selectedId === template.id ? "secondary" : "ghost"} disabled={pending} className="h-auto justify-start whitespace-normal text-left" onClick={() => { if (selectedId !== template.id) void load(template.id); }}>
            <FileText data-icon="inline-start" />
            <span className="flex min-w-0 flex-col gap-1"><span>{template.name}</span><span className="text-xs text-muted-foreground">{TEMPLATE_CATEGORY_CN[template.category]}</span></span>
          </Button>)}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {loading && <p role="status">正在读取模板字段…</p>}
          {error && <Alert variant="destructive"><AlertDescription className="flex flex-col gap-2"><span>{error}</span>{selectedId && <Button variant="outline" size="sm" disabled={pending || loading} onClick={() => void load(selectedId, preparation?.selection)}>重新核对字段</Button>}</AlertDescription></Alert>}
          {!selectedId && <p className="text-muted-foreground">请选择模板</p>}
          {selected && preparation && <>
            <div className="grid grid-cols-2 gap-3">
              {targetFields.filter(target => preparation.choices[target.choices].length > 0).map(target => <div key={target.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`template-${target.key}`}>{target.label}</Label>
                <Select value={preparation.selection[target.key] ?? "none"} disabled={pending} onValueChange={id => void load(selected.id, { ...preparation.selection, [target.key]: id === "none" ? null : id })}>
                  <SelectTrigger id={`template-${target.key}`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup><SelectItem value="none">未选择</SelectItem>{preparation.choices[target.choices].map(choice => <SelectItem key={choice.id} value={choice.id}>{choice.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </div>)}
            </div>
            {unselected.length > 0 && <p className="text-sm text-destructive">请选择{unselected.join("、")}</p>}
            <div className="flex items-center justify-between gap-2"><h3 className="font-medium">本次文书字段</h3>{missing.length > 0 && <Badge variant="secondary">{missing.length} 项待补全</Badge>}</div>
            <div className="flex max-h-[38vh] flex-col gap-3 overflow-y-auto pr-2">
              {preparation.fields.length === 0 && <p className="text-muted-foreground">此模板没有待填字段</p>}
              {preparation.fields.map(field => <div key={field.path} className="flex flex-col gap-1.5">
                <Label htmlFor={`template-field-${field.path}`}>{VARIABLE_LABEL_CN[field.path] ?? field.path}</Label>
                {field.editable ? <Input id={`template-field-${field.path}`} disabled={pending} value={overrides[field.path] ?? field.value} maxLength={2000}
                  aria-invalid={!(overrides[field.path] ?? field.value).trim()} onChange={event => changeValue(field.path, event.target.value)} />
                  : <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{field.missing ? "尚无对应当事人，请先完善案件主体" : field.value}</p>}
              </div>)}
            </div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="template-folder">保存卷宗</Label>
              <Select value={targetFolderId} disabled={pending} onValueChange={id => { setTargetFolderId(id); setRequestKey(crypto.randomUUID()); }}>
                <SelectTrigger id="template-folder"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="auto">按模板类别推荐</SelectItem>{folders.map(folder => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2"><Checkbox id="template-reviewed" disabled={pending || missing.length > 0 || unselected.length > 0} checked={reviewed} onCheckedChange={value => setReviewed(value === true)} /><Label htmlFor="template-reviewed">已核对主体、程序及字段，仅用于本次文书</Label></div>
            <ContextInputPicker matterId={matterId} value={contextInputs} disabled={pending} onChange={value => { setContextInputs(value); setRequestKey(crypto.randomUUID()); }} />
          </>}
        </div>
      </div>
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => void close()}>取消</Button><Button disabled={!preparation || loading || pending || !reviewed || missing.length > 0 || unselected.length > 0} onClick={submit}>{pending && <Loader2 data-icon="inline-start" className="animate-spin" />}生成草稿并下载</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
