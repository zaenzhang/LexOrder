"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/action-error";
import { canReadDocument } from "@/lib/approvals/documents";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { resolveRoleUser } from "@/lib/roles/service";
import { matterAssociationFilter } from "@/lib/permissions";

/** Exact-version detail shared with the matter shell; no raw file path or extracted text. */
export async function getDocumentDetail(matterId: string, documentId: string) {
  const session = await requireSession("personal");
  const id = z.string().cuid().parse(documentId);
  const expectedMatterId = z.string().cuid().parse(matterId);
  return prisma.$transaction(async db => {
    const document = await db.document.findUnique({ where: { id }, select: {
      id: true, name: true, version: true, familyId: true, isLatest: true, mimeType: true, status: true,
      createdAt: true, uploadedById: true, matterId: true, intakeId: true, deletedAt: true,
      matter: { select: { status: true, deletedAt: true } }, uploadedBy: { select: { name: true } },
    } });
    if (!document || document.matterId !== expectedMatterId || document.deletedAt || document.matter?.deletedAt || !await canReadDocument(session.user.id, document, db)) {
      throw new ActionError("此文书版本不存在、已撤回或无权读取");
    }
    const identity = await db.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { role: true } });
    const role = await resolveRoleUser(session.user.id, identity.role, db);
    const associated = document.matterId ? Boolean(await db.matter.count({ where: { id: document.matterId, deletedAt: null,
      ...(role.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(session.user.id)) } })) : document.uploadedById === session.user.id;
    const editable = role.enabled && associated && document.matter?.status !== "ARCHIVED" && hasCustomPermission(role, "documents.write");
    const family = document.familyId ? await db.document.findMany({ where: { deletedAt: null, matterId: document.matterId, familyId: document.familyId }, orderBy: { version: "desc" },
      select: { id: true, name: true, version: true, isLatest: true, status: true, uploadedById: true, matterId: true, intakeId: true } }) : [document];
    const versions: { id: string; name: string; version: number; isLatest: boolean; status: string }[] = [];
    for (const row of family) if (await canReadDocument(session.user.id, row, db)) versions.push({ id: row.id, name: row.name, version: row.version, isLatest: row.isLatest, status: row.status });
    return { id: document.id, name: document.name, version: document.version, isLatest: document.isLatest, status: document.status,
      mimeType: document.mimeType, createdAt: document.createdAt.toISOString(), uploadedByName: document.uploadedBy.name, versions, hasVersionFamily: Boolean(document.familyId),
      canUploadVersion: editable && document.isLatest, canSubmit: editable && document.status === "DRAFT" && document.uploadedById === session.user.id,
      canFile: editable && document.status === "APPROVED",
      canPrepareDelivery: Boolean(document.matterId && associated && document.matter?.status !== "ARCHIVED" && hasCustomPermission(role, "matters.export") && hasCustomPermission(role, "matters.write") && hasCustomPermission(role, "documents.download")),
    };
  }, { timeout: 20000 });
}
