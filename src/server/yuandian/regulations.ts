"use server";

import { requireSession } from "@/lib/auth/session";
import {
  searchRegulations,
  YuandianNotConfiguredError,
  type RegulationHit
} from "@/lib/yuandian/client";
import { getYuandianSettings } from "@/lib/yuandian/settings";
import { auditStrict } from "@/server/audit";
import { assertCanReadMatter } from "@/lib/permissions";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";

export type RegulationSearchHit = RegulationHit & { detailUrl?: string };

export async function searchRegulationsAction(
  params: {
    keyword?: string;
    fgmc?: string;
    xljb_1?: string;
    sxx?: string;
    top_k?: number;
    matterId?: string;
  }
): Promise<{ total: number; items: RegulationSearchHit[] }> {
  const session = await requireSession("matters.write");
  const data = z.object({
    keyword: z.string().trim().max(1000).optional(),
    fgmc: z.string().trim().max(300).optional(),
    xljb_1: z.string().trim().max(100).optional(),
    sxx: z.enum(["现行有效", "失效", "已被修改", "部分失效", "尚未生效"]).optional(),
    top_k: z.number().int().min(1).max(50).default(10),
    matterId: z.string().cuid().optional()
  }).parse(params);
  if (!data.keyword && !data.fgmc && !data.xljb_1 && !data.sxx) throw new ActionError("请填写检索条件");
  if (data.matterId) {
    await assertCanReadMatter(session.user.id, session.user.role, data.matterId, session.user.rolePermissions);
  }

  const settings = await getYuandianSettings();
  if (!settings.configured) throw new YuandianNotConfiguredError();

  const { matterId, ...searchParams } = data;
  const res = await searchRegulations(searchParams, settings, session.user.id);

  await auditStrict({
    userId: session.user.id,
    action: "YUANDIAN_REGULATION_SEARCH",
    targetType: matterId ? "Matter" : "SystemSetting",
    targetId: matterId ?? "yuandianSettings",
    detail: {
      keywordLength: searchParams.keyword?.length ?? 0,
      titleLength: searchParams.fgmc?.length ?? 0,
      xljb_1: searchParams.xljb_1,
      sxx: searchParams.sxx,
      total: res.total,
      hits: res.items.length
    }
  });

  return res;
}
