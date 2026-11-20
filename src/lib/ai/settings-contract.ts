import { z } from "zod";

export const aiSettingsSaveSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().trim().max(4096).optional(),
  baseUrl: z.string().max(600).url().refine(value => {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; }
    catch { return false; }
  }, "请使用不带凭据或查询参数的 HTTPS 接口地址").optional().or(z.literal("")),
  textModel: z.string().max(80).optional().or(z.literal("")),
  visionModel: z.string().max(80).optional().or(z.literal("")),
});
