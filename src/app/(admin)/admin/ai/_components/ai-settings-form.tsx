"use client";

import { Disclosure } from "@/components/patterns/disclosure";
import { Button, Checkbox, Form, Input, Toast } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconAIWandLevel1 as Sparkles, IconTickCircle as CheckCircle2, IconAlertTriangle as AlertTriangle, IconLoading as Loader2, IconDelete as Trash2, IconExternalOpen as ExternalLink } from "@douyinfe/semi-icons";
import {
  saveAiSettingsAction,
  clearAiKeyAction,
  testAiConnection
} from "@/server/settings/ai-actions";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";

type Initial = {
  enabled: boolean;
  credentialSaved: boolean;
  configurationError?: string;
  configured: boolean;
  baseUrl: string;
  textModel: string;
  visionModel: string;
  apiKeyMasked: string;
};

const PROVIDER_PRESETS = [
  {
    name: "通义千问（推荐）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    text: "qwen-turbo",
    vision: "qwen-vl-max",
    apply: "阿里云百炼控制台获取 key",
    link: "https://bailian.console.aliyun.com/"
  },
  {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    text: "deepseek-v4-flash",
    vision: "deepseek-v4-flash",
    apply: "DeepSeek 平台获取 key",
    link: "https://platform.deepseek.com/api_keys"
  },
  {
    name: "Moonshot Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    text: "moonshot-v1-8k",
    vision: "moonshot-v1-8k-vision-preview",
    apply: "Moonshot 平台获取 key",
    link: "https://platform.moonshot.cn/"
  },
  {
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    text: "glm-4-flash",
    vision: "glm-4v",
    apply: "智谱开放平台获取 key",
    link: "https://open.bigmodel.cn/"
  }
] as const;

export function AiSettingsForm({
  initial,
  defaults
}: {
  initial: Initial;
  defaults: { baseUrl: string; textModel: string; visionModel: string };
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl || defaults.baseUrl);
  const [textModel, setTextModel] = useState(initial.textModel || defaults.textModel);
  const [visionModel, setVisionModel] = useState(initial.visionModel || defaults.visionModel);
  const [pending, startTransition] = useTransition();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const changed = enabled !== initial.enabled || !!apiKey || baseUrl !== initial.baseUrl || textModel !== initial.textModel || visionModel !== initial.visionModel;

  const applyPreset = (p: (typeof PROVIDER_PRESETS)[number]) => {
    setBaseUrl(p.baseUrl);
    setTextModel(p.text);
    setVisionModel(p.vision);
    Toast.info(`已应用 ${p.name} 默认配置，请填入对应 API key`);
  };

  const save = () => {
    startTransition(async () => {
      try {
        await saveAiSettingsAction({
          enabled,
          apiKey,
          baseUrl,
          textModel,
          visionModel
        });
        Toast.success("配置已保存");
        setApiKey(""); // 不在前端持久 key
        setTestResult(null);
        router.refresh();
      } catch (e) {
        Toast.error(e instanceof Error ? actionErrorMessage(e) : "保存失败");
      }
    });
  };

  const clearKey = async () => {
    if (!(await confirmDialog({ title: "清除 AI API key？", description: "所有依赖 AI 的功能（识别、推荐、审查）将停止工作。", confirmText: "清除", danger: true }))) return;
    startTransition(async () => {
      try {
        await clearAiKeyAction({ confirm: true });
        Toast.success("API key 已清除");
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
      const res = await testAiConnection();
      if (res.ok) {
        setTestResult({ ok: true, msg: res.reply ?? "文本模型已响应" });
      } else {
        setTestResult({ ok: false, msg: res.message ?? "未知错误" });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? actionErrorMessage(e) : "网络错误" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="ll-surface rounded-lg border border-border p-5">
        <header className="mb-3 flex flex-wrap items-center gap-2">
          <Sparkles aria-hidden size="default" className="text-primary" />
          <h2 className="text-[14px] font-semibold">AI 接入</h2>
          <span className="ml-2 text-xs text-muted-foreground">{!initial.enabled ? "已禁用" : initial.configurationError ? "配置需修复" : initial.configured ? "已配置 · 未验证" : "未配置"}</span>
        </header>

        <p className="mb-4 text-xs text-muted-foreground">支持 OpenAI 兼容接口。</p>
        {initial.configurationError && <p role="alert" className="mb-3 text-sm text-destructive">{initial.configurationError}</p>}
        <Checkbox className="mb-4" checked={enabled} onChange={e => setEnabled((e.target.checked === true))}>启用 AI 服务</Checkbox>

        {/* Provider 预设 */}
        <fieldset className="mb-4">
          <legend className="text-xs">快速预设</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PROVIDER_PRESETS.map((p) => (
              <Button theme="outline" type="tertiary" size="small"
                key={p.name}
                htmlType="button"
                onClick={() => applyPreset(p)}
              >
                {p.name}
              </Button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-3">
          <div>
            <Form.Label name="ai-api-key" className="text-xs">
              接口密钥（API Key）
              {initial.credentialSaved && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  当前：{initial.apiKeyMasked}（留空保留原值）
                </span>
              )}
            </Form.Label>
            <Input
              id="ai-api-key"
              type="password"
              value={apiKey}
              onChange={(value) => setApiKey(value)}
              placeholder={initial.credentialSaved ? "如需更换粘贴新 key" : "粘贴 API key"}
              className="mt-1 font-mono"
              autoComplete="off"
            />
          </div>

          <div>
            <Form.Label name="ai-base-url" className="text-xs">接口地址（Base URL）</Form.Label>
            <Input
              id="ai-base-url"
              value={baseUrl}
              onChange={(value) => setBaseUrl(value)}
              placeholder={defaults.baseUrl}
              className="mt-1 font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Form.Label name="ai-text-model" className="text-xs">文本模型</Form.Label>
              <Input
                id="ai-text-model"
                value={textModel}
                onChange={(value) => setTextModel(value)}
                placeholder={defaults.textModel}
                className="mt-1 font-mono text-xs"
              />
              <p className="mt-1 text-xs text-muted-foreground">用于法院短信 AI 解析等</p>
            </div>
            <div>
              <Form.Label name="ai-vision-model" className="text-xs">视觉模型</Form.Label>
              <Input
                id="ai-vision-model"
                value={visionModel}
                onChange={(value) => setVisionModel(value)}
                placeholder={defaults.visionModel}
                className="mt-1 font-mono text-xs"
              />
              <p className="mt-1 text-xs text-muted-foreground">用于发票 OCR 等</p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button theme="solid" onClick={save} disabled={pending} className="gap-1.5">
            {pending && <Loader2 aria-hidden size="small" spin />}
            保存配置
          </Button>
          <Button
            theme="outline"
            onClick={runTest}
            disabled={testing || pending || changed || !initial.configured}
            className="gap-1.5"
          >
            {testing && <Loader2 aria-hidden size="small" spin />}
            {changed ? "保存后测试" : "测试连接"}
          </Button>
          {initial.credentialSaved && (
            <Button
              theme="borderless" type="tertiary"
              onClick={clearKey}
              disabled={pending}
              className="ml-auto gap-1 text-destructive"
            >
              <Trash2 aria-hidden size="small" />
              清除密钥
            </Button>
          )}
        </div>

        {!changed && testResult && (
          <div
            className={
              "mt-3 flex items-start gap-2 rounded-md border p-3 text-xs " +
              (testResult.ok
                ? "border-[var(--semi-color-success-light-active)] bg-[var(--semi-color-success-light-default)] text-[var(--semi-color-success)]"
                : "border-destructive/30 bg-destructive/10 text-destructive")
            }
          >
            {testResult.ok ? (
              <CheckCircle2 aria-hidden size="small" className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle aria-hidden size="small" className="mt-0.5 shrink-0" />
            )}
            <span>{testResult.msg}</span>
          </div>
        )}
      </section>

      <Disclosure heading="获取接口密钥">
        <ul className="mt-3 space-y-2 text-xs">
          {PROVIDER_PRESETS.map((p) => (
            <li key={p.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="w-28 shrink-0 text-foreground/85">{p.name}</span>
              <span className="text-muted-foreground">{p.apply}</span>
              <a
                href={p.link}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
              >
                打开
                <ExternalLink aria-hidden size="small" />
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">密钥加密保存，不显示原文。</p>
      </Disclosure>
    </div>
  );
}
