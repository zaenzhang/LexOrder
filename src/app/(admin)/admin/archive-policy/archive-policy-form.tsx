"use client";

import { Banner, Button, Form, Input, Notification, Select } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, ExternalLink } from "lucide-react";
import { saveArchivePolicy, type getArchivePolicySettings } from "@/server/archive/policy";
import { actionErrorMessage } from "@/lib/action-error";

type Data = Awaited<ReturnType<typeof getArchivePolicySettings>>;

export function ArchivePolicyForm({ data }: { data: Data }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(data.policy.configured ? data.policy.name : "");
  const [version, setVersion] = useState(data.policy.configured ? data.policy.version : "");
  const [effectiveAt, setEffectiveAt] = useState(data.policy.effectiveAt);
  const [sourceFileId, setSourceFileId] = useState(data.policy.sourceFileId ?? "");

  function submit() {
    startTransition(async () => {
      try {
        await saveArchivePolicy({ name, version, effectiveAt, sourceFileId });
        Notification.success({ title: "归档制度已保存", content: "后续申请将固定当前制度版本与原文。" });
        router.refresh();
      } catch (error) {
        Notification.error({ title: "保存失败", content: error instanceof Error ? actionErrorMessage(error) : "请稍后重试" });
      }
    });
  }

  return (
    <section className="space-y-5 rounded-xl border bg-card p-5">
      <header>
        <h2 className="flex items-center gap-2 text-[14px] font-semibold">
          <BookOpenCheck className="h-4 w-4 text-primary" />
          现行归档制度
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          归档申请会固定制度名称、版本、生效日期和原文校验值，历史申请不随设置变化。
        </p>
      </header>

      {!data.policy.configured && (
        <Banner
          type="warning"
          closeIcon={null}
          title="尚未配置律所归档制度"
          description="系统内置清单只能作为设置基础。请先为正式归档申请关联本所现行制度原文。"
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Form.Label name="archive-policy-name">制度名称</Form.Label>
          <Input id="archive-policy-name" value={name} onChange={(value) => setName(value)} placeholder="例如：律师业务档案立卷归档办法" maxLength={120} />
        </div>
        <div className="space-y-2">
          <Form.Label name="archive-policy-version">版本</Form.Label>
          <Input id="archive-policy-version" value={version} onChange={(value) => setVersion(value)} placeholder="例如：2026 年版 / 第 2 版" maxLength={60} />
        </div>
        <div className="space-y-2">
          <Form.Label name="archive-policy-date">生效日期</Form.Label>
          <Input id="archive-policy-date" type="date" value={effectiveAt} onChange={(value) => setEffectiveAt(value)} />
        </div>
        <div className="space-y-2">
          <Form.Label id="archive-policy-source-label">制度原文</Form.Label>
          <Select<string>
            aria-labelledby="archive-policy-source-label"
            className="w-full"
            placeholder="选择律所资料库中的制度文件"
            value={sourceFileId || undefined}
            disabled={pending || !data.files.length}
            filter
            onChange={value => setSourceFileId(String(value))}
          >
              {data.files.map((file) => <Select.Option key={file.id} value={file.id}>{file.name}</Select.Option>)}
            </Select>
          {!data.files.length && <p className="text-xs text-destructive">律所资料库暂无带校验值的“制度”文件，请先上传制度原文。</p>}
        </div>
      </div>

      {sourceFileId && (
        <a href={`/api/firm-files/${sourceFileId}/download?inline=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
          查看当前选择的制度原文 <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}

      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="font-medium">当前清单范围</p>
        <p className="mt-1 text-muted-foreground">诉讼及仲裁、非诉及专项、法律顾问三套清单；每套清单均增加归档范围、原件处理、费用处理、目录及页码四项人工核验。</p>
      </div>

      <div className="flex justify-end">
        <Button theme="solid" loading={pending} disabled={pending || !data.files.length} onClick={submit}>
          保存并启用此版本
        </Button>
      </div>
    </section>
  );
}
