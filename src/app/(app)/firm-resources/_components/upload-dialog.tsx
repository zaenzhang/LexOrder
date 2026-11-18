"use client";

import { FormDialogContent as DialogContent, FormDialogBody } from "@/components/patterns/form-dialog";

import { useId, useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Notification, Select, TextArea, Toast } from "@douyinfe/semi-ui";
import { FileInput } from "@/components/patterns/file-input";
import type { FirmFileCategory } from "@prisma/client";
import {
  WorkspaceDialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/patterns/workspace-dialog";
import { uploadFirmFile } from "@/server/firm-files/actions";
import { actionErrorMessage } from "@/lib/action-error";

const CATEGORY_OPTIONS: { value: FirmFileCategory; label: string }[] = [
  { value: "CONTRACT", label: "合同" },
  { value: "LETTER", label: "函件" },
  { value: "LICENSE", label: "证照" },
  { value: "OTHER_FIRM", label: "其他" },
  { value: "POLICY", label: "制度" },
  { value: "GUIDE", label: "指引" },
  { value: "TEMPLATE", label: "参考模板" },
  { value: "REFERENCE", label: "其他文件" }
];

const NONE_VALUE = "__none__";

type ExistingFile = {
  id: string;
  name: string;
  hasNewerVersion: boolean;
};

export function UploadDialog({
  open,
  onOpenChange,
  existingFiles
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingFiles: ExistingFile[];
}) {
  const router = useRouter();
  const fieldId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const openSelect = useRef<"category" | "supersedes" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<FirmFileCategory>("CONTRACT");
  const [tags, setTags] = useState("");
  const [supersedesId, setSupersedesId] = useState<string>(NONE_VALUE);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setFile(null);
    setName("");
    setDescription("");
    setCategory("CONTRACT");
    setTags("");
    setSupersedesId(NONE_VALUE);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleFilePick(f: File | null) {
    setFile(f);
    if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
  }

  function submit() {
    if (isPending) return;
    if (!file) {
      Toast.warning("请选择文件");
      return;
    }
    if (!name.trim()) {
      Toast.warning("名称必填");
      return;
    }
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("name", name.trim());
        fd.set("description", description.trim());
        fd.set("category", category);
        fd.set("tags", tags);
        if (supersedesId !== NONE_VALUE) fd.set("supersedesId", supersedesId);
        const res = await uploadFirmFile(fd);
        Toast.success(supersedesId !== NONE_VALUE
            ? `已上传并替代旧版：${res.name}`
            : `已上传：${res.name}`);
        reset();
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        Notification.error({ title: "上传失败", content: actionErrorMessage(err), duration: 6 });
      }
    });
  }

  const replaceableFiles = existingFiles.filter(file => !file.hasNewerVersion);
  const selectPopupProps = {
    disabled: isPending,
    className: "w-full",
    motion: false as const,
    getPopupContainer: () => dialog.current!
  };

  function trackSelect(field: "category" | "supersedes", visible: boolean) {
    if (visible || openSelect.current === field) openSelect.current = visible ? field : null;
  }

  return (
    <WorkspaceDialog open={open} onOpenChange={next => { if (!isPending) onOpenChange(next); }}>
      <DialogContent ref={dialog} className="max-w-lg" onEscapeKeyDown={event => { if (openSelect.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>上传律所资料</DialogTitle>
          <DialogDescription>全所共享 · 单文件不超过 50 MB</DialogDescription>
        </DialogHeader>
        <FormDialogBody>
          <fieldset className="space-y-4" disabled={isPending}>
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-file`} className="block text-sm font-medium">文件</label>
              <FileInput id={`${fieldId}-file`} ref={fileRef} disabled={isPending} aria-required
                onChange={event => handleFilePick(event.currentTarget.files?.[0] ?? null)} />
            </div>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
              <div className="space-y-1.5">
                <label htmlFor={`${fieldId}-name`} className="block text-sm font-medium">名称</label>
                <Input id={`${fieldId}-name`} value={name} onChange={setName} aria-required />
              </div>
              <div className="space-y-1.5">
                <label id={`${fieldId}-category-label`} htmlFor={`${fieldId}-category`} className="block text-sm font-medium">分类</label>
                <Select<FirmFileCategory> {...selectPopupProps} id={`${fieldId}-category`}
                  aria-labelledby={`${fieldId}-category-label`} value={category} optionList={CATEGORY_OPTIONS}
                  onChange={value => { if (typeof value === "string") setCategory(value); }} onDropdownVisibleChange={value => trackSelect("category", value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-description`} className="block text-sm font-medium">描述</label>
              <TextArea id={`${fieldId}-description`} value={description} onChange={setDescription} rows={2} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-tags`} className="block text-sm font-medium">标签</label>
              <Input id={`${fieldId}-tags`} value={tags} onChange={setTags} placeholder="用逗号或空格分隔" />
            </div>
            {replaceableFiles.length > 0 && (
              <div className="space-y-1.5">
                <label id={`${fieldId}-supersedes-label`} htmlFor={`${fieldId}-supersedes`} className="block text-sm font-medium">版本关系</label>
                <Select<string> {...selectPopupProps} id={`${fieldId}-supersedes`} aria-labelledby={`${fieldId}-supersedes-label`}
                  value={supersedesId} filter
                  onChange={value => { if (typeof value === "string") setSupersedesId(value); }} onDropdownVisibleChange={value => trackSelect("supersedes", value)}
                  optionList={[{ value: NONE_VALUE, label: "新增资料" }, ...replaceableFiles.map(file => ({ value: file.id, label: `替代 ${file.name}` }))]} />
              </div>
            )}
          </fieldset>
        </FormDialogBody>
        <DialogFooter>
          <Button theme="light" type="tertiary" onClick={() => onOpenChange(false)} disabled={isPending}>取消</Button>
          <Button theme="solid" loading={isPending} onClick={submit} disabled={!file || !name.trim()}>上传</Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  );
}
