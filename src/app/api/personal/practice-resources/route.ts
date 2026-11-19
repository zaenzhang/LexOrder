import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { requireSession } from "@/lib/auth/session";
import { matterCategoryLabel } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { reportAccess } from "@/lib/roles/report-scope";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import {
  listTemplatesForAdmin,
  toggleTemplate,
  uploadDocumentTemplate,
} from "@/server/document-templates/actions";
import {
  getFirmFileVersionHistory,
  listFirmFiles,
  uploadFirmFile,
} from "@/server/firm-files/actions";
import { getReportData } from "@/server/reports/queries";
import { resolveReportPeriod } from "@/server/reports/resolve-period";
import { listAuditLogs } from "@/server/settings/actions";
import { updateMyProfile } from "@/server/users/profile-actions";
import { personalProfileSchema } from "@/server/users/profile-schema";
import { ProfileInputError } from "@/server/users/profile-service";

const headers = { "Cache-Control": "no-store" };
const category = z.enum([
  "GUIDE",
  "TEMPLATE",
  "REFERENCE",
  "POLICY",
  "CONTRACT",
  "LETTER",
  "LICENSE",
  "OTHER_FIRM",
]);
async function read(query: URLSearchParams) {
  switch (query.get("view")) {
    case "resources":
      return listFirmFiles({
        search: z
          .string()
          .max(120)
          .parse(query.get("q") ?? ""),
        category: query.get("category")
          ? category.parse(query.get("category"))
          : undefined,
        includeSuperseded: query.get("old") === "1",
      });
    case "history":
      return getFirmFileVersionHistory({ id: z.cuid().parse(query.get("id")) });
    case "templates":
      return listTemplatesForAdmin();
    case "audit": {
      const { items } = await listAuditLogs({
        days: 30,
        limit: 100,
        action: query.get("q") || undefined,
      });
      return items.map(({ id, action, targetType, user, createdAt }) => ({
        id,
        action,
        targetType,
        author: user?.name,
        createdAt,
      }));
    }
    case "profile": {
      const { user } = await requireSession("personal");
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { name: true, email: true, phone: true, updatedAt: true },
      });
      return {
        ...row,
        email: row.email.endsWith("@personal.invalid") ? "" : row.email,
      };
    }
    case "reports": {
      const { user } = await requireSession("reports.read");
      const { period } = resolveReportPeriod({
        period: z
          .enum(["month", "quarter", "year", "lastYear"])
          .parse(query.get("period") ?? "month"),
      });
      const { kpis, byCategory, byClientReceivable, byClientSource } =
        await getReportData(period, reportAccess(user));
      return {
        label: period.label,
        kpis,
        byCategory: byCategory.map((row) => ({
          name: matterCategoryLabel[row.category],
          count: row.count,
        })),
        byClientReceivable,
        byClientSource,
      };
    }
    default:
      throw new ActionError("未知业务页面。");
  }
}
async function handle(request: Request) {
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(request.headers, { method: request.method }))
    return new Response(null, { status: 403, headers });
  try {
    if (request.method === "GET")
      return json(await read(new URL(request.url).searchParams));
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data;")
    ) {
      const form = await request.formData();
      const action = z
        .enum(["upload-resource", "upload-template"])
        .parse(form.get("action"));
      return json(
        action === "upload-template"
          ? await uploadDocumentTemplate(form)
          : await uploadFirmFile(form),
      );
    }
    const input = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("toggle-template"),
          id: z.cuid(),
          enabled: z.boolean(),
        }),
        z.object({
          action: z.literal("profile"),
          profile: personalProfileSchema.omit({ currentPassword: true }),
        }),
      ])
      .parse(await request.json().catch(() => null));
    return json(
      input.action === "profile"
        ? await updateMyProfile(input.profile)
        : await toggleTemplate(input),
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues.map((x) => x.message).join("；") },
        400,
      );
    if (error instanceof ProfileInputError || error instanceof ActionError)
      return json({ error: error.message }, 409);
    throw error;
  }
}
export { handle as GET, handle as POST };
