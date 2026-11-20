"use server";

import { z } from "zod";
import { aiSettingsSaveSchema } from "@/lib/ai/settings-contract";
import { requireWorkspaceConfiguration } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import {
  saveAiSettings as saveSettings,
  readPublicAiSettings
} from "@/lib/ai/settings";
import { aiChat, AiNotConfiguredError } from "@/lib/ai/client";

const clearSchema = z.object({ confirm: z.literal(true) });

export async function getAiSettingsPublic() {
  await requireWorkspaceConfiguration();
  return readPublicAiSettings();
}

export async function saveAiSettingsAction(input: z.infer<typeof aiSettingsSaveSchema>) {
  const session = await requireWorkspaceConfiguration();
  const data = aiSettingsSaveSchema.parse(input);

  await saveSettings({
    enabled: data.enabled,
    apiKey: data.apiKey?.trim() || undefined,
    baseUrl: data.baseUrl?.trim() || undefined,
    textModel: data.textModel?.trim() || undefined,
    visionModel: data.visionModel?.trim() || undefined
  });

  await audit({
    userId: session.user.id,
    action: "AI_SETTINGS_SAVE",
    targetType: "SystemSetting",
    targetId: "aiSettings",
    detail: {
      changedKey: !!data.apiKey,
      enabled: data.enabled,
      textModel: data.textModel || null
    }
  });

  return { ok: true };
}

export async function clearAiKeyAction(input: z.infer<typeof clearSchema>) {
  const session = await requireWorkspaceConfiguration();
  clearSchema.parse(input);

  await saveSettings({ clearKey: true });

  await audit({
    userId: session.user.id,
    action: "AI_SETTINGS_CLEAR_KEY",
    targetType: "SystemSetting",
    targetId: "aiSettings"
  });

  return { ok: true };
}

/** 测试连接：发一个 ping，验证 base_url + key + text_model 可用 */
export async function testAiConnection() {
  const session = await requireWorkspaceConfiguration();
  try {
    await aiChat({
      userId: session.user.id,
      messages: [
        { role: "system", content: "You are a connectivity probe. Reply only with 'pong'." },
        { role: "user", content: "ping" }
      ],
      maxTokens: 10,
      temperature: 0,
      timeoutMs: 10_000
    });
    await requireWorkspaceConfiguration();
    return { ok: true, reply: "文本模型已响应；其他模型与业务能力尚未验证" };
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return { ok: false, message: e.message };
    }
    return {
      ok: false,
      message: "连接检查失败，请核对接口地址、凭据和文本模型；其他业务不受影响。"
    };
  }
}
