"use client";

import { Button, Toast } from "@douyinfe/semi-ui";
import { IconImage as ImagePlus, IconClose as X } from "@douyinfe/semi-icons";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { IDENTITY_IMAGE_MAX_BYTES, IDENTITY_IMAGE_MIME_TYPES } from "@/lib/identity-documents";

const acceptedImageTypes = IDENTITY_IMAGE_MIME_TYPES.join(",");

export function IdentityPhotoField({ label, file, disabled, error, preview, onChange }: {
  label: string;
  file: File | null;
  disabled?: boolean;
  error?: string;
  preview?: boolean;
  onChange: (file: File | null) => void;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const statusId = `${id}-status`;
  const pickerId = `${id}-picker`;
  const input = useRef<HTMLInputElement>(null);
  const choose = file ? "更换" : "选择";

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!selected) return;

    if (!IDENTITY_IMAGE_MIME_TYPES.some(type => type === selected.type)) {
      Toast.error("证件照片仅支持 JPG、PNG 或 WebP");
      return;
    }
    if (!selected.size || selected.size > IDENTITY_IMAGE_MAX_BYTES) {
      Toast.error(selected.size ? "单张证件照片不能超过10MB" : "证件照片不能为空");
      return;
    }
    onChange(selected);
  }

  return <div role="group" aria-labelledby={labelId} className="min-w-0 space-y-2">
    <div id={labelId} className="text-sm font-medium">{label}</div>
    <input ref={input} type="file" accept={acceptedImageTypes} disabled={disabled} hidden onChange={pickFile} />
    {file && preview && <PhotoPreview file={file} />}
    {file && <div id={statusId} role="status" className="truncate text-xs text-muted-foreground" title={file.name}>{file.name}</div>}
    <div className="flex flex-wrap items-center gap-1">
      <Button
        id={pickerId}
        htmlType="button"
        theme="outline"
        size="small"
        disabled={disabled}
        aria-label={`${choose}${label}`}
        aria-describedby={file ? statusId : undefined}
        icon={<ImagePlus size="default" aria-hidden />}
        onClick={() => input.current?.click()}
      >
        {choose}照片
      </Button>
      {file && <Button
        htmlType="button"
        theme="borderless"
        type="tertiary"
        size="small"
        disabled={disabled}
        aria-label={`移除${label}`}
        icon={<X size="default" aria-hidden />}
        onClick={() => {
          document.getElementById(pickerId)?.focus();
          onChange(null);
        }}
      />}
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}

function PhotoPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url ? <Image unoptimized src={url} alt="待上传证件照片预览" width={480} height={224} className="h-28 w-full rounded-md bg-muted object-contain" /> : null;
}
