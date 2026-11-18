"use client";

import { Button, Input, Notification, Form, Select, Switch, TextArea, Toast } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import type { CustomFieldDef } from "@prisma/client";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  WorkspaceDialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/patterns/workspace-dialog";
import {
  createCustomFieldDef,
  updateCustomFieldDef,
  deleteCustomFieldDef,
  toggleCustomFieldDef
} from "@/server/custom-fields/actions";
import { AdminPageHeader } from "@/components/layout/admin-page-header";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";

const TYPE_LABEL: Record<CustomFieldDef["fieldType"], string> = {
  TEXT: "文本",
  NUMBER: "数字",
  DATE: "日期",
  SELECT: "下拉"
};

export function CustomFieldsView({ matterFields }: { matterFields: CustomFieldDef[] }) {
  const [editing, setEditing] = useState<CustomFieldDef | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  async function handleDelete(id: string, label: string) {
    if (!(await confirmDialog({ title: `删除自定义字段「${label}」？`, description: "已录入的对应值将不再显示。", confirmText: "删除", danger: true }))) return;
    startTransition(async () => {
      try {
        await deleteCustomFieldDef(id);
        Toast.success("已删除");
      } catch (err) {
        Notification.error({ title: "删除失败", content: actionErrorMessage(err) });
      }
    });
  }

  function handleToggle(id: string, enabled: boolean) {
    startTransition(async () => {
      try {
        await toggleCustomFieldDef(id, enabled);
      } catch (err) {
        Notification.error({ title: "操作失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title="自定义字段" sub="为案件添加机构特有的字段，新建/编辑案件详情时填写。" actions={<Button theme="solid" onClick={() => setCreateOpen(true)} size="small"><Plus />添加字段</Button>} />

      <div className="overflow-hidden card">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
              <th className="px-4 py-2 font-medium">字段名称</th>
              <th className="px-4 py-2 font-medium">类型</th>
              <th className="px-4 py-2 font-medium">必填</th>
              <th className="px-4 py-2 font-medium">选项值</th>
              <th className="px-4 py-2 font-medium">启用</th>
              <th className="px-4 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {matterFields.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  还没有自定义字段，点击右上角「添加字段」
                </td>
              </tr>
            ) : (
              matterFields.map((f) => (
                <tr key={f.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-foreground">{f.label}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{TYPE_LABEL[f.fieldType]}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{f.required ? "是" : "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {f.fieldType === "SELECT" && f.options.length > 0
                      ? f.options.join(" / ")
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Switch
                      checked={f.enabled}
                      onChange={(v) => handleToggle(f.id, v)}
                      disabled={pending}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        theme="borderless" type="tertiary"
                        size="small"
                        className="h-7 w-7 p-0"
                        onClick={() => setEditing(f)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        theme="borderless" type="tertiary"
                        size="small"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => handleDelete(f.id, f.label)}
                        disabled={pending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <FieldFormDialog
        key={editing?.id ?? "create"}
        open={createOpen || !!editing}
        field={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function FieldFormDialog({
  open,
  field,
  onClose
}: {
  open: boolean;
  field: CustomFieldDef | null;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(field?.label ?? "");
  const [fieldType, setFieldType] = useState<CustomFieldDef["fieldType"]>(
    field?.fieldType ?? "TEXT"
  );
  const [required, setRequired] = useState(field?.required ?? false);
  const [optionsText, setOptionsText] = useState((field?.options ?? []).join("\n"));
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!label.trim()) {
      Toast.warning("请填写字段名称");
      return;
    }
    const options =
      fieldType === "SELECT"
        ? optionsText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    if (fieldType === "SELECT" && options.length === 0) {
      Toast.warning("下拉类型请至少填写一个选项（每行一个）");
      return;
    }
    startTransition(async () => {
      try {
        if (field) {
          await updateCustomFieldDef({ id: field.id, label, fieldType, required, options });
        } else {
          await createCustomFieldDef({ entityType: "MATTER", label, fieldType, required, options });
        }
        Toast.success(field ? "已更新" : "已添加");
        onClose();
      } catch (err) {
        Notification.error({ title: "保存失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <WorkspaceDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{field ? "编辑字段" : "添加字段"}</DialogTitle>
          <DialogDescription>字段将出现在案件详情的「自定义信息」中。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Form.Label name="custom-field-name" required>字段名称</Form.Label>
            <Input id="custom-field-name" disabled={pending} value={label} onChange={setLabel} placeholder="如：内部承办编号" />
          </div>
          <div className="space-y-1">
            <Form.Label id="custom-field-type-label">字段类型</Form.Label>
            <Select
              aria-labelledby="custom-field-type-label"
              disabled={pending}
              className="w-full"
              value={fieldType}
              onChange={(v) => setFieldType(v as CustomFieldDef["fieldType"])}
            >
                <Select.Option value="TEXT">文本</Select.Option>
                <Select.Option value="NUMBER">数字</Select.Option>
                <Select.Option value="DATE">日期</Select.Option>
                <Select.Option value="SELECT">下拉</Select.Option>
              </Select>
          </div>
          {fieldType === "SELECT" && (
            <div className="space-y-1">
              <Form.Label name="custom-field-options" required>选项值（每行一个）</Form.Label>
              <TextArea
                id="custom-field-options"
                disabled={pending}
                value={optionsText}
                onChange={setOptionsText}
                rows={4}
                placeholder={"选项一\n选项二"}
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch aria-label="必填字段" disabled={pending} checked={required} onChange={setRequired} />
            必填
          </label>
        </div>

        <DialogFooter>
          <Button theme="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button theme="solid" onClick={submit} loading={pending} disabled={pending}>
            {field ? "保存" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  );
}
