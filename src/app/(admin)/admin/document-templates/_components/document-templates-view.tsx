"use client";

/**
 * 文书模板管理（v5 §4.4 挂账清偿：律师自定义文书模板上传）。
 * 内置模板只读；自定义模板支持上传（docx，自动提取 {{变量}}）与启停。
 * 上传后即出现在案件详情「模板」选择器（按案件类别过滤）。
 */
import { Tag as SemiTag } from "@/components/patterns/semi-surfaces";
import { Button, Checkbox, Form, Input, Notification, Select, Switch, Toast } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconArticle as FileText, IconPlus as Plus, IconUpload as Upload } from "@douyinfe/semi-icons";
import {
  WorkspaceDialog,
  DrawerContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/patterns/workspace-dialog";
import { uploadDocumentTemplate, toggleTemplate } from "@/server/document-templates/actions";
import { VARIABLE_LABEL_CN } from "@/app/(app)/matters/[id]/_components/folder-types";
import { FileInput } from "@/components/patterns/file-input";
import { AdminPageHeader } from "@/components/layout/admin-page-header";
import { formatDate } from "@/lib/utils";
import { actionErrorMessage } from "@/lib/action-error";

type Category = "INTAKE" | "RETAINER" | "LITIGATION" | "HEARING" | "WORK_PRODUCT" | "EXECUTION" | "ARCHIVE" | "CLOSING" | "BLANK";
type MatterCat = "CIVIL_COMMERCIAL" | "LABOR_ARBITRATION" | "COMMERCIAL_ARBITRATION" | "CRIMINAL" | "ADMINISTRATIVE" | "NON_LITIGATION" | "LEGAL_COUNSEL" | "SPECIAL_PROJECT";

const CATEGORY_CN: Record<Category, string> = {
  INTAKE: "收案文书", RETAINER: "委托文书", LITIGATION: "诉讼文书", HEARING: "庭审文书",
  WORK_PRODUCT: "工作成果", EXECUTION: "执行文书", ARCHIVE: "卷宗文书", CLOSING: "结案文书", BLANK: "空白文档"
};
const MATTER_CAT_CN: Record<MatterCat, string> = {
  CIVIL_COMMERCIAL: "民商事", LABOR_ARBITRATION: "劳动仲裁", COMMERCIAL_ARBITRATION: "商事仲裁", CRIMINAL: "刑事", ADMINISTRATIVE: "行政",
  NON_LITIGATION: "非诉专项", LEGAL_COUNSEL: "法律顾问", SPECIAL_PROJECT: "专项"
};

export type AdminTemplateRow = {
  id: string;
  name: string;
  category: Category;
  description: string | null;
  applicableCategories: MatterCat[];
  variables: string[];
  isBuiltIn: boolean;
  enabled: boolean;
  updatedAt: string;
  createdBy: { name: string } | null;
  docxBlob: { name: string; size: number | null } | null;
};

export function DocumentTemplatesView({ templates }: { templates: AdminTemplateRow[] }) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="文书模板"
        actions={<Button theme="solid" size="small" onClick={() => setUploadOpen(true)}><Plus aria-hidden />上传模板</Button>}
        sub={<>
            模板在案件详情「生成文书」时按案件类别选用；正文使用 <code className="font-mono text-xs">{"{{变量}}"}</code> 占位（如 <code className="font-mono text-xs">{"{{client.name}}"}</code>），生成时自动填充。
        </>}
      />

      <section className="ll-surface">
        <header className="ll-panel-head">
          <h3 className="ll-panel-title">
            <FileText aria-hidden size="default" className="text-primary" />
            模板库
            <span className="font-mono text-xs text-muted-foreground tabular">
              {templates.filter(t => t.enabled).length}/{templates.length}
            </span>
          </h3>
        </header>
        {templates.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">暂无模板</p>
        ) : (
          <div className="divide-y divide-border/60">
            {templates.map(t => (
              <div key={t.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${t.enabled ? "" : "opacity-55"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">{t.name}</span>
                    <SemiTag size="small" color="grey">{CATEGORY_CN[t.category]}</SemiTag>
                    {t.isBuiltIn ? (
                      <span className="rounded-full bg-primary/10 px-1.5 py-px text-xs text-primary">内置</span>
                    ) : (
                      <span className="rounded-full border border-[var(--semi-color-primary-light-active)] bg-[var(--semi-color-primary-light-default)] px-1.5 py-px text-xs text-[var(--semi-color-primary-active)]">自定义</span>
                    )}
                    {!t.enabled && <span className="text-xs text-muted-foreground">已停用</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-mono tabular">{t.variables.length} 个变量</span>
                    <span>·</span>
                    <span>{t.applicableCategories.length === 0 ? "适用全部案件类别" : t.applicableCategories.map(c => MATTER_CAT_CN[c]).join("／")}</span>
                    {t.docxBlob && (
                      <>
                        <span>·</span>
                        <span className="font-mono tabular">{Math.max(1, Math.round((t.docxBlob.size ?? 0) / 1024))} KB</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{t.createdBy?.name ?? "系统"} · {formatDate(new Date(t.updatedAt))}</span>
                  </div>
                  {t.description && <div className="mt-0.5 truncate text-xs text-muted-foreground/75">{t.description}</div>}
                </div>
                <ToggleEnabled template={t} />
              </div>
            ))}
          </div>
        )}
        <footer className="ll-panel-foot text-xs leading-relaxed text-muted-foreground">
          内置模板由系统维护、只可启停；自定义模板上传后立即生效，停用即从案件模板选择器隐藏。模板源文件加密存储，仅经生成流程读取。
        </footer>
      </section>

      <UploadSheet open={uploadOpen} onOpenChange={setUploadOpen} onDone={() => router.refresh()} />
    </div>
  );
}

function ToggleEnabled({ template }: { template: AdminTemplateRow }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Switch
      aria-label={`启用模板：${template.name}`}
      size="small"
      checked={template.enabled}
      disabled={pending}
      loading={pending}
      onChange={enabled => startTransition(async () => {
        try {
          await toggleTemplate({ id: template.id, enabled });
          Toast.success(enabled ? "模板已启用" : "模板已停用");
          router.refresh();
        } catch (err) {
          Notification.error({ title: "操作失败", content: actionErrorMessage(err) });
        }
      })}
    />
  );
}

const SAMPLE_VARS = Object.keys(VARIABLE_LABEL_CN).slice(0, 12);

function UploadSheet({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("LITIGATION");
  const [description, setDescription] = useState("");
  const [applicable, setApplicable] = useState<MatterCat[]>([]);
  const [file, setFile] = useState<File | null>(null);

  function reset() {
    setName(""); setCategory("LITIGATION"); setDescription(""); setApplicable([]); setFile(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { Toast.warning("请填写模板名称"); return; }
    if (!file) { Toast.warning("请选择 docx 模板文件"); return; }
    const formData = new FormData();
    formData.set("name", name.trim());
    formData.set("category", category);
    formData.set("description", description.trim());
    formData.set("applicableCategories", applicable.join(","));
    formData.set("file", file);
    startTransition(async () => {
      try {
        const res = await uploadDocumentTemplate(formData);
        Toast.success(`模板已上传（识别到 ${res.variableCount} 个变量）`);
        onOpenChange(false);
        reset();
        onDone();
      } catch (err) {
        Notification.error({ title: "上传失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <WorkspaceDialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DrawerContent side="right" className="flex w-screen flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border bg-background px-6 py-4">
          <DialogTitle>上传文书模板</DialogTitle>
          <DialogDescription className="text-xs">
            仅支持 .docx；正文用双大括号占位，上传后自动提取变量清单（页眉页脚一并扫描）
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="space-y-1.5">
              <Form.Label name="new-template-name" required>模板名称</Form.Label>
              <Input id="new-template-name" disabled={pending} value={name} onChange={value => setName(value)} maxLength={80} placeholder="如：民事授权委托书（所内版）" />
            </div>
            <div className="space-y-1.5">
              <Form.Label id="new-template-category-label" required>模板大类</Form.Label>
              <Select aria-labelledby="new-template-category-label" aria-required className="w-full" disabled={pending} value={category} onChange={v => setCategory(v as Category)}>
                  {(Object.keys(CATEGORY_CN) as Category[]).map(c => (
                    <Select.Option key={c} value={c}>{CATEGORY_CN[c]}</Select.Option>
                  ))}
                </Select>
            </div>
            <div className="space-y-1.5">
              <Form.Label id="new-template-applicable-label">适用案件类别（未选时适用全部）</Form.Label>
              <Checkbox.Group
                aria-labelledby="new-template-applicable-label"
                className="flex flex-wrap gap-3"
                disabled={pending}
                value={applicable}
                onChange={setApplicable}
                options={(Object.keys(MATTER_CAT_CN) as MatterCat[]).map(value => ({ value, label: MATTER_CAT_CN[value] }))}
              />
            </div>
            <div className="space-y-1.5">
              <Form.Label name="new-template-description">说明</Form.Label>
              <Input id="new-template-description" disabled={pending} value={description} onChange={value => setDescription(value)} maxLength={300} placeholder="用途、注意事项（可选）" />
            </div>
            <div className="space-y-1.5">
              <Form.Label name="new-template-file" required>模板文件（.docx，≤10MB）</Form.Label>
              <FileInput id="new-template-file" required disabled={pending} accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              <div className="text-xs font-semibold text-muted-foreground">常用变量（生成时自动填充）</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {SAMPLE_VARS.map(v => (
                  <span key={v} className="rounded-full bg-card px-2 py-0.5 font-mono text-xs text-muted-foreground" title={VARIABLE_LABEL_CN[v]}>
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="border-t border-border bg-background px-6 py-4">
            <Button htmlType="button" theme="outline" onClick={() => onOpenChange(false)} disabled={pending}>取消</Button>
            <Button theme="solid" htmlType="submit" loading={pending} disabled={pending} icon={<Upload size="default" aria-hidden />}>
              上传
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </WorkspaceDialog>
  );
}
