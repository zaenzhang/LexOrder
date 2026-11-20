"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/action-error";
import { canReadDocument } from "@/lib/approvals/documents";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { resolveRoleUser } from "@/lib/roles/service";
import { matterAssociationFilter } from "@/lib/permissions";
import { archiveSnapshotDocumentIds } from "@/lib/archive/snapshot";
import { readDocumentContextInputs } from "@/server/matters/context-inputs";

/** Exact-version detail shared with the matter shell; no raw file path or extracted text. */
export async function getDocumentDetail(matterId: string, documentId: string) {
  const session = await requireSession("personal");
  const id = z.string().cuid().parse(documentId);
  const expectedMatterId = z.string().cuid().parse(matterId);
  return prisma.$transaction(async db => {
    const document = await db.document.findUnique({ where: { id }, select: {
      id: true, name: true, version: true, familyId: true, isLatest: true, mimeType: true, status: true, tags: true,
      reviewReportFor: { select: { id: true, documentId: true } },
      folder: { select: { name: true } },
      createdAt: true, updatedAt: true, uploadedById: true, matterId: true, intakeId: true, deletedAt: true,
      matter: { select: { status: true, deletedAt: true, ownerId: true, members: { where: { userId: session.user.id }, select: { role: true } } } }, uploadedBy: { select: { name: true } },
    } });
    if (!document || document.matterId !== expectedMatterId || document.deletedAt || document.matter?.deletedAt || !await canReadDocument(session.user.id, document, db)) {
      throw new ActionError("此文书版本不存在、已撤回或无权读取");
    }
    const identity = await db.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { role: true } });
    const role = await resolveRoleUser(session.user.id, identity.role, db);
    const associated = document.matterId ? Boolean(await db.matter.count({ where: { id: document.matterId, deletedAt: null,
      ...(role.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(session.user.id)) } })) : document.uploadedById === session.user.id;
    const editable = role.enabled && associated && document.matter?.status !== "ARCHIVED" && hasCustomPermission(role, "documents.write");
    const filingAssociated = document.matterId && role.role === "PRINCIPAL_LAWYER"
      ? Boolean(await db.matter.count({ where: { id: document.matterId, deletedAt: null, ...matterAssociationFilter(session.user.id) } }))
      : associated;
    const frozenRows = document.intakeId ? await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "IntakeRevision"
      WHERE "intakeId"=${document.intakeId} AND snapshot->'documents' @> ${JSON.stringify([{ id: document.id }])}::jsonb` : [];
    const frozen = Number(frozenRows[0]?.count ?? 0) > 0;
    const lead = document.matter?.ownerId === session.user.id || Boolean(document.matter?.members?.some(member => member.role === "LEAD" || member.role === "CO_LEAD"));
    const mayWithdraw = editable && filingAssociated && !frozen && (document.uploadedById === session.user.id || lead);
    const pendingArchives = mayWithdraw ? await db.archiveRecord.findMany({ where: { matterId: expectedMatterId, status: "PENDING_REVIEW" }, select: { checklistJson: true } }) : [];
    const inPendingArchive = pendingArchives.some(archive => archiveSnapshotDocumentIds(archive.checklistJson).includes(document.id));
    const family = document.familyId ? await db.document.findMany({ where: { deletedAt: null, matterId: document.matterId, familyId: document.familyId }, orderBy: { version: "desc" },
      select: { id: true, name: true, version: true, isLatest: true, status: true, mimeType: true, uploadedById: true, matterId: true, intakeId: true } }) : [document];
    const versions: { id: string; name: string; version: number; isLatest: boolean; status: string; mimeType: string | null }[] = [];
    for (const row of family) if (await canReadDocument(session.user.id, row, db)) versions.push({ id: row.id, name: row.name, version: row.version, isLatest: row.isLatest, status: row.status, mimeType: row.mimeType });
    return { id: document.id, name: document.name, version: document.version, isLatest: document.isLatest, status: document.status,
      contextInputs: await readDocumentContextInputs(db, session.user.id, document.id, document.matterId),
      mimeType: document.mimeType, createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt, uploadedByName: document.uploadedBy.name,
      folderName: document.folder?.name ?? null, reviewSourceId: document.reviewReportFor?.documentId ?? null, versions, hasVersionFamily: Boolean(document.familyId),
      canUploadVersion: editable && filingAssociated && !frozen && document.isLatest && !document.tags.includes("AI审查") && !document.reviewReportFor,
      canWithdraw: mayWithdraw && !inPendingArchive,
      withdrawBlockedReason: mayWithdraw && inPendingArchive ? "此版本已列入待审归档申请，暂不能撤回。" : null,
      canSubmit: editable && filingAssociated && !frozen && document.status === "DRAFT" && document.uploadedById === session.user.id,
      canFile: editable && filingAssociated && !frozen && document.status === "APPROVED",
      canPrepareDelivery: Boolean(document.matterId && associated && document.matter?.status !== "ARCHIVED" && hasCustomPermission(role, "matters.export") && hasCustomPermission(role, "matters.write") && hasCustomPermission(role, "documents.download")),
    };
  }, { timeout: 20000 });
}
