"use client";

import { Table, Empty, Button, Input, Notification, Form, Select, Switch, TextArea, Toast } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import type { CustomFieldDef } from "@prisma/client";
import { IconPlus as Plus, IconEdit as Pencil, IconDelete as Trash2 } from "@douyinfe/semi-icons";
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
      <AdminPageHeader title="自定义字段" sub="为案件添加机构特有的字段，新建/编辑案件详情时填写。" actions={<Button theme="solid" onClick={() => setCreateOpen(true)} size="small"><Plus aria-hidden />添加字段</Button>} />

      <div className="overflow-hidden card">
        <Table<(typeof matterFields)[number]>
          pagination={false}
          rowKey="id"
          dataSource={matterFields}
          empty={<Empty description={"还没有自定义字段，点击右上角「添加字段」"} />}
          columns={[
            { title: "字段名称", dataIndex: "label" },
            { title: "类型", key: "column2", render: (_, f) => <span className="text-muted-foreground">{TYPE_LABEL[f.fieldType]}</span> },
            { title: "必填", key: "column3", render: (_, f) => <span className="text-muted-foreground">{f.required ? "是" : "—"}</span> },
            { title: "选项值", key: "column4", render: (_, f) => <span className="text-muted-foreground">{f.fieldType === "SELECT" && f.options.length > 0
                      ? f.options.join(" / ")
                      : "—"}</span> },
            { title: "启用", key: "column5", render: (_, f) => <Switch
                      checked={f.enabled}
                      onChange={(v) => handleToggle(f.id, v)}
                      disabled={pending}
                    /> },
            { title: "操作", align: "right", key: "column6", render: (_, f) => <div className="flex items-center justify-end gap-1">
                      <Button
                        theme="borderless" type="tertiary"
                        size="small"
                        className="h-7 w-7 p-0"
                        onClick={() => setEditing(f)}
                      >
                        <Pencil aria-hidden size="small" />
                      </Button>
                      <Button
                        theme="borderless" type="tertiary"
                        size="small"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => handleDelete(f.id, f.label)}
                        disabled={pending}
                      >
                        <Trash2 aria-hidden size="small" />
                      </Button>
                    </div> },
          ]}
        />
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
