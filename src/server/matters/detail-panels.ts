"use server";

import { nullableDecimalToNumber } from "@/lib/decimal";
import { canReadDocument } from "@/lib/approvals/documents";
import { requireSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/action-error";
import { assertCanReadMatter, hasMatterBusinessAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { getMatterReviewSummary } from "@/server/ai/matter-review-summary";
import { getMatterFinance } from "@/server/finance/actions";

async function requireMatterPanelAccess(matterId: string) {
  const { user } = await requireSession("matters.read");
  await assertCanReadMatter(user.id, user.role, matterId, user.rolePermissions);
  if (!await hasMatterBusinessAccess(user.id, user.role, matterId, user.rolePermissions)) {
    throw new ActionError("无权查看此案件的业务资料");
  }
  return user;
}

export async function loadMatterMaterials(matterId: string) {
  const user = await requireMatterPanelAccess(matterId);
  const canRead = hasCustomPermission(user, "documents.read");
  const canWrite = hasCustomPermission(user, "documents.write");
  if (!canRead && !canWrite) throw new ActionError("无权查看此案件的材料");
  const matter = await prisma.matter.findFirst({
    where: { id: matterId, deletedAt: null },
    select: { category: true }
  });
  if (!matter) throw new ActionError("案件不存在");

  const [candidates, folders, templates] = await Promise.all([
    canRead ? prisma.document.findMany({
      where: { matterId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, category: true, mimeType: true, size: true, createdAt: true, updatedAt: true,
        matterId: true, intakeId: true, procedureId: true, stageId: true, folderId: true, templateId: true,
        uploadedById: true, sourceParty: true, sourceOrigin: true, tags: true,
        ocrStatus: true, textSource: true, pageCount: true, sha256: true,
        version: true, familyId: true, isLatest: true, status: true, archiveChecklistItemId: true,
        uploadedBy: { select: { id: true, name: true } },
        procedure: { select: { id: true, type: true, customLabel: true } }
      }
    }) : Promise.resolve([]),
    // v0.8: 卷宗
    canRead ? prisma.documentFolder.findMany({
      where: { matterId },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, orderIndex: true, isDefault: true }
    }) : Promise.resolve([]),
    // v0.8: 适用本案件类别的模板
    prisma.documentTemplate.findMany({
      where: {
        enabled: true,
        OR: [
          { applicableCategories: { isEmpty: true } },
          { applicableCategories: { has: matter.category } }
        ]
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
        applicableCategories: true,
        variables: true,
        isBuiltIn: true
      }
    }),
  ]);
  // Retain each authorized concrete version, including older versions.
  const [readable, reviewSummary] = await Promise.all([
    Promise.all(candidates.map(document => canReadDocument(user.id, document))),
    canRead ? getMatterReviewSummary(matterId) : null,
  ]);
  return {
    documents: candidates.filter((_, index) => readable[index]),
    folders,
    templates: templates.map(template => ({
      ...template,
      variables: Array.isArray(template.variables) ? template.variables as string[] : []
    })),
    reviewSummary
  };
}

export async function loadMatterDetailFinance(matterId: string) {
  const user = await requireMatterPanelAccess(matterId);
  if (!hasCustomPermission(user, "finance.read")) throw new ActionError("无权查看此案件的财务");
  const finance = await getMatterFinance(matterId);
  const matter = await prisma.matter.findFirst({
    where: { id: matterId, deletedAt: null },
    select: { intake: { select: {
      feeType: true,
      feeAmount: true,
      feeSchedule: true,
      feeNote: true,
      contingencyTerms: true,
    } } },
  });
  const intake = matter?.intake;
  return { ...finance, intakeFees: intake ? { ...intake, feeAmount: nullableDecimalToNumber(intake.feeAmount) } : null };
}
