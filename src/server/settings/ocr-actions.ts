"use server";
/** OCR 工作区设置；Server 仅系统管理员，密钥不回显明文。 */
import { z } from "zod";
import { requireWorkspaceConfiguration } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { readPublicOcrSettings, saveOcrSettings } from "@/server/ocr/provider";

const saveSchema = z.object({
  endpoint: z.string().trim().max(600).refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
  }, "请使用不带凭据或查询参数的 HTTPS 网关地址"),
  apiKey: z.string().trim().max(4096).optional(),
  supportsPdf: z.boolean(),
  enabled: z.boolean().optional(),
  clearKey: z.boolean().optional()
});

export async function getOcrSettingsPublic() {
  // 读取和保存共用配置资格；普通业务权限不能读取服务密钥。
  await requireWorkspaceConfiguration();
  return readPublicOcrSettings();
}

export async function saveOcrSettingsAction(input: z.input<typeof saveSchema>) {
  const session = await requireWorkspaceConfiguration();
  const data = saveSchema.parse(input);
  await saveOcrSettings({
    endpoint: data.endpoint,
    apiKey: data.apiKey,
    supportsPdf: data.supportsPdf,
    enabled: data.enabled,
    clearKey: data.clearKey
  });
  await audit({
    userId: session.user.id,
    action: "OCR_SETTINGS_SAVE",
    targetType: "SystemSetting",
    targetId: "ocrSettings",
    detail: { hasEndpoint: Boolean(data.endpoint), enabled: data.enabled, supportsPdf: data.supportsPdf, keyChanged: Boolean(data.apiKey) || data.clearKey }
  });
  return { ok: true };
}
