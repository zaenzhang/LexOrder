"use client";

import { Select, Button, Checkbox, Input, RadioGroup, TextArea, Notification, Toast } from "@douyinfe/semi-ui";
import { FormDialogContent as DialogContent, FormDialogBody, FormSection } from "@/components/patterns/form-dialog";

import { useRef, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { confirmDiscardChanges } from "@/components/patterns/confirm-dialog";
import { FileInput } from "@/components/patterns/file-input";
import { IconLoading as Loader2, IconLink as Link2 } from "@douyinfe/semi-icons";
import {
  WorkspaceDialog,
  DialogFooter,
  DialogHeader,
  DialogDescription,
  DialogTitle
} from "@/components/patterns/workspace-dialog";

import { listActiveSealPurposes } from "@/server/approval-permissions/actions";
import { createSealRequest } from "@/server/seals/actions";
import {
  type SealTypeConfigRow,
  type MatterOption,
  SEAL_TYPE_CN
} from "./seal-types";
import { MatterCombobox } from "./matter-combobox";
import { actionErrorMessage } from "@/lib/action-error";

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function SealRequestSheet({
  open,
  onOpenChange,
  configs,
  matters,
  preset,
  onSubmitted
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  configs: SealTypeConfigRow[];
  matters: MatterOption[];
  onSubmitted?: (id: string) => void;
  preset: {
    draftDocId?: string;
    matterId?: string;
    documentTitle?: string;
  } | null;
}) {
  const [purposeConfigId, setPurposeConfigId] = useState("");
  const [purposes, setPurposes] = useState<Awaited<ReturnType<typeof listActiveSealPurposes>>>([]);
  useEffect(() => { if (open) listActiveSealPurposes().then(setPurposes).catch(() => Notification.error({ title: "无法读取用章事项，请重新打开申请", duration: 6 })); }, [open]);
  const popupContainer = useRef<HTMLDivElement>(null);
  const openDropdown = useRef(false);
  const confirmingClose = useRef(false);
  const [sealType, setSealType] = useState<string>("");
  const [matterId, setMatterId] = useState(preset?.matterId ?? "");
  /** 本次用印说明：一句话，说明这次为什么盖章；分类由上方「用章事项」承担（2026-09-19 去重） */
  const [purpose, setPurpose] = useState("");
  const [documentTitle, setDocumentTitle] = useState(preset?.documentTitle ?? "");
  const [pageCount, setPageCount] = useState(1);
  const [crossPage, setCrossPage] = useState(false);
  const [copies, setCopies] = useState(1);
  const [urgency, setUrgency] = useState<"NORMAL" | "URGENT">("NORMAL");
  const [requestNote, setRequestNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [alsoLegalRep, setAlsoLegalRep] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // 卷宗联动预填
  useEffect(() => {
    if (preset?.matterId) setMatterId(preset.matterId);
    if (preset?.documentTitle) setDocumentTitle(preset.documentTitle);
  }, [preset?.matterId, preset?.documentTitle]);

  const reset = () => {
    setSealType("");
    setPurposeConfigId("");
    setMatterId(preset?.matterId ?? "");
    setPurpose("");
    setDocumentTitle(preset?.documentTitle ?? "");
    setPageCount(1);
    setCrossPage(false);
    setCopies(1);
    setUrgency("NORMAL");
    setRequestNote("");
    setFile(null);
    setAlsoLegalRep(false);
  };

  const enabledConfigs = configs.filter((c) => c.enabled);
  const hasExisting = !!preset?.draftDocId;

  const submit = () => {
    if (!sealType) {
      Notification.error({ title: "请选择章种类", duration: 6 });
      return;
    }
    // 事项决定审批路由与可用印章，服务端无条件必填；提前拦截避免填完全表才在提交时报错
    if (!purposeConfigId) {
      Notification.error({ title: purposes.length ? "请选择用章事项" : "管理员尚未配置用章事项，请联系管理员在管理后台配置后再提交", duration: 6 });
      return;
    }
    if (!purpose.trim()) {
      Notification.error({ title: "请填写本次用印说明", duration: 6 });
      return;
    }
    if (purpose.length > 60) {
      Notification.error({ title: "本次用印说明限 60 字", duration: 6 });
      return;
    }
    if (!documentTitle.trim()) {
      Notification.error({ title: "请填写文件标题", duration: 6 });
      return;
    }
    if (!hasExisting && !file) {
      Notification.error({ title: "请上传待盖章稿", duration: 6 });
      return;
    }
    if (!hasExisting && file && !isPdfFile(file)) {
      Notification.error({ title: "需上传 pdf 格式文件", duration: 6 });
      return;
    }

    const fd = new FormData();
    fd.set("sealType", sealType);
    if (purposeConfigId) fd.set("purposeConfigId", purposeConfigId);
    if (matterId) fd.set("matterId", matterId);
    fd.set("purpose", purpose.trim());
    fd.set("documentTitle", documentTitle.trim());
    fd.set("pageCount", String(pageCount));
    fd.set("requireCrossPageSeal", String(crossPage));
    fd.set("copies", String(copies));
    fd.set("urgency", urgency);
    fd.set("requestNote", requestNote.trim());
    if (alsoLegalRep && sealType !== "LEGAL_REP_SEAL") {
      fd.set("alsoLegalRep", "true");
    }
    if (hasExisting && preset?.draftDocId) {
      fd.set("existingDraftDocId", preset.draftDocId);
    } else if (file) {
      fd.set("draftDoc", file);
    }

    startTransition(async () => {
      try {
        const res = await createSealRequest(fd);
        Toast.success(`已提交 ${res.code}${alsoLegalRep && sealType !== "LEGAL_REP_SEAL" ? "（含法人章配套申请）" : ""}`);
        reset();
        onOpenChange(false);
        if (onSubmitted) onSubmitted(res.id); else router.refresh();
      } catch (e) {
        Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "提交失败", duration: 6 });
      }
    });
  };

  async function close() {
    if (pending || confirmingClose.current) return;
    const dirty = sealType || purposeConfigId || matterId !== (preset?.matterId ?? "") || purpose
      || documentTitle !== (preset?.documentTitle ?? "") || pageCount !== 1 || crossPage
      || copies !== 1 || urgency !== "NORMAL" || requestNote || file || alsoLegalRep;
    if (dirty) {
      confirmingClose.current = true;
      try {
        if (!await confirmDiscardChanges()) return;
      } finally {
        confirmingClose.current = false;
      }
    }
    reset();
    onOpenChange(false);
  }

  return (
    <WorkspaceDialog open={open} dismissOnBackdrop onOpenChange={value => { if (!value) void close(); }}>
      <DialogContent ref={popupContainer} showClose={!pending} className="max-w-3xl" onEscapeKeyDown={event => { if (pending || openDropdown.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>新建用章申请</DialogTitle>
          <DialogDescription>填写用印事项并核对待盖章文件，提交后可在审批工作台跟进。</DialogDescription>
        </DialogHeader>
        <FormDialogBody>

        <div className="space-y-6">
        <FormSection title="用章信息" description="选择印章、关联案件与事项，并说明本次用印">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* 联动提示 */}
          {hasExisting && (
            <div
              className="ll-surface flex items-start gap-2 rounded p-2.5 text-xs md:col-span-2"

            >
              <Link2 aria-hidden size="small" className="mt-0.5 text-primary" />
              <div>
                <p className="text-foreground">已关联卷宗文档作为待盖章稿</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {preset?.documentTitle}
                </p>
              </div>
            </div>
          )}

          <div className="md:col-span-2">
            <label className="text-xs">章种类 *</label>
            <RadioGroup disabled={pending}
              className="mt-2"
              options={enabledConfigs.map((c) => ({
                value: c.type as string,
                label: SEAL_TYPE_CN[c.type] ?? c.type,
                description: c.description ?? undefined
              }))}
              value={sealType}
              onChange={event => ((v) => {
                setSealType(v);
                // 事项与章型必须适配：切换章型后当前事项若不再允许，原生 select 会显示空白但 state 仍留旧值，提交才报错
                setPurposeConfigId((cur) => {
                  if (!cur) return cur;
                  const curPurpose = purposes.find((p) => p.id === cur);
                  return curPurpose && curPurpose.allowedSealTypes.some((t) => t === v) ? cur : "";
                });
              })(String(event.target.value))} type="button"
            />
            {sealType && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {enabledConfigs.find((c) => c.type === sealType)?.description}
              </p>
            )}
            {sealType && sealType !== "LEGAL_REP_SEAL" && (
              <Checkbox disabled={pending} checked={alsoLegalRep} onChange={event => ((v) => setAlsoLegalRep(v === true))(event.target.checked === true)} className="mt-2">

                <span>同时加盖 <strong className="text-foreground">法定代表人章</strong></span>
                <span className="text-xs text-muted-foreground">
                  会自动建一条配套的法人章审批，与本章并行
                </span>
              </Checkbox>
            )}
          </div>

          <div>
            <label className="text-xs">关联案件 (可选)</label>
            <div className="mt-1">
              {preset?.matterId ? (
                // 从案件详情页发起时，case 已锁定，不展示可切换的下拉
                <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 text-xs">
                  <span className="text-xs text-muted-foreground">已关联</span>
                  <span className="truncate">
                    {matters.find((m) => m.id === preset.matterId)?.title ?? "当前案件"}
                  </span>
                </div>
              ) : (
                <MatterCombobox disabled={pending} onDropdownVisibleChange={visible => { openDropdown.current = visible; }}
                  matters={matters}
                  value={matterId}
                  onChange={setMatterId}
                  placeholder="不关联案件"
                />
              )}
            </div>
          </div>

          <div className="md:col-span-2">
            <label id="seal-purpose-config-label" className="block text-xs">用章事项</label>
              <Select<string> aria-labelledby="seal-purpose-config-label" disabled={pending} getPopupContainer={() => popupContainer.current!} onDropdownVisibleChange={visible => { openDropdown.current = visible; }} value={purposeConfigId} onChange={value => (e => setPurposeConfigId(e))(String(value ?? ""))} className="my-2" style={{ width: "100%" }} motion={false}>
                <Select.Option value="">请选择</Select.Option>{purposes.filter(p => !sealType || p.allowedSealTypes.some(t => t === sealType)).map(p => <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>)}
              </Select>
            {!purposes.length && <p className="mb-2 text-xs text-muted-foreground">管理员尚未配置用章事项：事项为必选项，未配置前无法提交用章申请，请联系管理员在管理后台配置。</p>}
            <label className="text-xs" htmlFor="seal-purpose">本次用印说明 *</label>
            <Input disabled={pending}
              id="seal-purpose"
              className="mt-2"
              maxLength={60}
              value={purpose}
              onChange={(e) => setPurpose(e)}
              placeholder="一句话说明这次为什么盖章，如：向华东置业发送催告履行律师函"
            />
          </div>

        </div></FormSection>
        <FormSection title="文件信息" description="核对文件名称、数量与盖章要求">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="text-xs">文件标题 *</label>
            <Input disabled={pending}
              value={documentTitle}
              onChange={(e) => setDocumentTitle(e)}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs">页数</label>
              <Input disabled={pending}
                type="number"
                min={1}
                value={pageCount}
                onChange={(e) => setPageCount(Math.max(1, parseInt(e) || 1))}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs">份数</label>
              <Input disabled={pending}
                type="number"
                min={1}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, parseInt(e) || 1))}
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex items-center justify-between md:col-span-2">
            <Checkbox disabled={pending} checked={crossPage} onChange={event => ((v) => setCrossPage(v === true))(event.target.checked === true)} className="flex items-center gap-2 text-xs">

              需要骑缝章
            </Checkbox>
            <RadioGroup disabled={pending}
              buttonSize="small"
              options={[
                { value: "NORMAL", label: "普通" },
                { value: "URGENT", label: "紧急" }
              ]}
              value={urgency}
              onChange={event => ((v) => setUrgency(v as "NORMAL" | "URGENT"))(String(event.target.value))} type="button"
            />
          </div>

        </div></FormSection>
        <FormSection title="材料与说明">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="text-xs">备注</label>
            <TextArea disabled={pending}
              value={requestNote}
              onChange={(e) => setRequestNote(e)}
              rows={2}
              className="mt-1 text-xs"
            />
          </div>

          {!hasExisting && (
            <div className="md:col-span-2">
              <label className="text-xs">待盖章稿 *</label>
              <div className="mt-1">
                <FileInput aria-label="待盖章稿" disabled={pending}
                    accept="application/pdf,.pdf"
                    onChange={e => {
                      const picked = e.target.files?.[0] ?? null;
                      if (picked && !isPdfFile(picked)) {
                        Notification.error({ title: "需上传 pdf 格式文件", duration: 6 });
                        e.target.value = "";
                        setFile(null);
                        return;
                      }
                      setFile(picked);
                    }}
                  />
              </div>
            </div>
          )}
        </div></FormSection>
        </div>
        </FormDialogBody>
        <DialogFooter className="mt-6">
          <Button theme="outline" type="tertiary" disabled={pending} onClick={() => void close()} htmlType="button">
            取消
          </Button>
          <Button onClick={submit} disabled={pending} theme="solid" type="primary" htmlType="button">
            {pending && <Loader2 aria-hidden size="small" className="mr-1" spin />}
            提交申请
          </Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  );
}
