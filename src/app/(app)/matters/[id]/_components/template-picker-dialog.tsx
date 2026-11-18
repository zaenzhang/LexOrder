"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { IconArticle as FileText, IconLoading as Loader2 } from "@douyinfe/semi-icons";
import { Banner, Button, Checkbox, Input, Select, Tag, Toast } from "@douyinfe/semi-ui";
import { WorkspaceDialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/patterns/workspace-dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { ContextInputPicker } from "@/components/matters/context-input-picker";
import type { ContextInputSelection } from "@/lib/matters/context-inputs";
import { prepareTemplate, renderTemplate } from "@/server/document-templates/actions";
import { type TemplateSummary, type FolderPayload, TEMPLATE_CATEGORY_CN, VARIABLE_LABEL_CN } from "./folder-types";
import { actionErrorMessage } from "@/lib/action-error";
import { missingTemplateTargets, type TemplateField, type TemplatePreparation, type TemplateSelection } from "@/lib/template-render-fields";

function fieldLabel(field: TemplateField) {
  const names: Record<string, string> = { name: "名称", idNumber: "证件号码", phone: "电话", address: "地址", legalRep: "法定代表人" };
  const groups: Record<string, string> = { plaintiffs: "原告名单", defendants: "被告名单", thirds: "第三人名单" };
  return field.subjectLabel ? `${field.subjectLabel} · ${names[field.path.split(".").at(-1)!] ?? field.path.split(".").slice(2).join(".")}`
    : VARIABLE_LABEL_CN[field.path] ?? groups[field.path] ?? field.path;
}

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
  const requestedSelection = useRef<TemplateSelection | undefined>(undefined);
  const applicable = useMemo(() => templates.filter(template => !template.applicableCategories.length || template.applicableCategories.includes(matterCategory)), [templates, matterCategory]);
  const selected = applicable.find(template => template.id === selectedId);
  const dirty = Object.keys(overrides).length > 0 || contextInputs.length > 0;
  const missing = preparation?.fields.filter(field => field.required && (field.editable ? !(overrides[field.path] ?? field.value).trim() : field.missing)) ?? [];
  const needsRecheck = preparation?.fields.some(field => field.controlsScope && field.editable && Object.hasOwn(overrides, field.path) && overrides[field.path].trim() !== field.value) ?? false;
  const unselected = preparation ? missingTemplateTargets(preparation.fields.map(field => field.path), preparation.selection, preparation.choices) : [];

  async function canDiscard() {
    return !dirty || await confirmDialog({ title: "放弃本次补填？", description: "补填内容尚未生成文书。", confirmText: "放弃补填", cancelText: "继续编辑", initialFocus: "cancel" });
  }
  function clear() {
    loadSequence.current += 1;
    requestedSelection.current = undefined;
    setContextInputs([]);
    setSelectedId(null); setPreparation(null); setTargetFolderId("auto"); setOverrides({}); setReviewed(false); setError(null); setLoading(false); setRequestKey(crypto.randomUUID());
  }
  async function close() {
    if (pending || !await canDiscard()) return;
    clear(); onOpenChange(false);
  }
  async function load(templateId: string, selection?: TemplateSelection) {
    if (pending || loading || !await canDiscard()) return;
    const sequence = ++loadSequence.current;
    requestedSelection.current = selection;
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
  async function recheck() {
    if (!selectedId || loading || pending) return;
    const sequence = ++loadSequence.current;
    setReviewed(false); setError(null); setLoading(true);
    try {
      const result = await prepareTemplate({ matterId, templateId: selectedId,
        selection: preparation?.selection ?? requestedSelection.current, overrides,
        ...(preparation ? { expectedSubjects: preparation.expectedSubjects } : {}) });
      if (sequence === loadSequence.current) { setPreparation(result); setRequestKey(crypto.randomUUID()); }
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
    if (!preparation || !reviewed || loading || needsRecheck || missing.length || unselected.length) return;
    startTransition(async () => {
      try {
        const result = await renderTemplate({ matterId, templateId: preparation.templateId, templateUpdatedAt: preparation.templateUpdatedAt,
          contextInputs,
          selection: preparation.selection, requestKey, folderId: targetFolderId === "auto" ? null : targetFolderId,
          expectedValues: preparation.expectedValues, expectedSubjects: preparation.expectedSubjects,
          overrides: Object.fromEntries(preparation.fields.filter(field => field.editable && Object.hasOwn(overrides, field.path)).map(field => [field.path, overrides[field.path]])), reviewed: true });
        Toast.success(`已保存「${result.fileName}」草稿`);
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

  return <WorkspaceDialog dismissOnBackdrop open={open} onOpenChange={value => { if (!value) void close(); }}>
    <DialogContent className="max-w-4xl" onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>从模板起草</DialogTitle></DialogHeader>
      <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-6">
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto" aria-label="文书模板">
          {applicable.length === 0 && <p className="text-muted-foreground">暂无适用模板</p>}
          {applicable.map(template => <Button key={template.id} aria-label={template.name} disabled={pending || loading} className="h-auto justify-start whitespace-normal text-left" onClick={() => { if (selectedId !== template.id) void load(template.id); }} htmlType="button" type={selectedId === template.id ? "primary" : "tertiary"} theme={selectedId === template.id ? "light" : "borderless"}>
            <FileText aria-hidden data-icon="inline-start" />
            <span className="flex min-w-0 flex-col gap-1"><span>{template.name}</span><span className="text-xs text-muted-foreground">{TEMPLATE_CATEGORY_CN[template.category]}</span></span>
          </Button>)}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {loading && <p role="status">正在读取模板字段…</p>}
          {error && <Banner type="danger" closeIcon={null} fullMode={false} description={<> <div className="flex flex-col gap-2"><span>{error}</span>{selectedId && (!preparation
            ? <Button disabled={pending || loading} onClick={() => void recheck()} type="tertiary" theme="outline" size="small">重新核对字段</Button>
            : <Button disabled={pending || loading} onClick={() => void load(selectedId)} type="tertiary" theme="outline" size="small">重新开始核对</Button>)}</div></>} />}
          {!selectedId && <p className="text-muted-foreground">请选择模板</p>}
          {selected && preparation && <>
            <div className="grid grid-cols-2 gap-3">
              {targetFields.filter(target => preparation.choices[target.choices].length > 0).map(target => <div key={target.key} className="flex flex-col gap-1.5">
                <label id={`template-${target.key}` + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">{target.label}</label>
                <Select value={preparation.selection[target.key] ?? "none"} disabled={pending || loading} onChange={id => { if (typeof id === "string") void load(selected.id, { ...preparation.selection, [target.key]: id === "none" ? null : id }); }} id={`template-${target.key}`} aria-labelledby={`template-${target.key}` + "-label"} className="w-full" motion={false}><Select.Option value="none">未选择</Select.Option>{preparation.choices[target.choices].map(choice => <Select.Option key={choice.id} value={choice.id}>{choice.label}</Select.Option>)}</Select>
              </div>)}
            </div>
            {unselected.length > 0 && <p className="text-sm text-destructive">请选择{unselected.join("、")}</p>}
            <div className="flex items-center justify-between gap-2"><h3 className="font-medium">本次文书字段</h3>{missing.length > 0 && <Tag color="grey">{missing.length} 项待补全</Tag>}
              <Button disabled={pending || loading} onClick={() => void recheck()} htmlType="button" type="tertiary" theme="outline" size="small">重新核对字段</Button></div>
            {needsRecheck && <p className="text-sm text-muted-foreground">条件已变化，请重新核对本次需填字段。已填内容会保留。</p>}
            <div className="flex max-h-[38vh] flex-col gap-3 overflow-y-auto pr-2">
              {preparation.fields.length === 0 && <p className="text-muted-foreground">此模板没有待填字段</p>}
              {preparation.fields.map(field => <div key={field.path} className="flex flex-col gap-1.5">
                <label htmlFor={`template-field-${field.path}`} className="text-sm font-medium text-[var(--semi-color-text-1)]">{fieldLabel(field)}</label>
                {field.controlsScope && field.editable && !field.required && <span className="text-xs text-muted-foreground">可选条件，修改后重新核对字段。</span>}
                {field.editable ? <Input
                  id={`template-field-${field.path}`}
                  disabled={pending || loading}
                  value={overrides[field.path] ?? field.value}
                  maxLength={2000}
                  aria-invalid={field.required && !(overrides[field.path] ?? field.value).trim()}
                  onChange={inputValue => changeValue(field.path, inputValue)} />
                  : <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{field.value}</p>}
              </div>)}
            </div>
            <div className="flex flex-col gap-1.5"><label id={"template-folder" + "-label"} className="text-sm font-medium text-[var(--semi-color-text-1)]">保存卷宗</label>
              <Select value={targetFolderId} disabled={pending || loading} onChange={id => { if (typeof id !== "string") return; setTargetFolderId(id); setRequestKey(crypto.randomUUID()); }} id="template-folder" aria-labelledby={"template-folder" + "-label"} className="w-full" motion={false}><Select.Option value="auto">按模板类别推荐</Select.Option>{folders.map(folder => <Select.Option key={folder.id} value={folder.id}>{folder.name}</Select.Option>)}</Select>
            </div>
            <Checkbox disabled={pending || loading || needsRecheck || missing.length > 0 || unselected.length > 0} checked={reviewed} onChange={({ target: { checked } }) => setReviewed(checked === true)}>已核对主体、程序及字段，仅用于本次文书</Checkbox>
            <ContextInputPicker matterId={matterId} value={contextInputs} disabled={pending || loading} onChange={value => { setContextInputs(value); setRequestKey(crypto.randomUUID()); }} />
          </>}
        </div>
      </div>
      <DialogFooter><Button disabled={pending} onClick={() => void close()} type="tertiary" theme="outline">取消</Button><Button disabled={!preparation || loading || pending || needsRecheck || !reviewed || missing.length > 0 || unselected.length > 0} onClick={submit} theme="solid">{pending && <Loader2 aria-hidden data-icon="inline-start" spin />}生成草稿并下载</Button></DialogFooter>
    </DialogContent>
  </WorkspaceDialog>;
}
