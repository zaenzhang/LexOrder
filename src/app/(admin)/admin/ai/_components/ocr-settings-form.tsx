"use client";
/**
 * B2 OCR 设置卡：默认复用上方 AI 设置的视觉模型（图片识别）；可选配置独立 HTTP OCR 网关
 * （支持任意云厂商 / 自建网关，声明 supportsPdf 后可整体识别扫描 PDF）。未配置时来件分析
 * 对扫描件降级为「需人工（无 OCR）」，保存、取件与人工确认照常（不显示为分析成功）。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { actionErrorMessage } from "@/lib/action-error";

export function OcrSettingsForm({ initial }: { initial: { endpoint: string; apiKey: string; supportsPdf: boolean; enabled: boolean; configurationError?: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [endpoint, setEndpoint] = useState(initial.endpoint);
  const [apiKey, setApiKey] = useState("");
  const [supportsPdf, setSupportsPdf] = useState(initial.supportsPdf);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [clearKey, setClearKey] = useState(false);

  function save() {
    start(async () => {
      try {
        const { saveOcrSettingsAction } = await import("@/server/settings/ocr-actions");
        await saveOcrSettingsAction({ endpoint: endpoint.trim(), apiKey: apiKey.trim() || undefined, supportsPdf, enabled, clearKey });
        toast.success("OCR 设置已保存");
        setApiKey("");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? actionErrorMessage(e) : "保存失败");
      }
    });
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3"><h2 className="text-sm font-medium">独立 OCR 网关（可选）</h2><span className="text-xs text-muted-foreground">{!initial.enabled ? "已禁用" : initial.configurationError ? "配置需修复" : initial.endpoint ? "已配置 · 未验证" : "未配置"}</span></div>
      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
        网关关闭时，图片识别仍可使用已启用的 AI 视觉模型；两者均不可用时保留原件并由人工处理。保存不会发送扫描件或测试请求。
      </p>
      {initial.configurationError && <p role="alert" className="mt-2 text-sm text-destructive">{initial.configurationError}</p>}
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />启用独立 OCR 网关</label>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="ocr-endpoint">OCR 网关地址（可选）</Label>
          <Input id="ocr-endpoint" placeholder="https://ocr.example.com/recognize" value={endpoint} onChange={e => setEndpoint(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ocr-key">API Key（可选，留空保持不变）</Label>
          <Input id="ocr-key" type="password" autoComplete="off" disabled={clearKey} placeholder={initial.apiKey ? "已保存（留空不变）" : "未设置"} value={apiKey} onChange={e => setApiKey(e.target.value)} />
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={supportsPdf} onChange={e => setSupportsPdf(e.target.checked)} />
        该网关支持直接识别扫描 PDF（整体送 PDF 字节）
      </label>
      {initial.apiKey && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={clearKey} onChange={e => { setClearKey(e.target.checked); setApiKey(""); }} />清除已保存的密钥（保存后生效）</label>}
      <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">网关协议</summary><p className="mt-2">系统发送 {"{ contentBase64, mimeType }"}，期望返回 {"{ text }"}。需由部署方选择兼容的 HTTPS 网关；密钥加密保存，不回显原文。</p></details>
      <div className="mt-3">
        <Button size="sm" disabled={pending} onClick={save}>{pending ? "保存中…" : "保存 OCR 设置"}</Button>
      </div>
    </div>
  );
}
