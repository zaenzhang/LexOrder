"use server";
/** OCR 工作区设置；Server 仅系统管理员，密钥不回显明文。 */
import { z } from "zod";
import { requireWorkspaceConfiguration } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { readOcrSettings, saveOcrSettings } from "@/server/ocr/provider";

const saveSchema = z.object({
  endpoint: z.string().trim().max(300),
  apiKey: z.string().trim().max(200).optional(),
  supportsPdf: z.boolean()
});

export async function getOcrSettingsPublic() {
  // 读取和保存共用配置资格；普通业务权限不能读取服务密钥。
  await requireWorkspaceConfiguration();
  const stored = await readOcrSettings();
  return {
    endpoint: stored?.endpoint ?? "",
    apiKey: stored?.apiKey ? "已保存" : "",
    supportsPdf: stored?.supportsPdf ?? false
  };
}

export async function saveOcrSettingsAction(input: z.input<typeof saveSchema>) {
  const session = await requireWorkspaceConfiguration();
  const data = saveSchema.parse(input);
  const existing = await readOcrSettings();
  await saveOcrSettings({
    endpoint: data.endpoint,
    apiKey: data.apiKey || existing?.apiKey,
    supportsPdf: data.supportsPdf
  });
  await audit({
    userId: session.user.id,
    action: "OCR_SETTINGS_SAVE",
    targetType: "SystemSetting",
    targetId: "ocrSettings",
    detail: { hasEndpoint: Boolean(data.endpoint), supportsPdf: data.supportsPdf, keyChanged: Boolean(data.apiKey) }
  });
  return { ok: true };
}
