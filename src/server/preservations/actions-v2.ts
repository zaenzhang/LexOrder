"use server";
import { roleMutation, checkRoleMutation, resolveRoleUser } from "@/lib/roles/service";
import { scopeFor } from "@/lib/roles/catalog";
import { isManager } from "@/lib/permissions";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit, auditTx } from "@/server/audit";
import { assertMatterWritable } from "@/lib/archive/guard";
import { serializeDecimals } from "@/lib/decimal";
import { assertCanAssociateMatter, matterAssociationFilter } from "@/lib/permissions";
import {
  caseCreateSchema,
  caseUpdateSchema,
  caseListFilterSchema,
  targetCreateSchema,
  targetUpdateSchema,
  propertyCreateSchema,
  propertyUpdateSchema,
  propertyRenewSchema,
  deleteSchema,
} from "./schemas-v2";
import { revalidateMatter } from "@/server/matters/route";
import { voidPendingPreservation } from "@/server/reminders/delivery";
import { ActionError } from "@/lib/action-error";
import { lockWritableMatters } from "@/server/matters/write-access";

// ━━━━ Read ━━━━

export async function listPreservationCases(input?: z.input<typeof caseListFilterSchema>) {
  const session = await requireSession("matters.read");
  const filter = caseListFilterSchema.parse(input ?? {});

  const accessWhere: Prisma.PreservationCaseWhereInput = {
    OR: [
      { matter: { deletedAt: null, ...matterAssociationFilter(session.user.id) } },
      { matterId: null, ownerId: session.user.id }
    ]
  };
  const where: Prisma.PreservationCaseWhereInput = { AND: [accessWhere] };
  if (filter.status !== "ALL") where.status = filter.status;
  if (filter.matterId) where.matterId = filter.matterId;
  if (filter.search) {
    where.AND = [
      accessWhere,
      {
        OR: [
          { court: { contains: filter.search, mode: "insensitive" } },
          { rulingNumber: { contains: filter.search, mode: "insensitive" } },
          { matter: { title: { contains: filter.search, mode: "insensitive" } } },
          { targets: { some: { name: { contains: filter.search, mode: "insensitive" } } } },
        ]
      }
    ];
  }

  const rows = await prisma.preservationCase.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      matter: { select: { id: true, internalCode: true, title: true } },
      owner: { select: { id: true, name: true } },
      targets: {
        include: {
          properties: {
            orderBy: { expiryDate: "asc" },
            include: {
              renewals: { orderBy: { renewedAt: "desc" }, take: 3 }
            }
          }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });
  return serializeDecimals(rows);
}

type PreservationCaseAccess = {
  id: string;
  matterId: string | null;
  ownerId: string | null;
};

async function assertCanAccessPreservationCaseRecord(
  userId: string,
  record: PreservationCaseAccess
) {
  if (record.matterId) {
    await assertCanAssociateMatter(userId, record.matterId);
    return;
  }
  if (record.ownerId !== userId) throw new ActionError("无权操作此保全记录");
}

async function assertCanAccessPreservationCase(userId: string, id: string) {
  const record = await prisma.preservationCase.findUnique({
    where: { id },
    select: { id: true, matterId: true, ownerId: true }
  });
  if (!record) throw new ActionError("保全案件不存在");
  await assertCanAccessPreservationCaseRecord(userId, record);
  return record;
}

// ━━━━ Case CRUD ━━━━

async function assertStandaloneOwner(tx: Prisma.TransactionClient, matterId: string | null, ownerId: string | null) {
  if (matterId) return;
  if (!ownerId) throw new ActionError("未关联案件的保全必须指定跟进负责人");
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR SHARE`;
  const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { active: true, role: true } });
  if (!owner?.active) throw new ActionError("跟进负责人已停用或不存在，请重新选择");
  const role = await resolveRoleUser(ownerId, owner.role, tx);
  if (!role.enabled || (owner.role === "CUSTOM" && !scopeFor(role, "matters.read"))) {
    throw new ActionError("跟进负责人当前无权读取保全，请重新选择");
  }
}

export async function createPreservationCase(input: z.infer<typeof caseCreateSchema>) {
  const session = await requireSession("matters.write");
  const data = caseCreateSchema.parse(input);

  const created = await prisma.$transaction(async tx => {
    await lockWritableMatters(tx, session.user, "matters.write", data.matterId ? [data.matterId] : []);
    await assertStandaloneOwner(tx, data.matterId ?? null, data.ownerId ?? null);
    const record = await tx.preservationCase.create({
    data: {
      matterId: data.matterId ?? null,
      type: data.type,
      court: data.court?.trim() || null,
      rulingNumber: data.rulingNumber?.trim() || null,
      guaranteeType: data.guaranteeType ?? null,
      appliedAt: data.appliedAt ?? null,
      note: data.note?.trim() || null,
      ownerId: data.ownerId ?? null,
      remindDays: data.remindDays,
      status: "ACTIVE",
      // Create first target + property inline if provided
      targets: data.firstTarget?.trim() ? {
        create: {
          name: data.firstTarget.trim(),
          properties: data.firstPropertyType ? {
            create: {
              propertyType: data.firstPropertyType,
              propertyDetail: data.firstPropertyDetail?.trim() || null,
              amount: data.firstAmount != null ? new Prisma.Decimal(data.firstAmount) : null,
              startDate: data.firstStartDate ?? new Date(),
              duration: data.firstDuration ?? 365,
              expiryDate: data.firstExpiryDate ?? new Date(Date.now() + 365 * 86400000),
              status: "ACTIVE"
            }
          } : undefined
        }
      } : undefined
    },
    select: { id: true, matterId: true }
    });
    await auditTx(tx, {
      userId: session.user.id,
      action: "PRESERVATION_CASE_CREATE",
      targetType: "PreservationCase",
      targetId: record.id,
      detail: { type: data.type }
    });
    return record;
  }, { maxWait: 10000, timeout: 20000 });

  revalidatePath("/preservation");
  if (created.matterId) await revalidateMatter(created.matterId);
  return { ok: true, id: created.id };
}

export async function updatePreservationCase(input: z.infer<typeof caseUpdateSchema>) {
  const session = await requireSession("matters.write");
  const data = caseUpdateSchema.parse(input);
  const reference = await prisma.preservationCase.findUnique({ where: { id: data.id }, select: { matterId: true } });
  if (!reference) throw new ActionError("保全案件不存在");
  const result = await prisma.$transaction(async tx => {
    const matterIds = [reference.matterId, data.matterId].filter((id): id is string => !!id);
    await lockWritableMatters(tx, session.user, "matters.write", matterIds);
    await tx.$queryRaw`SELECT id FROM "PreservationCase" WHERE id = ${data.id} FOR UPDATE`;
    const existing = await tx.preservationCase.findUnique({ where: { id: data.id } });
    if (!existing) throw new ActionError("保全案件不存在");
    if (existing.matterId !== reference.matterId || existing.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
      throw new ActionError("保全记录已变化，请关闭后重新打开并核对");
    }
    if (!existing.matterId && existing.ownerId !== session.user.id) throw new ActionError("无权操作此保全记录");
    const matterId = data.matterId === undefined ? existing.matterId : data.matterId;
    const ownerId = data.ownerId === undefined ? existing.ownerId : data.ownerId;
    await assertStandaloneOwner(tx, matterId, ownerId);

    const patch: Prisma.PreservationCaseUncheckedUpdateManyInput = {};
    if (matterId !== existing.matterId) patch.matterId = matterId;
    if (ownerId !== existing.ownerId) patch.ownerId = ownerId;
    if (data.type !== undefined && data.type !== existing.type) patch.type = data.type;
    for (const field of ["court", "rulingNumber", "note"] as const) {
      if (data[field] !== undefined) {
        const value = data[field]?.trim() || null;
        if (value !== existing[field]) patch[field] = value;
      }
    }
    if (data.guaranteeType !== undefined && data.guaranteeType !== existing.guaranteeType) patch.guaranteeType = data.guaranteeType;
    if (data.appliedAt !== undefined && data.appliedAt?.getTime() !== existing.appliedAt?.getTime()) patch.appliedAt = data.appliedAt;
    if (data.remindDays !== undefined) {
      const before = [...new Set(existing.remindDays)].sort((a, b) => a - b);
      const after = [...new Set(data.remindDays)].sort((a, b) => a - b);
      if (before.length !== after.length || before.some((day, index) => day !== after[index])) patch.remindDays = after;
    }
    const changedFields = Object.keys(patch);
    if (!changedFields.length) return { changed: false, matterIds };
    patch.updatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1));
    const updated = await tx.preservationCase.updateMany({
      where: { id: data.id, updatedAt: existing.updatedAt }, data: patch,
    });
    if (updated.count !== 1) throw new ActionError("保全记录已变化，请关闭后重新打开并核对");
    if (changedFields.some(field => ["matterId", "ownerId", "remindDays"].includes(field))) {
      const properties = await tx.preservationProperty.findMany({ where: { target: { caseId: data.id } }, select: { id: true } });
      await voidPendingPreservation(properties.map(property => property.id), "SUPERSEDED", "CASE_MUTATED", tx);
    }
    await auditTx(tx, {
      userId: session.user.id, action: "PRESERVATION_CASE_UPDATE", targetType: "PreservationCase", targetId: data.id,
      detail: { changedFields, previousMatterId: existing.matterId, matterId, previousOwnerId: existing.ownerId, ownerId },
    });
    return { changed: true, matterIds: [existing.matterId, matterId].filter((id): id is string => !!id) };
  }, { maxWait: 10000, timeout: 20000 });

  if (result.changed) {
    revalidatePath("/preservation");
    for (const matterId of new Set(result.matterIds)) await revalidateMatter(matterId);
  }
  return { ok: true };
}

export async function deletePreservationCase(input: z.infer<typeof deleteSchema>) {
  const session = await requireSession("matters.write");
  const data = deleteSchema.parse(input);
  if (!isManager(session.user)) {
    throw new ActionError("仅主任律师可删除保全记录");
  }

  const cs = await assertCanAccessPreservationCase(session.user.id, data.id);
  if (cs.matterId) await assertMatterWritable(cs.matterId);

  await roleMutation(session.user, "matters.write", async roleDb => roleDb.preservationCase.delete({ where: { id: data.id } }));

  await audit({
    userId: session.user.id,
    action: "PRESERVATION_CASE_DELETE",
    targetType: "PreservationCase",
    targetId: data.id
  });

  revalidatePath("/preservation");
  if (cs.matterId) await revalidateMatter(cs.matterId);
  return { ok: true };
}

// ━━━━ Target CRUD ━━━━

export async function addTarget(input: z.infer<typeof targetCreateSchema>) {
  const session = await requireSession("matters.write");
  const data = targetCreateSchema.parse(input);

  const cs = await assertCanAccessPreservationCase(session.user.id, data.caseId);
  if (cs.matterId) await assertMatterWritable(cs.matterId);

  const created = await roleMutation(session.user, "matters.write", async roleDb => roleDb.preservationTarget.create({
    data: { caseId: data.caseId, name: data.name.trim(), note: data.note?.trim() || null }
  }));

  revalidatePath("/preservation");
  if (cs.matterId) await revalidateMatter(cs.matterId);
  return { ok: true, id: created.id };
}

export async function updateTarget(input: z.infer<typeof targetUpdateSchema>) {
  const session = await requireSession("matters.write");
  const data = targetUpdateSchema.parse(input);
  const target = await prisma.preservationTarget.findUnique({
    where: { id: data.id },
    include: { case: { select: { id: true, matterId: true, ownerId: true } } }
  });
  if (!target) throw new ActionError("被保全人不存在");
  await assertCanAccessPreservationCaseRecord(session.user.id, target.case);
  if (target.case.matterId) await assertMatterWritable(target.case.matterId);

  const patch: Prisma.PreservationTargetUpdateInput = {};
  if (data.name !== undefined) patch.name = data.name.trim();
  if (data.note !== undefined) patch.note = data.note?.trim() || null;
  await roleMutation(session.user, "matters.write", async roleDb => roleDb.preservationTarget.update({ where: { id: data.id }, data: patch }));
  revalidatePath("/preservation");
  return { ok: true };
}

export async function deleteTarget(id: string) {
  const session = await requireSession("matters.write");
  const target = await prisma.preservationTarget.findUnique({
    where: { id },
    include: { case: { select: { id: true, matterId: true, ownerId: true } } }
  });
  if (!target) throw new ActionError("被保全人不存在");
  await assertCanAccessPreservationCaseRecord(session.user.id, target.case);
  if (target.case.matterId) await assertMatterWritable(target.case.matterId);

  await roleMutation(session.user, "matters.write", async roleDb => roleDb.preservationTarget.delete({ where: { id } }));
  revalidatePath("/preservation");
  return { ok: true };
}

// ━━━━ Property CRUD ━━━━

export async function addProperty(input: z.infer<typeof propertyCreateSchema>) {
  const session = await requireSession("matters.write");
  const data = propertyCreateSchema.parse(input);
  if (data.expiryDate <= data.startDate) throw new ActionError("到期日期必须晚于生效日期");

  const target = await prisma.preservationTarget.findUnique({
    where: { id: data.targetId },
    include: { case: { select: { id: true, matterId: true, ownerId: true } } }
  });
  if (!target) throw new ActionError("被保全人不存在");
  await assertCanAccessPreservationCaseRecord(session.user.id, target.case);
  if (target.case.matterId) await assertMatterWritable(target.case.matterId);

  const created = await roleMutation(session.user, "matters.write", async roleDb => roleDb.preservationProperty.create({
    data: {
      targetId: data.targetId,
      propertyType: data.propertyType,
      propertyDetail: data.propertyDetail?.trim() || null,
      amount: data.amount != null ? new Prisma.Decimal(data.amount) : null,
      startDate: data.startDate,
      duration: data.duration,
      expiryDate: data.expiryDate,
      status: "ACTIVE"
    }
  }));

  await audit({
    userId: session.user.id,
    action: "PRESERVATION_PROPERTY_CREATE",
    targetType: "PreservationProperty",
    targetId: created.id,
    detail: { propertyType: data.propertyType }
  });

  revalidatePath("/preservation");
  if (target.case.matterId) await revalidateMatter(target.case.matterId);
  return { ok: true, id: created.id };
}

export async function updateProperty(input: z.infer<typeof propertyUpdateSchema>) {
  const session = await requireSession("matters.write");
  const data = propertyUpdateSchema.parse(input);
  const { id, amount, propertyDetail } = data;
  const property = await prisma.preservationProperty.findUnique({
    where: { id },
    include: { target: { include: { case: { select: { id: true, matterId: true, ownerId: true } } } } }
  });
  if (!property) throw new ActionError("保全财产不存在");
  await assertCanAccessPreservationCaseRecord(session.user.id, property.target.case);
  if (property.target.case.matterId) await assertMatterWritable(property.target.case.matterId);

  const patch: Prisma.PreservationPropertyUpdateInput = {};
  if (amount !== undefined) patch.amount = amount != null ? new Prisma.Decimal(amount) : null;
  if (propertyDetail !== undefined) patch.propertyDetail = propertyDetail?.trim() || null;
  if (data.propertyType !== undefined) patch.propertyType = data.propertyType;

  await roleMutation(session.user, "matters.write", async roleDb => roleDb.preservationProperty.update({ where: { id }, data: patch }));

  await audit({
    userId: session.user.id,
    action: "PRESERVATION_PROPERTY_UPDATE",
    targetType: "PreservationProperty",
    targetId: id,
    detail: { fields: Object.keys(patch) }
  });
  revalidatePath("/preservation");
  return { ok: true };
}

export async function renewProperty(input: z.infer<typeof propertyRenewSchema>) {
  const session = await requireSession("matters.write");
  const data = propertyRenewSchema.parse(input);

  const prop = await prisma.preservationProperty.findUnique({
    where: { id: data.propertyId },
    include: { target: { include: { case: { select: { id: true, matterId: true, ownerId: true } } } } }
  });
  if (!prop) throw new ActionError("保全财产不存在");
  await assertCanAccessPreservationCaseRecord(session.user.id, prop.target.case);
  if (prop.status === "LIFTED") throw new ActionError("已解除的保全不可续保");
  if (prop.target.case.matterId) await assertMatterWritable(prop.target.case.matterId);
  if (data.newExpiryDate <= prop.expiryDate) {
    throw new ActionError("新到期日必须晚于原到期日");
  }

  await prisma.$transaction(async db => {
    await checkRoleMutation(db, session.user, "matters.write");
    await db.preservationPropertyRenewal.create({
      data: {
        propertyId: data.propertyId,
        renewedAt: new Date(),
        oldExpiryDate: prop.expiryDate,
        newExpiryDate: data.newExpiryDate,
        renewalDuration: data.renewalDuration,
        note: data.note?.trim() || null,
        performedById: session.user.id
      }
    });
    await db.preservationProperty.update({
      where: { id: data.propertyId },
      data: { expiryDate: data.newExpiryDate, status: "RENEWED" }
    });
    // F-1 阶段一：续封改期后旧档位登记全部作废（到期日变了，旧档位提醒失效）
    await voidPendingPreservation([data.propertyId], "SUPERSEDED", "RENEWED", db);
  });

  revalidatePath("/preservation");
  if (prop.target.case.matterId) await revalidateMatter(prop.target.case.matterId);
  return { ok: true };
}

export async function liftProperty(propertyId: string) {
  const session = await requireSession("matters.write");
  const prop = await prisma.preservationProperty.findUnique({
    where: { id: propertyId },
    include: { target: { include: { case: { select: { id: true, matterId: true, ownerId: true } } } } }
  });
  if (!prop) throw new ActionError("保全财产不存在");
  await assertCanAccessPreservationCaseRecord(session.user.id, prop.target.case);
  if (prop.target.case.matterId) await assertMatterWritable(prop.target.case.matterId);

  await roleMutation(session.user, "matters.write", async roleDb => {
    await roleDb.preservationProperty.update({
      where: { id: propertyId },
      data: {
        status: "LIFTED",
      }
    });
    // F-1 阶段一：解除后不再有续封提醒，残余 PENDING 登记取消
    await voidPendingPreservation([propertyId], "CANCELLED", "LIFTED", roleDb);
  });

  revalidatePath("/preservation");
  if (prop.target.case.matterId) await revalidateMatter(prop.target.case.matterId);
  return { ok: true };
}

export async function deleteProperty(id: string) {
  const session = await requireSession("matters.write");
  const property = await prisma.preservationProperty.findUnique({
    where: { id },
    include: { target: { include: { case: { select: { id: true, matterId: true, ownerId: true } } } } }
  });
  if (!property) throw new ActionError("保全财产不存在");
  await assertCanAccessPreservationCaseRecord(session.user.id, property.target.case);
  if (property.target.case.matterId) await assertMatterWritable(property.target.case.matterId);

  await roleMutation(session.user, "matters.write", async roleDb => {
    await roleDb.preservationProperty.delete({ where: { id } });
    // F-1 阶段一：对象删除，残余 PENDING 登记取消（台账行保留作历史）
    await voidPendingPreservation([id], "CANCELLED", "OBJECT_DELETED", roleDb);
  });
  revalidatePath("/preservation");
  return { ok: true };
}

// for dashboard alerts
export async function listExpiringProperties(daysAhead = 60) {
  const session = await requireSession("matters.read");
  const end = new Date();
  end.setDate(end.getDate() + daysAhead);

  const rows = await prisma.preservationProperty.findMany({
    where: {
      status: { in: ["ACTIVE", "RENEWED"] },
      expiryDate: { lte: end },
      target: {
        case: {
          OR: [
            { matter: { deletedAt: null, ...matterAssociationFilter(session.user.id) } },
            { matterId: null, ownerId: session.user.id }
          ]
        }
      }
    },
    orderBy: { expiryDate: "asc" },
    include: {
      target: {
        include: {
          case: {
            include: { matter: { select: { id: true, internalCode: true, title: true } } }
          }
        }
      }
    }
  });
  return serializeDecimals(rows);
}
