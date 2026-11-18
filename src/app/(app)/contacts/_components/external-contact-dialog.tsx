"use client";

import { FormDialogContent as DialogContent, FormDialogBody } from "@/components/patterns/form-dialog";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ExternalContactCategory } from "@prisma/client";
import { Button, Input, Select, TextArea } from "@douyinfe/semi-ui";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  createExternalContact,
  updateExternalContact
} from "@/server/external-contacts/actions";
import { actionErrorMessage } from "@/lib/action-error";
import type { RuntimeMode } from "@/lib/runtime/mode";

const CATEGORY_OPTIONS: { value: ExternalContactCategory; label: string }[] = [
  { value: "COURT", label: "法院" },
  { value: "PROSECUTOR", label: "检察院" },
  { value: "POLICE", label: "公安" },
  { value: "NOTARY", label: "公证处" },
  { value: "ARBITRATION", label: "仲裁" },
  { value: "OTHER_FIRM", label: "他所律师" },
  { value: "EXPERT", label: "鉴定专家" },
  { value: "OTHER", label: "其他" }
];

type Editing = {
  id: string;
  name: string;
  category: ExternalContactCategory;
  organization: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
} | null;

export function ExternalContactDialog({
  open,
  onOpenChange,
  editing,
  runtimeMode = "SERVER"
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Editing;
  runtimeMode?: RuntimeMode;
}) {
  const router = useRouter();
  const formId = useId();
  const dialogContent = useRef<HTMLDivElement>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "COURT" as ExternalContactCategory,
    organization: "",
    title: "",
    phone: "",
    email: "",
    wechat: "",
    address: "",
    notes: ""
  });
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) setCategoryOpen(false);
    if (open) {
      if (editing) {
        setForm({
          name: editing.name,
          category: editing.category,
          organization: editing.organization ?? "",
          title: editing.title ?? "",
          phone: editing.phone ?? "",
          email: editing.email ?? "",
          wechat: editing.wechat ?? "",
          address: editing.address ?? "",
          notes: editing.notes ?? ""
        });
      } else {
        setForm({
          name: "",
          category: "COURT",
          organization: "",
          title: "",
          phone: "",
          email: "",
          wechat: "",
          address: "",
          notes: ""
        });
      }
    }
  }, [open, editing]);

  function handleSave() {
    if (isPending) return;
    if (!form.name.trim()) {
      toast.error("姓名必填");
      return;
    }
    startTransition(async () => {
      try {
        const payload = { ...form, tags: editing?.tags ?? [] };
        if (editing) {
          await updateExternalContact({ ...payload, id: editing.id });
          toast.success("已更新");
        } else {
          const created = await createExternalContact(payload);
          toast.success(
            created.status === "PENDING_REVIEW"
              ? runtimeMode === "PERSONAL" ? "已保存，待本人确认" : "已提交审核，管理员通过后展示"
              : "已添加"
          );
        }
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error("保存失败", {
          description: actionErrorMessage(err)
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!isPending) onOpenChange(value); }}>
      <DialogContent ref={dialogContent} className="sm:max-w-lg" onEscapeKeyDown={(event) => { if (categoryOpen) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑联系人" : "新增外部联系人"}</DialogTitle>
        </DialogHeader>
        <FormDialogBody>

        <fieldset disabled={isPending} className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor={`${formId}-name`} className="text-xs">姓名 *</label>
              <Input
                id={`${formId}-name`}
                value={form.name}
                onChange={(name) => setForm({ ...form, name })}
              />
            </div>
            <div className="space-y-1.5">
              <label id={`${formId}-category-label`} htmlFor={`${formId}-category`} className="text-xs">类别 *</label>
              <Select
                id={`${formId}-category`}
                aria-labelledby={`${formId}-category-label`}
                aria-required
                value={form.category}
                onChange={(v) =>
                  setForm({ ...form, category: v as ExternalContactCategory })
                }
                optionList={CATEGORY_OPTIONS}
                disabled={isPending}
                style={{ width: "100%" }}
                motion={false}
                onDropdownVisibleChange={setCategoryOpen}
                getPopupContainer={() => dialogContent.current ?? document.body}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor={`${formId}-organization`} className="text-xs">单位 / 机构</label>
              <Input
                id={`${formId}-organization`}
                value={form.organization}
                onChange={(organization) => setForm({ ...form, organization })}
                placeholder="如：上海市浦东新区人民法院"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${formId}-title`} className="text-xs">职务 / 庭室</label>
              <Input
                id={`${formId}-title`}
                value={form.title}
                onChange={(title) => setForm({ ...form, title })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor={`${formId}-phone`} className="text-xs">手机</label>
              <Input
                id={`${formId}-phone`}
                value={form.phone}
                onChange={(phone) => setForm({ ...form, phone })}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${formId}-email`} className="text-xs">邮箱</label>
              <Input
                id={`${formId}-email`}
                type="email"
                value={form.email}
                onChange={(email) => setForm({ ...form, email })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor={`${formId}-wechat`} className="text-xs">微信</label>
              <Input
                id={`${formId}-wechat`}
                value={form.wechat}
                onChange={(wechat) => setForm({ ...form, wechat })}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${formId}-address`} className="text-xs">地址</label>
              <Input
                id={`${formId}-address`}
                value={form.address}
                onChange={(address) => setForm({ ...form, address })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${formId}-notes`} className="text-xs">备注</label>
            <TextArea
              id={`${formId}-notes`}
              rows={2}
              value={form.notes}
              onChange={(notes) => setForm({ ...form, notes })}
            />
          </div>
        </fieldset>

        </FormDialogBody>
        <DialogFooter>
          <Button htmlType="button" theme="borderless" type="tertiary" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button htmlType="button" theme="solid" onClick={handleSave} loading={isPending} disabled={isPending}>
            {editing ? "更新" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
