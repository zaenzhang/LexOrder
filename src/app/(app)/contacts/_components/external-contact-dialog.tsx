"use client";
import { Button, Input, TextArea, Select } from "@douyinfe/semi-ui";

import { FormDialogContent as DialogContent, FormDialogBody } from "@/components/patterns/form-dialog";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { ExternalContactCategory } from "@prisma/client";

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
  const contentRef = useRef<HTMLDivElement>(null);
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
  const [categoryOpen, setCategoryOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setCategoryOpen(false);
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
    <Dialog open={open} onOpenChange={value => { if (!isPending) onOpenChange(value); }}>
      <DialogContent ref={contentRef} className="sm:max-w-lg" onEscapeKeyDown={event => { if (categoryOpen) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑联系人" : "新增外部联系人"}</DialogTitle>
        </DialogHeader>
        <FormDialogBody>

        <fieldset disabled={isPending} className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs">姓名 *</label>
              <Input
                aria-label="姓名" value={form.name}
                onChange={(value) => setForm({ ...form, name: value })}
              />
            </div>
            <div className="space-y-1.5">
              <label id="external-contact-category" className="text-xs">类别 *</label>
              <Select<ExternalContactCategory>
                style={{ width: "100%" }} value={form.category} disabled={isPending}
                aria-labelledby="external-contact-category" optionList={CATEGORY_OPTIONS}
                motion={false} getPopupContainer={() => contentRef.current!} onDropdownVisibleChange={setCategoryOpen}
                onChange={value => { if (typeof value === "string") setForm({ ...form, category: value }); }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs">单位 / 机构</label>
              <Input
                aria-label="单位" value={form.organization}
                onChange={(value) => setForm({ ...form, organization: value })}
                placeholder="如：上海市浦东新区人民法院"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">职务 / 庭室</label>
              <Input
                aria-label="职务" value={form.title}
                onChange={(value) => setForm({ ...form, title: value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs">手机</label>
              <Input
                aria-label="电话" value={form.phone}
                onChange={(value) => setForm({ ...form, phone: value })}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">邮箱</label>
              <Input
                type="email"
                aria-label="邮箱" value={form.email}
                onChange={(value) => setForm({ ...form, email: value })}
                className="font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs">微信</label>
              <Input
                aria-label="微信" value={form.wechat}
                onChange={(value) => setForm({ ...form, wechat: value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs">地址</label>
              <Input
                aria-label="地址" value={form.address}
                onChange={(value) => setForm({ ...form, address: value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs">备注</label>
            <TextArea
              rows={2}
              aria-label="备注" value={form.notes}
              onChange={(value) => setForm({ ...form, notes: value })}
            />
          </div>
        </fieldset>

        </FormDialogBody>
        <DialogFooter>
          <Button htmlType="button" theme="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button htmlType="button" theme="solid" onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {editing ? "更新" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
