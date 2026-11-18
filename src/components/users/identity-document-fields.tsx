"use client";

import { FormField as Field } from "@/components/patterns/form-dialog";

import { useId, useTransition } from "react";
import { IconScan as ScanLine } from "@douyinfe/semi-icons";
import { Button, Input, Notification, Select, Toast } from "@douyinfe/semi-ui";
import {
  identityDocumentTypeLabel,
  identityDocumentTypes,
  type IdentityDocumentTypeValue
} from "@/lib/identity-documents";
import { getIdentityRecognitionConfig, recognizeIdentityDocument } from "@/server/identity-documents/recognition";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { IdentityPhotoField } from "@/components/users/identity-photo-field";
import { actionErrorMessage } from "@/lib/action-error";

export type IdentityDocumentDraft = {
  documentType: IdentityDocumentTypeValue;
  documentName: string;
  documentNumber: string;
  primaryFile: File | null;
  secondaryFile: File | null;
};

export function IdentityDocumentFields({
  value,
  disabled,
  errors,
  onChange,
  onRecognizedName
}: {
  value: IdentityDocumentDraft;
  disabled?: boolean;
  errors?: Partial<Record<"documentType" | "documentName" | "documentNumber" | "primaryFile", string>>;
  onChange: (next: IdentityDocumentDraft) => void;
  onRecognizedName: (name: string) => void;
}) {
  const [recognizing, startRecognition] = useTransition();
  const prefix = useId();
  const busy = disabled || recognizing;
  const portraitLike = ["PRC_RESIDENT_ID", "HK_MACAO_TAIWAN_RESIDENCE_PERMIT", "FOREIGN_PERMANENT_RESIDENT_ID"].includes(value.documentType);
  const primaryLabel = portraitLike ? "人像面照片" : "个人资料页照片";
  const secondaryLabel = portraitLike ? "另一面照片（选填）" : "补充页照片（选填）";

  function recognize() {
    if (!value.primaryFile) {
      Toast.warning("请先选择主要证件照片");
      return;
    }
    startRecognition(async () => {
      try {
        const config = await getIdentityRecognitionConfig();
        if (!config.configured) {
          Toast.warning("视觉识别服务尚未配置，请手工录入");
          return;
        }
        const remoteConsent = config.local || (await confirmDialog({ title: "发送证件照片识别？", description: `证件照片将发送至 ${config.host} 进行本次识别。`, confirmText: "继续识别" }));
        if (!remoteConsent) return;
        const formData = new FormData();
        formData.set("file", value.primaryFile!);
        formData.set("selectedType", value.documentType);
        formData.set("remoteConsent", String(remoteConsent));
        const result = await recognizeIdentityDocument(formData);
        if (!result.ok) {
          Toast.error(result.message);
          return;
        }
        const recognizedType = result.data.documentType && result.data.documentType !== "UNKNOWN" ? result.data.documentType : value.documentType;
        onChange({
          ...value,
          documentType: recognizedType,
          documentName: recognizedType === "OTHER" ? value.documentName : "",
          documentNumber: result.data.documentNumber || value.documentNumber
        });
        if (result.data.name) onRecognizedName(result.data.name);
        Notification.success({ title: "识别结果已填入，请对照原件核对", content: `识别置信度：${result.data.confidence === "HIGH" ? "较高" : result.data.confidence === "MEDIUM" ? "中等" : "较低"}` });
      } catch (error) {
        Toast.error(error instanceof Error ? actionErrorMessage(error) : "识别失败，请手工录入");
      }
    });
  }

  return <section className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
    <div>
      <h3 className="text-sm font-semibold">身份证件</h3>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field labelId={`${prefix}-type-label`} label="证件类型" required error={errors?.documentType}>
        <Select aria-labelledby={`${prefix}-type-label`} disabled={busy} value={value.documentType}
          onChange={documentType => onChange({ ...value, documentType: documentType as IdentityDocumentTypeValue, documentName: documentType === "OTHER" ? value.documentName : "" })}>{identityDocumentTypes.map(type => <Select.Option key={type} value={type} showTick={false}>{identityDocumentTypeLabel[type]}</Select.Option>)}</Select>
      </Field>
      {value.documentType === "OTHER" && <Field id={`${prefix}-name`} label="证件名称" required error={errors?.documentName}>
        <Input id={`${prefix}-name`} disabled={busy} maxLength={60} value={value.documentName} onChange={documentName => onChange({ ...value, documentName })} placeholder="请输入证件全称" />
      </Field>}
      <Field id={`${prefix}-number`} label="证件号码" required error={errors?.documentNumber}>
        <Input id={`${prefix}-number`} disabled={busy} autoComplete="off" spellCheck={false} maxLength={50} className="font-mono uppercase" value={value.documentNumber} onChange={documentNumber => onChange({ ...value, documentNumber })} placeholder={value.documentType === "PRC_RESIDENT_ID" ? "请输入18位居民身份证号码" : "请输入证件号码"} />
      </Field>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <IdentityPhotoField label={`${primaryLabel}（选填）`} file={value.primaryFile} disabled={busy} error={errors?.primaryFile} preview onChange={primaryFile => onChange({ ...value, primaryFile })} />
      <IdentityPhotoField label={secondaryLabel} file={value.secondaryFile} disabled={busy} preview onChange={secondaryFile => onChange({ ...value, secondaryFile })} />
    </div>
    <p className="-mt-1 text-xs text-muted-foreground">
      支持 JPG、PNG 或 WebP，单张不超过 10 MB。照片也可稍后在「资料 → 身份证件」补充。
    </p>
    <div className="flex flex-wrap items-center gap-3">
      <Button htmlType="button" theme="outline" size="small" disabled={disabled || recognizing || !value.primaryFile} onClick={recognize} loading={recognizing} icon={<ScanLine size="default" aria-hidden />}>
        {recognizing ? "正在识别" : "自动识别"}
      </Button>
      <p className="text-xs text-muted-foreground">识别结果需核对原件。非本地识别需确认后发送。</p>
    </div>
  </section>;
}
