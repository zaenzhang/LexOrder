"use client";

import { useId, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button, Checkbox, Input, Notification, Select, TextArea, Toast } from "@douyinfe/semi-ui";
import { IconFavoriteList as BookOpenCheck, IconExternalOpen as ExternalLink, IconLoading as Loader2, IconTestScore as FileCheck2, IconAIWandLevel1 as Sparkles, IconUpload as Upload, IconTestScore as FileCheck } from "@douyinfe/semi-icons";
import {
  WorkspaceDialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/patterns/workspace-dialog";
import { archiveMatter, getArchivePrepData } from "@/server/archive/actions";
import { uploadDocument } from "@/server/documents/actions";
import { shDayKey } from "@/lib/ui/sh-time";
import { CLOSED_REASON_CN } from "@/server/archive/schemas";
import type { ArchiveChecklist, ArchiveChecklistItem } from "@/lib/archive/checklists";
import type { ArchiveClosedReason } from "@prisma/client";
import { ARCHIVE_MANUAL_CHECKS } from "@/lib/archive/snapshot";
import { actionErrorMessage } from "@/lib/action-error";

interface LinkedDoc {
  id: string;
  name: string;
}

interface AvailableDocument extends LinkedDoc {
  category: string;
  mimeType: string | null;
  size: number | null;
  folderName: string | null;
}

// checklist item.id → DocumentCategory（用于上传时分类）
function inferCategory(itemId: string): string {
  if (itemId.includes("contract") || itemId.includes("retainer") || itemId.includes("counsel"))
    return "CONTRACT";
  if (itemId.includes("evidence")) return "EVIDENCE";
  if (
    itemId.includes("pleading") ||
    itemId.includes("opinion") ||
    itemId.includes("agent") ||
    itemId.includes("legal_opinion")
  )
    return "PLEADING";
  if (itemId.includes("judgment") || itemId.includes("ruling")) return "JUDGMENT";
  if (
    itemId.includes("intake") ||
    itemId.includes("closing") ||
    itemId.includes("power_of_attorney") ||
    itemId.includes("risk_disclosure") ||
    itemId.includes("hearing")
  )
    return "PROCEDURE";
  return "OTHER";
}

interface Props {
  matterId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ArchiveWizardDialog({ matterId, open, onOpenChange }: Props) {
  const selectLabelId = useId();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [checklist, setChecklist] = useState<ArchiveChecklist | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [itemStatuses, setItemStatuses] = useState<Record<string, "MISSING" | "NOT_APPLICABLE">>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [manualChecks, setManualChecks] = useState<Record<string, boolean>>({});
  const [manualNotes, setManualNotes] = useState<Record<string, string>>({});
  const [availableDocuments, setAvailableDocuments] = useState<AvailableDocument[]>([]);
  const [policy, setPolicy] = useState<Awaited<ReturnType<typeof getArchivePrepData>>["policy"] | null>(null);
  const [archiveFolder, setArchiveFolder] = useState<Awaited<ReturnType<typeof getArchivePrepData>>["archiveFolder"]>(null);
  const [supplement, setSupplement] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, { message: string; refreshOnly: boolean }>>({});
  const [closedReason, setClosedReason] = useState<ArchiveClosedReason>("JUDGMENT");
  const [completedAt, setCompletedAt] = useState<string>(shDayKey(new Date()));
  const [judgmentSummary, setJudgmentSummary] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryFromClose, setSummaryFromClose] = useState(false);
  const [forceWithMissing, setForceWithMissing] = useState(false);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingItemRef = useRef<ArchiveChecklistItem | null>(null);
  const prepVersion = useRef(0);

  const refreshPrep = useCallback(async (resetAssignments: boolean, version: number) => {
    const data = await getArchivePrepData(matterId);
    if (version !== prepVersion.current) return;
    setChecklist(data.checklist);
    setPolicy(data.policy);
    setArchiveFolder(data.archiveFolder);
    setSupplement(data.matter.status === "ARCHIVED");
    setAvailableDocuments(data.availableDocuments);
    const preselected = Object.fromEntries(Object.entries(data.docsByItem).map(([itemId, docs]) => [itemId, docs.map((doc) => doc.id)]));
    if (resetAssignments) setAssignments(preselected);
    if (resetAssignments && data.matter.closedAt) {
      // 上海日历日：toISOString 走 UTC，上海 0-8 点会落成前一天
      setCompletedAt(shDayKey(data.matter.closedAt));
    }
    if (resetAssignments && data.existingSummary) {
      setSummary(data.existingSummary);
      setSummaryFromClose(true);
    }
  }, [matterId]);

  useEffect(() => {
    const version = ++prepVersion.current;
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    setSubmitError(null);
    setUploadErrors({});
    setUploadingItemId(null);
    pendingItemRef.current = null;
    setArchiveFolder(null);
    setSupplement(false);
    setSummary("");
    setJudgmentSummary("");
    setCompletedAt(shDayKey(new Date()));
    setSummaryFromClose(false);
    setAssignments({});
    setItemStatuses({});
    setItemNotes({});
    setManualChecks({});
    setManualNotes({});
    setForceWithMissing(false);
    refreshPrep(true, version)
      .catch((err) => {
        if (version === prepVersion.current) setLoadError(actionErrorMessage(err));
      })
      .finally(() => { if (version === prepVersion.current) setLoading(false); });
    return () => { prepVersion.current = version + 1; };
  }, [open, refreshPrep]);

  async function retryPrep() {
    const version = prepVersion.current;
    setLoading(true);
    setLoadError(null);
    try { await refreshPrep(true, version); }
    catch (error) { if (version === prepVersion.current) setLoadError(actionErrorMessage(error)); }
    finally { if (version === prepVersion.current) setLoading(false); }
  }

  function triggerUpload(item: ArchiveChecklistItem) {
    pendingItemRef.current = item;
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重复选同一文件
    const item = pendingItemRef.current;
    pendingItemRef.current = null;
    if (!file || !item) return;
    const version = prepVersion.current;
    if (supplement && !archiveFolder) {
      setUploadErrors((current) => ({ ...current, [item.id]: { message: "本案没有可用的结案或归档卷宗，请先核对卷宗设置", refreshOnly: false } }));
      return;
    }

    setUploadingItemId(item.id);
    setUploadErrors((current) => { const next = { ...current }; delete next[item.id]; return next; });
    try {
      const fd = new FormData();
      fd.set("matterId", matterId);
      fd.set("name", file.name.replace(/\.[^.]+$/, "") || item.label);
      fd.set("category", inferCategory(item.id));
      fd.set("archiveChecklistItemId", item.id);
      if (archiveFolder) fd.set("folderId", archiveFolder.id);
      fd.set("encrypted", "false");
      fd.set("file", file);
      const uploaded = await uploadDocument(fd);
      if (!uploaded.ok) throw new Error(uploaded.message);
      if (version !== prepVersion.current) return;
      setAvailableDocuments((current) => [...current, { id: uploaded.id, name: String(fd.get("name")), category: inferCategory(item.id), mimeType: file.type || null, size: file.size, folderName: archiveFolder?.name ?? null }]);
      setAssignments((current) => ({ ...current, [item.id]: [...new Set([...(current[item.id] ?? []), uploaded.id])] }));
      Notification.success({ title: `已上传：${item.label}`, content: file.name });
      try { await refreshPrep(false, version); }
      catch (error) { if (version === prepVersion.current) setUploadErrors((current) => ({ ...current, [item.id]: { message: `材料已保存，列表刷新失败：${actionErrorMessage(error)}`, refreshOnly: true } })); }
    } catch (err) {
      if (version === prepVersion.current) setUploadErrors((current) => ({ ...current, [item.id]: { message: actionErrorMessage(err), refreshOnly: false } }));
    } finally {
      if (version === prepVersion.current) setUploadingItemId(null);
    }
  }

  async function refreshItem(itemId: string) {
    const version = prepVersion.current;
    try {
      await refreshPrep(false, version);
      if (version === prepVersion.current) setUploadErrors((current) => { const next = { ...current }; delete next[itemId]; return next; });
    } catch (error) {
      if (version === prepVersion.current) setUploadErrors((current) => ({ ...current, [itemId]: { message: `材料已保存，列表刷新失败：${actionErrorMessage(error)}`, refreshOnly: true } }));
    }
  }

  const missingRequired = checklist
    ? checklist.items.filter((i) => !i.autoGenerated && i.required && !(assignments[i.id]?.length > 0))
    : [];

  function handleSubmit() {
    setSubmitError(null);
    if (!summary.trim()) {
      setSubmitError("请填写结案小结");
      return;
    }
    if (missingRequired.length > 0 && !forceWithMissing) {
      setSubmitError(`仍有 ${missingRequired.length} 项必交材料没有关联文件；缺失或不适用时，请逐项说明并申请例外审批`);
      return;
    }
    if (missingRequired.some((item) => !itemNotes[item.id]?.trim())) {
      setSubmitError("请逐项填写必交材料缺项或不适用理由");
      return;
    }
    if (ARCHIVE_MANUAL_CHECKS.some((item) => !manualChecks[item.id])) {
      setSubmitError("请完成全部归档人工核验事项");
      return;
    }
    if (!policy?.configured) {
      setSubmitError("请管理员先在归档制度设置中关联现行制度原文");
      return;
    }
    const version = prepVersion.current;
    startTransition(async () => {
      try {
        const checklistItems = Object.fromEntries((checklist?.items ?? []).filter((item) => !item.autoGenerated).map((item) => {
          const documentIds = assignments[item.id] ?? [];
          return [item.id, {
            status: documentIds.length ? "ATTACHED" as const : itemStatuses[item.id] ?? "MISSING" as const,
            documentIds,
            note: itemNotes[item.id] ?? ""
          }];
        }));
        const result = await archiveMatter({
          matterId,
          summary,
          closedReason,
          completedAt: new Date(completedAt),
          judgmentSummary,
          checklistItems,
          manualChecks: Object.fromEntries(ARCHIVE_MANUAL_CHECKS.map((item) => [item.id, { confirmed: !!manualChecks[item.id], note: manualNotes[item.id] ?? "" }])),
          forceWithMissing
        });
        if (version !== prepVersion.current) return;
        Toast.success(`归档申请已提交（${result.archiveNo}）`);
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        if (version === prepVersion.current) setSubmitError(actionErrorMessage(err));
      }
    });
  }

  return (
    <WorkspaceDialog open={open} onOpenChange={(value) => { if (!isPending && !uploadingItemId) onOpenChange(value); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 aria-hidden size="large" className="text-primary" />
            {supplement ? "补充归档" : "申请归档"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            选择本次送审材料，核对后提交归档申请
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 aria-hidden size="large" className="text-muted-foreground" spin />
          </div>
        ) : loadError ? (
          <Banner type="danger" closeIcon={null} fullMode={false} title={<>加载归档数据失败</>} description={<> <div className="flex flex-wrap items-center justify-between gap-2"><span>{loadError}</span><Button onClick={() => void retryPrep()} htmlType="button" type="tertiary" theme="outline">重试加载</Button></div></>} />
        ) : (
          <div className="max-h-[68dvh] overflow-y-auto overscroll-contain pr-4">
            <div className="space-y-5">
              {/* 结案信息 */}
              <section className="space-y-3">
                <h3 className="text-sm font-medium">结案信息</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label id={"archive-closed-reason" + "-label"} className="text-xs">结案方式 *</label>
                    <Select
                      value={closedReason}
                      onChange={v => { if (typeof v === "string") setClosedReason(v as ArchiveClosedReason); }}
                      id="archive-closed-reason"
                      aria-labelledby={"archive-closed-reason" + "-label"}
                      className="w-full"
                      motion={false}>{(Object.keys(CLOSED_REASON_CN) as ArchiveClosedReason[]).map((k) => (
                          <Select.Option key={k} value={k}>
                            {CLOSED_REASON_CN[k]}
                          </Select.Option>
                        ))}</Select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="archive-completed-at" className="text-xs">结案日期 *</label>
                    <Input
                      id="archive-completed-at"
                      type="date"
                      value={completedAt}
                      onChange={inputValue => setCompletedAt(inputValue)}
                      className="h-9"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="archive-judgment-summary" className="text-xs">裁判结果摘要</label>
                  <TextArea
                    id="archive-judgment-summary"
                    value={judgmentSummary}
                    onChange={inputValue => setJudgmentSummary(inputValue)}
                    placeholder="如：一审判决支持原告诉请，对方未上诉，判决于 2026-04-15 生效"
                    rows={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="archive-summary" className="text-xs">结案小结 *</label>
                    {summaryFromClose && (
                      <span className="inline-flex items-center gap-1 text-xs text-primary">
                        <Sparkles aria-hidden size="small" />
                        已引用结案时填写的小结，可直接编辑
                      </span>
                    )}
                  </div>
                  <TextArea
                    id="archive-summary"
                    value={summary}
                    onChange={inputValue => {
                      setSummary(inputValue);
                      setSummaryFromClose(false);
                    }}
                    placeholder="案件办理过程概述、关键节点、得失复盘等"
                    rows={3}
                  />
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">制度依据</h3>
                {policy?.configured ? (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="flex items-center gap-2 text-sm font-medium"><BookOpenCheck aria-hidden size="default" className="text-primary" />{policy.name} · {policy.version}</p>
                    <p className="mt-1 text-xs text-muted-foreground">生效日期：{policy.effectiveAt}。本次申请会固定制度原文及内容校验值。</p>
                    <a href={`/api/firm-files/${policy.sourceFileId}/download?inline=1`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline">查看制度原文：{policy.sourceFileName}<ExternalLink aria-hidden size="small" /></a>
                  </div>
                ) : (
                  <Banner type="danger" closeIcon={null} fullMode={false} title={<>尚未配置律所归档制度</>} description={<> 系统内置清单不能代替本所制度。请管理员先到“管理后台—归档制度”关联现行制度原文。</>} />
                )}
              </section>

              {checklist && (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{checklist.title}</h3>
                    <span className="text-xs text-muted-foreground">
                      从本案已有材料中选择，或在对应项补传；带 * 为必交
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    aria-label="补传归档材料"
                    className="hidden"
                    onChange={handleFileSelected}
                  />
                  <div className="divide-y divide-border/60 rounded-lg border border-border/60">
                    {checklist.items.map((item) => {
                      const documentIds = assignments[item.id] ?? [];
                      const docs = documentIds.flatMap((id) => {
                        const document = availableDocuments.find((candidate) => candidate.id === id);
                        return document ? [document] : [];
                      });
                      const hasDocs = documentIds.length > 0;
                      const isUploading = uploadingItemId === item.id;
                      return (
                        <div
                          key={item.id}
                          className={`space-y-3 px-3 py-3 ${item.autoGenerated ? "bg-primary/5" : ""}`}
                        >
                          <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm">
                              <span>{item.label}</span>
                              {item.required && <span className="text-destructive">*</span>}
                              {item.autoGenerated && (
                                <span className="inline-flex items-center gap-1 text-xs text-primary">
                                  <Sparkles aria-hidden size="small" />
                                  按本次材料生成
                                </span>
                              )}
                              {hasDocs && !item.autoGenerated && (
                                <span className="inline-flex items-center gap-1 text-xs text-[var(--semi-color-success)]">
                                  <FileCheck aria-hidden size="small" />
                                  已关联 {docs.length} 份
                                </span>
                              )}
                            </div>
                            {item.hint && (
                              <p className="text-xs text-muted-foreground mt-0.5">{item.hint}</p>
                            )}
                          </div>
                          {!item.autoGenerated && (
                            <Button
                              onClick={() => triggerUpload(item)}
                              disabled={Boolean(uploadingItemId) || isPending || (supplement && !archiveFolder)}
                              className="h-8 shrink-0 px-2 text-xs"
                              htmlType="button"
                              type="tertiary" theme="borderless"
                              size="small"
                            >
                              {isUploading ? (
                                <Loader2 aria-hidden size="small" spin />
                              ) : (
                                <>
                                  <Upload aria-hidden size="small" className="mr-1" />
                                  补传材料
                                </>
                              )}
                            </Button>
                          )}
                          </div>
                          {uploadErrors[item.id] && <Banner type="danger" closeIcon={null} fullMode={false} description={<> <div className="flex flex-wrap items-center justify-between gap-2"><span>{uploadErrors[item.id].message}</span>{uploadErrors[item.id].refreshOnly && <Button onClick={() => void refreshItem(item.id)} htmlType="button" type="tertiary" theme="outline" size="small">刷新材料</Button>}</div></>} />}
                          {!item.autoGenerated && <>
                            <div className="text-xs text-muted-foreground"><span>选择本案已有材料</span>
                              <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-md border bg-card p-2" role="group" aria-label={`${item.label}关联材料`}>
                                {availableDocuments.length ? availableDocuments.map((document) => <div key={document.id} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1.5 text-sm text-foreground hover:bg-muted/60"><Checkbox checked={documentIds.includes(document.id)} onChange={({ target: { checked } }) => setAssignments((current) => ({ ...current, [item.id]: checked === true ? [...new Set([...(current[item.id] ?? []), document.id])] : (current[item.id] ?? []).filter((id) => id !== document.id) }))}><span className="min-w-0 flex-1 break-words"><span className="text-xs text-muted-foreground">{document.folderName ?? "散件"} / </span>{document.name}</span></Checkbox></div>) : <p className="py-3 text-center text-xs text-muted-foreground">本案暂无可选材料，请使用“补传材料”。</p>}
                              </div>
                              <span className="mt-1 block">同一文件确有必要时可关联多个清单项。</span>
                            </div>
                            {hasDocs ? <div className="flex flex-wrap gap-2">{docs.map((document) => <a key={document.id} href={`/api/documents/${document.id}/download?inline=1`} target="_blank" rel="noreferrer" className="max-w-full truncate rounded-md bg-muted px-2 py-1 text-xs text-primary underline" title={document.name}>{document.name}</a>)}</div> : <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
                              <> <span className="sr-only" id={selectLabelId + "-2" + "-" + item.id}>{`${item.label}缺项状态`}</span><Select value={itemStatuses[item.id] ?? "MISSING"} onChange={value => { if (typeof value === "string") setItemStatuses((current) => ({ ...current, [item.id]: value as "MISSING" | "NOT_APPLICABLE" })); }} aria-labelledby={selectLabelId + "-2" + "-" + item.id} className="w-full" motion={false}><Select.Option value="MISSING">缺失</Select.Option><Select.Option value="NOT_APPLICABLE">不适用</Select.Option></Select></>
                              <Input aria-label={`${item.label}缺项或不适用说明`} value={itemNotes[item.id] ?? ""} onChange={inputValue => setItemNotes((current) => ({ ...current, [item.id]: inputValue }))} placeholder={item.required ? "必交项缺失或不适用时必须说明理由" : "可填写缺失或不适用说明"} maxLength={1000} />
                            </div>}
                          </>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="space-y-3">
                <div><h3 className="text-sm font-medium">人工核验事项</h3><p className="mt-1 text-xs text-muted-foreground">以下确认由申请人作出，审批人仍须独立复核。</p></div>
                <div className="space-y-2">{ARCHIVE_MANUAL_CHECKS.map((item) => <div key={item.id} className="rounded-lg border p-3"><div className="flex items-start gap-3"><Checkbox checked={!!manualChecks[item.id]} onChange={({ target: { checked } }) => setManualChecks((current) => ({ ...current, [item.id]: checked === true }))}><span className="text-sm">{item.label}</span></Checkbox></div><Input className="mt-2" value={manualNotes[item.id] ?? ""} onChange={inputValue => setManualNotes((current) => ({ ...current, [item.id]: inputValue }))} aria-label={`${item.label}说明`} placeholder="必要时填写核验说明、原件去向或页码状态" maxLength={1000} /></div>)}</div>
              </section>

              {missingRequired.length > 0 && (
                <Banner
                  type="danger"
                  closeIcon={null}
                  fullMode={false}
                  title={<>仍有 {missingRequired.length} 项必交材料没有关联文件</>}
                  description={
                    <div className="space-y-2">
                      <p>缺项：{missingRequired.map(item => item.label).join("、")}</p>
                      <p>请优先选择或补传实际文件。确实无法补齐或不适用时，逐项说明理由并申请例外审批。</p>
                      <Checkbox checked={forceWithMissing} onChange={event => setForceWithMissing(Boolean(event.target.checked))}>
                        申请缺项或不适用例外审批
                      </Checkbox>
                    </div>
                  }
                />
              )}

              {supplement && !archiveFolder && <Banner type="danger" closeIcon={null} fullMode={false} description={<> 本案没有可用的结案或归档卷宗，请先核对卷宗设置后补传材料。</>} />}
            </div>
          </div>
        )}

        {submitError && <Banner type="danger" closeIcon={null} fullMode={false} title={<>尚未提交</>} description={<> {submitError}</>} />}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={isPending || Boolean(uploadingItemId)} type="tertiary" theme="outline">
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || loading || Boolean(loadError) || Boolean(uploadingItemId) || !policy?.configured}
            theme="solid"
          >
            {isPending && <Loader2 aria-hidden size="small" className="mr-1.5" spin />}
            提交归档审批
          </Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  );
}
