"use client";

import { Button, Form, Input, Toast } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Scale,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  ExternalLink
} from "lucide-react";
import {
  saveYuandianSettingsAction,
  clearYuandianKeyAction,
  testYuandianConnection
} from "@/server/settings/yuandian-actions";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";

type Initial = {
  configured: boolean;
  baseUrl: string;
  caseDetailHost: string;
  apiKeyMasked: string;
  configurationError?: string;
};

export function YuandianSettingsForm({
  initial,
  defaults
}: {
  initial: Initial;
  defaults: { baseUrl: string; caseDetailHost: string };
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl || defaults.baseUrl);
  const [caseDetailHost, setCaseDetailHost] = useState(
    initial.caseDetailHost || defaults.caseDetailHost
  );
  const [pending, startTransition] = useTransition();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const changed = !!apiKey || baseUrl !== initial.baseUrl || caseDetailHost !== initial.caseDetailHost;

  const save = () => {
    startTransition(async () => {
      try {
        await saveYuandianSettingsAction({ apiKey, baseUrl, caseDetailHost });
        Toast.success("元典配置已保存");
        setApiKey("");
        setTestResult(null);
        router.refresh();
      } catch (e) {
        Toast.error(e instanceof Error ? actionErrorMessage(e) : "保存失败");
      }
    });
  };

  const clearKey = async () => {
    if (!(await confirmDialog({ title: "清除元典 API key？", description: "类案检索与企业信息匹配将停止工作。", confirmText: "清除", danger: true }))) return;
    startTransition(async () => {
      try {
        await clearYuandianKeyAction({ confirm: true });
        Toast.success("元典 API key 已清除");
        setTestResult(null);
        router.refresh();
      } catch (e) {
        Toast.error(e instanceof Error ? actionErrorMessage(e) : "失败");
      }
    });
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testYuandianConnection();
      setTestResult({ ok: res.ok, msg: res.message ?? "" });
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? actionErrorMessage(e) : "网络错误" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="ll-surface rounded-lg border border-border p-5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <Scale className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <h2 className="text-[14px] font-semibold">元典案例库 API</h2>
        <span className="ml-2 text-[11px] text-muted-foreground">{initial.configurationError ? "配置需修复" : initial.configured ? "已配置 · 未验证" : "未配置"}</span>
      </header>

      <p className="mb-4 text-[12px] text-muted-foreground">
        用于类案检索与企业信息匹配。MCP 接入单独配置；计费和数据权益以平台账号为准。
      </p>
      {initial.configurationError && <p role="alert" className="mb-3 text-sm text-destructive">{initial.configurationError}</p>}

      <div className="space-y-3">
        <div>
          <Form.Label name="yuandian-api-key" className="text-[11px]">
            接口密钥（API Key）
            {initial.apiKeyMasked && (
              <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                当前：{initial.apiKeyMasked}（留空保留原值）
              </span>
            )}
          </Form.Label>
          <Input
            id="yuandian-api-key"
            type="password"
            value={apiKey}
            onChange={(value) => setApiKey(value)}
            placeholder={initial.configured ? "如需更换粘贴新 key" : "粘贴元典 API key"}
            className="mt-1 font-mono"
            autoComplete="off"
          />
        </div>

        <div>
          <Form.Label name="yuandian-base-url" className="text-[11px]">接口地址（Base URL）</Form.Label>
          <Input
            id="yuandian-base-url"
            value={baseUrl}
            onChange={(value) => setBaseUrl(value)}
            placeholder={defaults.baseUrl}
            className="mt-1 font-mono text-[12px]"
          />
        </div>

        <div>
          <Form.Label name="yuandian-case-detail-host" className="text-[11px]">案例详情前端域名</Form.Label>
          <Input
            id="yuandian-case-detail-host"
            value={caseDetailHost}
            onChange={(value) => setCaseDetailHost(value)}
            placeholder={defaults.caseDetailHost}
            className="mt-1 font-mono text-[12px]"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            用于「查看全文」外跳，与接口 URL 区分
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button theme="solid" onClick={save} disabled={pending} className="gap-1.5">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          保存配置
        </Button>
        <Button
          theme="outline"
          onClick={runTest}
          disabled={testing || pending || changed || !initial.configured}
          className="gap-1.5"
        >
          {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {changed ? "保存后测试" : "测试案例检索（可能计费）"}
        </Button>
        {initial.apiKeyMasked && (
          <Button
            theme="borderless" type="tertiary"
            onClick={clearKey}
            disabled={pending}
            className="ml-auto gap-1 text-destructive"
          >
            <Trash2 className="h-3 w-3" />
            清除密钥
          </Button>
        )}
      </div>

      {!changed && testResult && (
        <div
          className={
            "mt-3 flex items-start gap-2 rounded-md border p-3 text-[12px] " +
            (testResult.ok
              ? "border-[var(--green-line)] bg-[var(--green-bg)] text-[var(--green)]"
              : "border-destructive/30 bg-destructive/10 text-destructive")
          }
        >
          {testResult.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{testResult.msg}</span>
        </div>
      )}

      <p className="mt-4 text-[11px] text-muted-foreground">
        申请密钥：
        <a
          href="https://open.chineselaw.com"
          target="_blank"
          rel="noreferrer"
          className="ml-1 inline-flex items-center gap-1 text-primary hover:underline"
        >
          元典开放平台
          <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </section>
  );
}
