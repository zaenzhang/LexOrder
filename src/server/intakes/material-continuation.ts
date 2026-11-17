import { prisma } from "@/lib/prisma";
import { canReadDocument } from "@/lib/approvals/documents";
import { hasMatterBusinessAccess, intakeReadVisibilityFilter } from "@/lib/permissions";
import { resolveRoleUser } from "@/lib/roles/service";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { matterHref } from "@/lib/matters/route";
import { procedureTypeLabel } from "@/lib/enums";

export type IntakeMaterialContinuation =
  | { status: "AVAILABLE"; intakeHref: string | null; empty: boolean; unassigned: boolean; targets: { href: string; label: string }[] }
  | { status: "DENIED" | "UNAVAILABLE"; intakeHref: string | null };

/** Optional navigation only. It must not turn a committed conversion or a readable intake into a failure. */
export async function readIntakeMaterialContinuation(userId: string, intakeId: string, matterId: string): Promise<IntakeMaterialContinuation> {
  let intakeHref: string | null = null;
  try {
    const identity = await prisma.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
    if (!identity?.active) return { status: "DENIED", intakeHref };
    const actor = await resolveRoleUser(userId, identity.role);
    if (!actor.enabled || !hasCustomPermission(actor, "matters.read")) return { status: "DENIED", intakeHref };

    const readableIntake = await prisma.intake.findFirst({
      where: { id: intakeId, ...intakeReadVisibilityFilter(userId, actor.role, actor.rolePermissions) }, select: { id: true },
    });
    if (readableIntake) intakeHref = `/intakes/${encodeURIComponent(intakeId)}`;
    if (!hasCustomPermission(actor, "documents.read") || !await hasMatterBusinessAccess(userId, actor.role, matterId, actor.rolePermissions)) {
      return { status: "DENIED", intakeHref };
    }
    const matter = await prisma.matter.findFirst({
      where: { id: matterId, intakeId, deletedAt: null }, select: { id: true, internalCode: true },
    });
    if (!matter) return { status: "DENIED", intakeHref };

    const documents = await prisma.document.findMany({
      where: { intakeId, matterId, deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true, uploadedById: true, intakeId: true, matterId: true, deletedAt: true, procedureId: true, stageId: true,
        procedure: { select: { id: true, matterId: true, type: true, customLabel: true, caseNumber: true } },
      },
    });
    const targets = new Map<string, { href: string; label: string }>();
    let readableCount = 0;
    for (const document of documents) {
      if (!await canReadDocument(userId, document)) continue;
      readableCount++;
      if (document.stageId !== null) continue;
      const query = new URLSearchParams({ view: "work", workPane: "materials", stage: "unassigned" });
      if (document.procedureId === null) {
        targets.set("unassigned", { href: matterHref(matter, `?${query}`), label: "未归属程序材料" });
      } else if (document.procedure?.id === document.procedureId && document.procedure.matterId === matterId) {
        query.set("procedure", document.procedureId);
        const label = [document.procedure.customLabel || procedureTypeLabel[document.procedure.type], document.procedure.caseNumber].filter(Boolean).join(" · ");
        targets.set(document.procedureId, { href: matterHref(matter, `?${query}`), label: `${label} · 未归属环节材料` });
      }
    }
    return {
      status: "AVAILABLE", intakeHref, empty: readableCount === 0, unassigned: targets.size > 0,
      targets: targets.size ? [...targets.values()] : [{ href: matterHref(matter, "?view=work&workPane=materials"), label: "查看全案材料" }],
    };
  } catch {
    // No target is inferred from a failed read; only an independently verified intake link survives.
    return { status: "UNAVAILABLE", intakeHref };
  }
}
