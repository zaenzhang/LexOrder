"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { FolderArchive, Search, Download, Trash2, History, X, Tag as TagIcon } from "lucide-react";
import { Button, Checkbox, Input, Notification, Tag, Toast, Typography } from "@douyinfe/semi-ui";
import type { FirmFileCategory } from "@prisma/client";
import { deleteFirmFile } from "@/server/firm-files/actions";
import { formatDate } from "@/lib/utils";
import { UploadDialog } from "./upload-dialog";
import { PreviewDialog } from "./preview-dialog";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { WorkspaceTabs } from "@/components/patterns/moan";
import { actionErrorMessage } from "@/lib/action-error";

type FileEntry = {
  id: string;
  name: string;
  description: string | null;
  category: FirmFileCategory;
  tags: string[];
  mimeType: string | null;
  size: number;
  uploadedBy: { id: string; name: string };
  createdAt: Date;
  hasNewerVersion: boolean;
  supersedesCount: number;
};

const CATEGORY_META: Record<FirmFileCategory, { label: string; color: "violet" | "blue" | "green" | "amber" }> = {
  POLICY: { label: "制度", color: "violet" },
  GUIDE: { label: "指引", color: "blue" },
  TEMPLATE: { label: "参考模板", color: "green" },
  REFERENCE: { label: "其他文件", color: "amber" },
  CONTRACT: { label: "合同", color: "blue" },
  LETTER: { label: "函件", color: "green" },
  LICENSE: { label: "证照", color: "amber" },
  OTHER_FIRM: { label: "其他", color: "violet" }
};

/** 律所文书页展示的分类 */
const FIRM_DOC_CATEGORIES: FirmFileCategory[] = ["CONTRACT", "LETTER", "LICENSE", "OTHER_FIRM"];
/** 旧分类（兼容已有数据） */
const LEGACY_CATEGORIES: FirmFileCategory[] = ["POLICY", "GUIDE", "TEMPLATE", "REFERENCE"];

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function FirmFilesView({
  files,
  canUpload,
  currentCategory,
  currentSearch,
  includeSuperseded,
  basePath = "/firm-resources",
  preservedParams = [],
  hideHeader,
  hideCategoryNav,
  headerTitle,
  headerSubtitle,
  categorySet
}: {
  files: FileEntry[];
  canUpload: boolean;
  currentCategory?: FirmFileCategory;
  currentSearch: string;
  includeSuperseded: boolean;
  /** v0.27: 让 service-center 复用同一组件且保留 ?tab= */
  basePath?: string;
  preservedParams?: string[];
  /** v0.37: 应用页内嵌——隐藏标题/介绍（tab 已标注）*/
  hideHeader?: boolean;
  /** v0.37: 隐藏分类筛选条（如「制度规范」tab 只列 POLICY）*/
  hideCategoryNav?: boolean;
  /** v0.44: 覆盖默认标题/副标题/图标 */
  headerTitle?: string;
  headerSubtitle?: string;
  /** v0.44: 分类集合（"firm"=律所文书新分类，默认旧分类） */
  categorySet?: "firm" | "legacy";
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [search, setSearch] = useState(currentSearch);
  const [uploadOpen, setUploadOpen] = useState(false);
  useTopbarAction(canUpload ? { label: "上传资料", onClick: () => setUploadOpen(true) } : null, [canUpload]);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeCategories = categorySet === "firm" ? FIRM_DOC_CATEGORIES : LEGACY_CATEGORIES;

  function navigate(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams();
    // 保留指定的 query（如 tab=firm-files）
    for (const k of preservedParams) {
      const v = sp.get(k);
      if (v) next.set(k, v);
    }
    // 合并目前的 firm-file 相关 query（category / q / includeOld）
    for (const k of ["category", "q", "includeOld"]) {
      const v = sp.get(k);
      if (v) next.set(k, v);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate({ q: search.trim() || undefined });
  }

  async function handleDelete(f: FileEntry) {
    if (!(await confirmDialog({ title: `删除「${f.name}」？`, description: "软删除：列表不再展示，数据仍保留可由管理员找回。", confirmText: "删除", danger: true }))) return;
    setPendingId(f.id);
    startTransition(async () => {
      try {
        await deleteFirmFile({ id: f.id });
        Toast.success("已删除");
        router.refresh();
      } catch (err) {
        Notification.error({ title: "删除失败", content: actionErrorMessage(err), duration: 6 });
      } finally {
        setPendingId(null);
      }
    });
  }

  const counts = activeCategories.reduce<Record<FirmFileCategory, number>>(
    (acc, c) => {
      acc[c] = files.filter((f) => f.category === c).length;
      return acc;
    },
    // Initialize all to 0
    [...FIRM_DOC_CATEGORIES, ...LEGACY_CATEGORIES].reduce((acc, c) => { acc[c] = 0; return acc; }, {} as Record<FirmFileCategory, number>)
  );

  return (
    <div className="space-y-4">
      {!hideHeader ? (
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="mo-ph-title">
              {headerTitle ?? "律所文书"}
            </h1>
            <p className="mo-ph-sub">
              {headerSubtitle ?? (
                <>
                  合同 · 函件 · 证照 · 其他。全所共享，
                  {canUpload ? "管理员可上传与版本替代" : "管理员上传"}
                </>
              )}
            </p>
          </div>
        </header>
      ) : null}

      {/* 筛选条 */}
      <div className="space-y-3">
        {!hideCategoryNav && (
        <div className="flex flex-wrap items-center gap-1.5">
          <WorkspaceTabs
            items={[{ key: "ALL", label: "全部", count: files.length }, ...activeCategories.map((c) => ({ key: c as string, label: CATEGORY_META[c].label, count: counts[c] }))]}
            value={currentCategory ?? "ALL"}
            onChange={(k) => navigate({ category: k === "ALL" ? undefined : (k as typeof activeCategories[number]) })}
          />
          <Checkbox className="ml-auto" checked={includeSuperseded}
            onChange={event => navigate({ includeOld: event.target.checked ? "1" : undefined })}>包含旧版</Checkbox>
        </div>
        )}

        <form onSubmit={handleSearch} className="flex items-center gap-1.5">
          <Input className="max-w-md flex-1" value={search} onChange={setSearch} prefix={<Search size={16} />}
            aria-label="搜索律所资料" placeholder="名称 / 描述 / 标签" />
          <Button htmlType="submit" theme="light">搜索</Button>
          {currentSearch && (
            <Button aria-label="清除搜索" theme="borderless" type="tertiary" icon={<X size={16} />}
              onClick={() => { setSearch(""); navigate({ q: undefined }); }} />
          )}
        </form>
      </div>

      {/* 列表 */}
      {files.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <FolderArchive className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {currentSearch
              ? `没有匹配「${currentSearch}」的资料`
              : currentCategory
                ? `没有「${CATEGORY_META[currentCategory].label}」类资料`
                : "还没有上传任何资料"}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map((f) => {
            const meta = CATEGORY_META[f.category];
            return (
              <li
                key={f.id}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 overflow-hidden">
                    {/* 第一行：文件名 + 标签 + 大小 / 时间 */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button theme="borderless" noHorizontalPadding onClick={() => setPreviewFile(f)} title={f.name}
                        className="max-w-full min-w-0" contentClassName="truncate text-left">
                        {f.name}
                      </Button>
                      <Tag color={meta.color}>{meta.label}</Tag>
                      {f.hasNewerVersion && <Tag color="amber">旧版</Tag>}
                      {f.supersedesCount > 0 && (
                        <Tag color="violet" prefixIcon={<History size={12} />}>已替代 {f.supersedesCount} 个旧版</Tag>
                      )}
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="font-mono tabular">{formatBytes(f.size)}</span>
                        <span className="opacity-50">·</span>
                        <span>{formatDate(new Date(f.createdAt))}</span>
                        <span className="opacity-50">·</span>
                        <span>{f.uploadedBy.name}</span>
                        {f.tags.length > 0 && (
                          <>
                            <span className="opacity-50">·</span>
                            <span className="flex items-center gap-0.5">
                              <TagIcon className="h-2.5 w-2.5" />
                              {f.tags.join(" / ")}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                    {f.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{f.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Typography.Text link={{ href: `/api/firm-files/${f.id}/download` }} icon={<Download size={14} />}>
                      下载
                    </Typography.Text>
                    {canUpload && (
                      <Button theme="borderless" type="danger" icon={<Trash2 size={16} />} aria-label={`删除 ${f.name}`} title="删除"
                        loading={isPending && pendingId === f.id} disabled={isPending && pendingId !== f.id}
                        onClick={() => { if (!isPending) void handleDelete(f); }} />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canUpload && (
        <UploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          existingFiles={files}
        />
      )}

      <PreviewDialog
        open={!!previewFile}
        file={previewFile}
        onOpenChange={(o) => {
          if (!o) setPreviewFile(null);
        }}
      />
    </div>
  );
}

