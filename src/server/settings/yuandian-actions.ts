"use server";

import { z } from "zod";
import { requireWorkspaceConfiguration } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import {
  saveYuandianSettings as saveSettings,
  readPublicYuandianSettings,
  readStoredYuandianSettings
} from "@/lib/yuandian/settings";
import {
  searchPtalCases,
  YuandianNotConfiguredError
} from "@/lib/yuandian/client";

const saveSchema = z.object({
  apiKey: z.string().max(4096).optional().or(z.literal("")),
  baseUrl: z.string().url().optional().or(z.literal("")),
  caseDetailHost: z.string().url().optional().or(z.literal(""))
});

const clearSchema = z.object({ confirm: z.literal(true) });

export async function getYuandianSettingsPublic() {
  await requireWorkspaceConfiguration();
  try {
    const settings = await readPublicYuandianSettings();
    return { ...settings, apiKeyMasked: settings.configured ? "已保存" : "", configurationError: undefined as string | undefined };
  } catch {
    const settings = await readStoredYuandianSettings();
    return { configured: false, baseUrl: settings.baseUrl, caseDetailHost: settings.caseDetailHost, apiKeyMasked: settings.apiKeyCipher ? "已保存" : "", configurationError: "元典 API 凭据无法解密，请重新填写或清除密钥。" };
  }
}

export async function saveYuandianSettingsAction(input: z.infer<typeof saveSchema>) {
  const session = await requireWorkspaceConfiguration();
  const data = saveSchema.parse(input);

  await saveSettings({
    apiKey: data.apiKey?.trim() || undefined,
    baseUrl: data.baseUrl?.trim() || undefined,
    caseDetailHost: data.caseDetailHost?.trim() || undefined
  });

  await audit({
    userId: session.user.id,
    action: "YUANDIAN_SETTINGS_SAVE",
    targetType: "SystemSetting",
    targetId: "yuandianSettings",
    detail: { changedKey: !!data.apiKey }
  });
  return { ok: true };
}

export async function clearYuandianKeyAction(input: z.infer<typeof clearSchema>) {
  const session = await requireWorkspaceConfiguration();
  clearSchema.parse(input);
  await saveSettings({ clearKey: true });
  await audit({
    userId: session.user.id,
    action: "YUANDIAN_KEY_CLEAR",
    targetType: "SystemSetting",
    targetId: "yuandianSettings",
    detail: {}
  });
  return { ok: true };
}

/**
 * Explicit legacy API probe; actual charging follows the provider's current agreement.
 */
export async function testYuandianConnection(): Promise<{
  ok: boolean;
  message?: string;
}> {
  await requireWorkspaceConfiguration();
  try {
    const r = await searchPtalCases({ ay: ["民间借贷纠纷"], top_k: 1 });
    await requireWorkspaceConfiguration();
    return { ok: true, message: `案例检索已响应，命中 ${r.total} 条；本次已发出一次真实检索请求。` };
  } catch (err) {
    if (err instanceof YuandianNotConfiguredError) {
      return { ok: false, message: err.message };
    }
    return { ok: false, message: "元典 API 连接检查失败，请核对地址、凭据和数据权限。" };
  }
}
