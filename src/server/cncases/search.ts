"use server";

import { requireSession } from "@/lib/auth/session";
import { searchLocalJudgments } from "@/lib/cncases/client";
import { assertCanReadMatter } from "@/lib/permissions";
import { z } from "zod";
import { auditStrict } from "@/server/audit";

export type LocalJudgmentSearchActionResult = {
  available: boolean;
  total: number;
  items: { title: string; href?: string; meta?: string }[];
  message?: string;
};

/** 用户提供的关键词仅发往部署方显式配置的裁判文书服务。 */
export async function searchLocalJudgmentsAction(
  query: string,
  opts: { max?: number; matterId?: string } = {}
): Promise<LocalJudgmentSearchActionResult> {
  const session = await requireSession("matters.write");
  const data = z.object({
    query: z.string().trim().min(1, "请输入检索关键词").max(1000),
    max: z.number().int().min(1).max(50).default(20),
    matterId: z.string().cuid().optional()
  }).parse({ ...opts, query });
  if (data.matterId) {
    await assertCanReadMatter(session.user.id, session.user.role, data.matterId, session.user.rolePermissions);
  }
  const res = await searchLocalJudgments(data.query, data.max);

  await auditStrict({
    userId: session.user.id,
    action: "CNCASES_LOCAL_JUDGMENT_SEARCH",
    targetType: data.matterId ? "Matter" : "SystemSetting",
    targetId: data.matterId ?? "cncases",
    detail: { queryLength: data.query.length, available: res.available, total: res.total, hits: res.items.length }
  });

  return res;
}
