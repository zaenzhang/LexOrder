import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action-error";
import { approvalTransaction } from "@/lib/approvals/service";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { resolveRoleUser } from "@/lib/roles/service";
import { matterAssociationFilter, matterReadVisibilityFilter } from "@/lib/permissions";
import { auditTx } from "@/server/audit";
import { assertDocumentDerivationAccess } from "@/server/documents/derivation-access";
import {
  deliveryIdSchema, deliveryState, prepareDeliverySchema, registerDeliveryEventSchema,
  type DeliveryDetail, type DeliveryOptions, type DeliverySummary,
  type PrepareDeliveryInput, type RegisterDeliveryEventInput,
} from "./contracts";

export const deliveryDocumentSelect = {
  id: true, matterId: true, intakeId: true, uploadedById: true, deletedAt: true,
  name: true, version: true, familyId: true, isLatest: true, sha256: true, size: true,
  status: true, sourceOrigin: true, templateId: true, path: true, mimeType: true,
  encrypted: true, iv: true, authTag: true,
} satisfies Prisma.DocumentSelect;
export type DeliveryDocument = Prisma.DocumentGetPayload<{ select: typeof deliveryDocumentSelect }>;

const deliveryInclude = {
  items: { orderBy: { position: "asc" }, include: { document: { select: deliveryDocumentSelect } } },
  events: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }], include: {
    actor: { select: { name: true } }, proofDocument: { select: deliveryDocumentSelect },
  } },
  createdBy: { select: { name: true } },
} satisfies Prisma.DeliveryRecordInclude;
export type DeliveryRecordWithItems = Prisma.DeliveryRecordGetPayload<{ include: typeof deliveryInclude }>;

/** A selected-file delivery never inherits finance or whole-case rights from an attachment approval. */
export async function assertDeliveryAuthority(db: Prisma.TransactionClient, userId: string, matterId: string, write: boolean) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!user?.active) throw new ActionError("当前账号不可用");
  const actor = await resolveRoleUser(userId, user.role, db);
  if (!actor.enabled || !hasCustomPermission(actor, "matters.read") || !hasCustomPermission(actor, "documents.download")) {
    throw new ActionError("查看交付记录需要案件查看和材料下载权限");
  }
  if (write && (!hasCustomPermission(actor, "matters.export") || !hasCustomPermission(actor, "matters.write"))) {
    throw new ActionError("准备或登记交付需要案件办理和导出权限");
  }
  const visibility = write
    ? actor.role === "PRINCIPAL_LAWYER" ? {} : matterAssociationFilter(userId)
    : matterReadVisibilityFilter(userId, actor.role, actor.rolePermissions);
  const matter = await db.matter.findFirst({ where: { id: matterId, deletedAt: null, ...visibility },
    select: { id: true, internalCode: true, status: true, primaryClientId: true } });
  if (!matter) throw new ActionError("案件不存在或无权查看交付记录");
  if (write && matter.status === "ARCHIVED") throw new ActionError("案件已归档，不能新增或更改交付登记");
  return { actor, matter };
}

export function deliveryApprovalBlock(document: Pick<DeliveryDocument, "status" | "templateId" | "sourceOrigin">): string | null {
  if (document.status === "PENDING_REVIEW") return "该版本仍待审批";
  if ((document.templateId || document.sourceOrigin === "TEAM_PRODUCED") && !["APPROVED", "FILED"].includes(document.status)) {
    return "该成果版本须先完成文书审批";
  }
  return null;
}

async function assertReadableDocument(db: Prisma.TransactionClient, userId: string, matterId: string, document: DeliveryDocument | null) {
  if (!document || document.deletedAt || document.matterId !== matterId) {
    throw new ActionError("部分材料不存在、已撤回或无权读取，请回材料区核对");
  }
  await assertDocumentDerivationAccess(userId, document.id, { purpose: "EXPORT", db });
  return document;
}

export async function assertDeliveryDocuments(db: Prisma.TransactionClient, userId: string, record: Pick<DeliveryRecordWithItems, "matterId" | "items">, requireApproval: boolean) {
  if (!record.items.length) throw new ActionError("交付清单没有材料，不能导出");
  for (const item of record.items) {
    const document = await assertReadableDocument(db, userId, record.matterId, item.document);
    if (document.version !== item.documentVersion || document.sha256 !== item.documentSha256) {
      throw new ActionError("交付清单中的具体版本已变化，请核对原清单；系统不会改用新版本");
    }
    if (requireApproval) {
      const block = deliveryApprovalBlock(document);
      if (block) throw new ActionError(`${item.documentName}：${block}，请打开该版本处理`);
    }
  }
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function loadDeliveryRecord(db: Prisma.TransactionClient, userId: string, deliveryId: string, write = false) {
  const record = await db.deliveryRecord.findUnique({ where: { id: deliveryIdSchema.parse(deliveryId) }, include: deliveryInclude });
  if (!record) throw new ActionError("交付清单不存在");
  await assertDeliveryAuthority(db, userId, record.matterId, write);
  await assertDeliveryDocuments(db, userId, record, false);
  return record;
}

export async function prepareDeliveryForActor(userId: string, input: PrepareDeliveryInput) {
  const data = prepareDeliverySchema.parse(input);
  const requestFingerprint = fingerprint({ ...data, requestKey: undefined });
  return approvalTransaction(async db => {
    await assertDeliveryAuthority(db, userId, data.matterId, true);
    const existing = await db.deliveryRecord.findUnique({ where: { createdById_requestKey: { createdById: userId, requestKey: data.requestKey } }, include: deliveryInclude });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new ActionError("本次清单已保存且内容已变化，请先查看已保存记录");
      await assertDeliveryDocuments(db, userId, existing, false);
      return { id: existing.id };
    }
    if (data.recipientClientId) {
      const belongs = await db.matter.count({ where: { id: data.matterId, OR: [
        { primaryClientId: data.recipientClientId }, { clientLinks: { some: { clientId: data.recipientClientId } } },
      ] } });
      const client = await db.client.findFirst({ where: { id: data.recipientClientId, deletedAt: null }, select: { id: true } });
      if (!belongs || !client) throw new ActionError("所选客户不属于本案，请重新选择接收对象");
    }
    if (data.supersedesId) {
      const previous = await db.deliveryRecord.findUnique({ where: { id: data.supersedesId }, select: { matterId: true } });
      if (previous?.matterId !== data.matterId) throw new ActionError("补发或更正清单须属于同一案件");
    }
    const documents = await db.document.findMany({ where: { id: { in: data.documentIds } }, select: deliveryDocumentSelect });
    const byId = new Map(documents.map(document => [document.id, document]));
    const items = [];
    for (const [position, documentId] of data.documentIds.entries()) {
      const document = await assertReadableDocument(db, userId, data.matterId, byId.get(documentId) ?? null);
      const block = deliveryApprovalBlock(document);
      if (block) throw new ActionError(`${document.name}：${block}，请打开该版本处理`);
      if (!document.sha256 || !/^[a-f0-9]{64}$/.test(document.sha256)) throw new ActionError("材料缺少原件标识，请先回材料区核对");
      items.push({ documentId, position: position + 1, documentName: document.name, documentVersion: document.version,
        documentSha256: document.sha256, size: document.size });
    }
    const record = await db.deliveryRecord.create({ data: {
      matterId: data.matterId, requestKey: data.requestKey, requestFingerprint,
      purpose: data.purpose, recipientClientId: data.recipientClientId, recipientName: data.recipientName,
      recipientContact: data.recipientContact, disclosureScope: data.disclosureScope, unresolvedItems: data.unresolvedItems,
      supersedesId: data.supersedesId, createdById: userId, items: { create: items },
    }, select: { id: true } });
    await auditTx(db, { userId, action: "DELIVERY_PREPARE", targetType: "DeliveryRecord", targetId: record.id,
      detail: { matterId: data.matterId, itemCount: items.length, supersedesId: data.supersedesId } });
    return record;
  });
}

export async function findDeliveryByRequestForActor(userId: string, input: PrepareDeliveryInput) {
  const data = prepareDeliverySchema.parse(input);
  const row = await prisma.deliveryRecord.findUnique({ where: { createdById_requestKey: { createdById: userId, requestKey: data.requestKey } }, select: { id: true, requestFingerprint: true } });
  if (!row) return null;
  if (row.requestFingerprint !== fingerprint({ ...data, requestKey: undefined })) throw new ActionError("本次清单已保存且内容已变化，请保留当前输入并另行查看原记录");
  await loadDeliveryRecord(prisma, userId, row.id);
  return { id: row.id };
}

export async function registerDeliveryEventForActor(userId: string, input: RegisterDeliveryEventInput) {
  const data = registerDeliveryEventSchema.parse(input);
  if (new Date(data.occurredAt).getTime() > Date.now() + 60_000) throw new ActionError("只能登记已经发生的事实，不能填写未来时间");
  const requestFingerprint = fingerprint({ ...data, requestKey: undefined });
  return approvalTransaction(async db => {
    const record = await loadDeliveryRecord(db, userId, data.deliveryId, true);
    const existing = await db.deliveryEvent.findUnique({ where: { actorId_requestKey: { actorId: userId, requestKey: data.requestKey } } });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new ActionError("本次事件已登记且内容已变化，请先查看原登记");
      if (existing.proofDocumentId) await assertReadableDocument(db, userId, record.matterId,
        await db.document.findUnique({ where: { id: existing.proofDocumentId }, select: deliveryDocumentSelect }));
      return { id: existing.id, deliveryId: existing.deliveryId };
    }
    const sent = record.events.find(event => event.kind === "SENT");
    if (data.kind === "SENT" && sent) throw new ActionError("该清单已登记发送；更正事实请追加更正，补发请另建关联清单");
    if (data.kind !== "SENT" && !sent) throw new ActionError("请先登记实际发送，再记录收悉、回复或更正");
    if (data.correctsEventId && !record.events.some(event => event.id === data.correctsEventId && ["SENT", "SEND_CORRECTION"].includes(event.kind))) {
      throw new ActionError("请选择本清单的原发送登记进行更正");
    }
    if (data.proofDocumentId) {
      await assertReadableDocument(db, userId, record.matterId,
        await db.document.findUnique({ where: { id: data.proofDocumentId }, select: deliveryDocumentSelect }));
    }
    const event = await db.deliveryEvent.create({ data: {
      deliveryId: data.deliveryId, kind: data.kind, requestKey: data.requestKey, requestFingerprint,
      occurredAt: new Date(data.occurredAt), actorId: userId, channel: data.channel || null,
      note: data.note, proofDocumentId: data.proofDocumentId, correctsEventId: data.correctsEventId,
    }, select: { id: true, deliveryId: true } });
    await auditTx(db, { userId, action: `DELIVERY_${data.kind}`, targetType: "DeliveryRecord", targetId: record.id,
      detail: { matterId: record.matterId, eventId: event.id, hasProof: Boolean(data.proofDocumentId), correctsEventId: data.correctsEventId } });
    return event;
  });
}

export async function findDeliveryEventByRequestForActor(userId: string, input: RegisterDeliveryEventInput) {
  const data = registerDeliveryEventSchema.parse(input);
  const event = await prisma.deliveryEvent.findUnique({ where: { actorId_requestKey: { actorId: userId, requestKey: data.requestKey } }, select: { id: true, deliveryId: true, requestFingerprint: true, proofDocumentId: true } });
  if (!event) return null;
  if (event.requestFingerprint !== fingerprint({ ...data, requestKey: undefined })) throw new ActionError("本次事件已登记且内容已变化，请保留当前输入并另行查看原登记");
  const record = await loadDeliveryRecord(prisma, userId, event.deliveryId);
  if (event.proofDocumentId) await assertReadableDocument(prisma, userId, record.matterId,
    await prisma.document.findUnique({ where: { id: event.proofDocumentId }, select: deliveryDocumentSelect }));
  return { id: event.id, deliveryId: event.deliveryId };
}

export async function listDeliveryRecordsForActor(userId: string, matterId: string, beforeId?: string) {
  await assertDeliveryAuthority(prisma, userId, deliveryIdSchema.parse(matterId), false);
  if (beforeId && !await prisma.deliveryRecord.count({ where: { id: deliveryIdSchema.parse(beforeId), matterId } })) {
    throw new ActionError("列表位置已失效，请返回第一页");
  }
  const rows = await prisma.deliveryRecord.findMany({ where: { matterId }, include: deliveryInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
    ...(beforeId ? { cursor: { id: beforeId }, skip: 1 } : {}) });
  const items: DeliverySummary[] = [];
  for (const row of rows.slice(0, 20)) {
    let available = true;
    try { await assertDeliveryDocuments(prisma, userId, row, false); }
    catch (error) { if (error instanceof ActionError) available = false; else throw error; }
    items.push({ id: row.id, purpose: available ? row.purpose : null, recipientName: available ? row.recipientName : null,
      createdAt: row.createdAt.toISOString(), itemCount: row.items.length, state: available ? deliveryState(row.events) : "UNAVAILABLE" });
  }
  return { items, nextCursor: rows.length > 20 ? rows[19].id : null };
}

export async function getDeliveryDetailForActor(userId: string, deliveryId: string): Promise<DeliveryDetail> {
  const record = await loadDeliveryRecord(prisma, userId, deliveryId);
  let canWrite = true;
  try { await assertDeliveryAuthority(prisma, userId, record.matterId, true); }
  catch (error) { if (error instanceof ActionError) canWrite = false; else throw error; }
  const events = [];
  for (const event of record.events) {
    let proofAvailable = false;
    if (event.proofDocument) {
      try { await assertReadableDocument(prisma, userId, record.matterId, event.proofDocument); proofAvailable = true; }
      catch (error) { if (!(error instanceof ActionError)) throw error; }
    }
    const proofUnavailable = Boolean(event.proofDocumentId) && !proofAvailable;
    events.push({ id: event.id, kind: event.kind, occurredAt: event.occurredAt.toISOString(), recordedAt: event.recordedAt.toISOString(),
      actorName: event.actor.name, channel: event.channel, note: proofUnavailable ? null : event.note, proofUnavailable,
      proofDocumentId: proofAvailable ? event.proofDocumentId : null,
      proofName: proofAvailable ? event.proofDocument!.name : null,
      correctsEventId: event.correctsEventId });
  }
  return { id: record.id, matterId: record.matterId, recipientClientId: record.recipientClientId,
    purpose: record.purpose, recipientName: record.recipientName, recipientContact: record.recipientContact,
    disclosureScope: record.disclosureScope, unresolvedItems: record.unresolvedItems, supersedesId: record.supersedesId,
    createdAt: record.createdAt.toISOString(), createdByName: record.createdBy.name, canWrite,
    items: record.items.map(item => ({ id: item.id, documentId: item.documentId, position: item.position,
      documentName: item.documentName, documentVersion: item.documentVersion, newerVersionAvailable: !item.document.isLatest })), events };
}

export async function getDeliveryOptionsForActor(userId: string, matterId: string): Promise<DeliveryOptions> {
  const { actor, matter } = await assertDeliveryAuthority(prisma, userId, deliveryIdSchema.parse(matterId), false);
  let canPrepare = true;
  try { await assertDeliveryAuthority(prisma, userId, matterId, true); }
  catch (error) { if (error instanceof ActionError) canPrepare = false; else throw error; }
  const documents = [];
  const rows = await prisma.document.findMany({ where: { matterId, deletedAt: null }, select: deliveryDocumentSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  for (const row of rows) {
    try { await assertReadableDocument(prisma, userId, matterId, row); }
    catch (error) { if (error instanceof ActionError) continue; else throw error; }
    const blockedReason = deliveryApprovalBlock(row) || (!row.sha256 ? "缺少原件标识，请先核对材料" : null);
    documents.push({ id: row.id, name: row.name, version: row.version, status: row.status, canDeliver: !blockedReason, blockedReason });
  }
  const clients = await prisma.client.findMany({ where: { deletedAt: null, OR: [
    { matters: { some: { id: matterId } } }, { matterLinks: { some: { matterId } } },
  ] }, select: { id: true, name: true, phone: true, email: true }, orderBy: { name: "asc" } });
  const canCreateBrief = matter.status !== "ARCHIVED" && hasCustomPermission(actor, "documents.write") &&
    (actor.role === "PRINCIPAL_LAWYER" || Boolean(await prisma.matter.count({ where: { id: matterId, ...matterAssociationFilter(userId) } })));
  return { canPrepare, canCreateBrief, documents,
    clients: clients.map(client => ({ id: client.id, name: client.name, contact: [client.email, client.phone].filter(Boolean).join(" / ") })) };
}
