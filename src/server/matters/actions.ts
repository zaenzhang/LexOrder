"use server";
import {responsibilityReady,readWorkRows,closedHearingIds} from "@/server/reminders/responsibility";
import { withRoleNames } from "@/lib/roles/presentation";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { checkRoleMutation, roleMutation } from "@/lib/roles/service";
import { approvalSettings, approvalTransaction } from "@/lib/approvals/service";
import { currentActor } from "@/server/intakes/workflow";
import { matterBasicEditSchema, matterTeamEditSchema, procedureInfoEditSchema, type MatterBasicEditInput, type MatterTeamEditInput, type ProcedureInfoEditInput } from "./editor-input";

import { assertAssignableColleagues } from "@/lib/teams/validate-colleagues";

import { revalidatePath } from "next/cache";
import { LitigationStanding, PartyRole, PartyType, Prisma } from "@prisma/client";
import { decryptIdNumber } from "@/lib/clients/id-number-crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit, auditTx } from "@/server/audit";
import { lockWritableMatters } from "./write-access";
import { assertMatterWritable } from "@/lib/archive/guard";
import { serializeDecimals } from "@/lib/decimal";
import {
  matterAssociationFilter,
  matterReadVisibilityFilter,
  teamMatterFilter,
  assertCanReadMatter,
  hasMatterBusinessAccess,
  assertCanOwnMatter
} from "@/lib/permissions";
import { generateInternalCode, generateFirmCaseNo } from "./code-generator";
import { seedDefaultFolders } from "@/lib/default-folders";
import { assertAgencyAllowedForProcedure, normalizeJurisdictionForAgency } from "@/lib/china-regions";
import {
  assertCauseAllowedForMatter,
  assertCauseAllowedForSelection
} from "@/server/causes/validation";
import {
  matterCreateSchema,
  matterListQuerySchema,
  type MatterCreateInput,
  type MatterListQuery
} from "./schemas";
import { revalidateMatter } from "@/server/matters/route";
import { recordTimelineEvent } from "@/server/timeline/record";
import { personIdError } from "@/lib/clients/person-id";
import { ActionError } from "@/lib/action-error";
import { assertActualProcedureConclusion } from "@/server/procedures/lifecycle";

function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === "" ? null : v;
  }
  return out as T;
}


/** 墨案 03 效果图：分段导航计数（与列表同口径的可见性/范围过滤；不含搜索词） */
export async function getMatterTabCounts(input: {
  scope?: string; teamId?: string; ownerId?: string; category?: string;
} = {}) {
  const session = await requireSession("matters.read");
  const parts: Prisma.MatterWhereInput[] = [
    matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions),
    { deletedAt: null }
  ];
  if (input.scope === "mine") parts.push(matterAssociationFilter(session.user.id));
  if (input.scope === "team" || input.teamId) parts.push(teamMatterFilter(session.user.id, input.teamId));
  if (input.ownerId) parts.push({ ownerId: input.ownerId });
  if (input.category && input.category !== "ALL") {
    parts.push({ category: input.category as Prisma.MatterWhereInput["category"] });
  }

  const groups = await prisma.matter.groupBy({
    by: ["status"],
    where: { AND: parts },
    _count: { _all: true }
  });
  const c = Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const all = (c.IN_PROGRESS ?? 0) + (c.ON_HOLD ?? 0) + (c.CLOSED ?? 0) + (c.ARCHIVED ?? 0);

  const { listIntakes } = await import("@/server/intakes/actions");
  type IntakeQuery = Parameters<typeof listIntakes>[0];
  const scopeInput = {
    scope: input.scope as NonNullable<IntakeQuery>["scope"],
    teamId: input.teamId,
    ownerId: input.ownerId,
    category: input.category as NonNullable<IntakeQuery>["category"]
  };
  const [intakePending, intakeRevision] = await Promise.all([
    listIntakes({ ...scopeInput, statusIn: ["INTAKE", "PENDING_CONFIRMATION"] as NonNullable<IntakeQuery>["statusIn"], page: 1, pageSize: 1 }),
    listIntakes({ ...scopeInput, statusIn: ["NEEDS_REVISION"] as NonNullable<IntakeQuery>["statusIn"], page: 1, pageSize: 1 })
  ]);

  return {
    all,
    // active = statusNotIn [CLOSED, ARCHIVED]（含收案审批中的 Matter，与列表页口径一致）
    active: (c.IN_PROGRESS ?? 0) + (c.ON_HOLD ?? 0) + (c.PENDING_ACCEPTANCE ?? 0),
    archived: c.ARCHIVED ?? 0,
    intake: intakePending.total,
    revision: intakeRevision.total
  };
}

export async function listMatters(input: Partial<MatterListQuery> = {}) {
  const session = await requireSession("matters.read");
  const query = matterListQuerySchema.parse(input);
  const canReadSchedule = hasCustomPermission(session.user, "schedule.read");

  const whereParts: Prisma.MatterWhereInput[] = [
    matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions),
    { deletedAt: null }
  ];
  if (query.scope === "mine") whereParts.push(matterAssociationFilter(session.user.id));
  if (query.scope === "team" || query.teamId) whereParts.push(teamMatterFilter(session.user.id, query.teamId));
  if (query.category) whereParts.push({ category: query.category });
  if (query.status) whereParts.push({ status: query.status });
  if (query.statusIn) whereParts.push({ status: { in: query.statusIn } });
  if (query.statusNotIn) whereParts.push({ status: { notIn: query.statusNotIn } });
  if (query.ownerId) whereParts.push({ ownerId: query.ownerId });
  if (query.clientId) whereParts.push({ primaryClientId: query.clientId });
  if (query.intakeDateFrom || query.intakeDateTo) {
    whereParts.push({
      intakeDate: {
        ...(query.intakeDateFrom ? { gte: query.intakeDateFrom } : {}),
        ...(query.intakeDateTo ? { lte: query.intakeDateTo } : {})
      }
    });
  }
  if (query.search) {
    whereParts.push({
      OR: [
        { title: { contains: query.search, mode: "insensitive" } },
        { internalCode: { contains: query.search, mode: "insensitive" } },
        { firmCaseNo: { contains: query.search, mode: "insensitive" } },
        { primaryClient: { name: { contains: query.search, mode: "insensitive" } } },
        { clientLinks: { some: { client: { name: { contains: query.search, mode: "insensitive" } } } } },
        { parties: { some: { name: { contains: query.search, mode: "insensitive" } } } },
        { procedures: { some: { caseNumber: { contains: query.search, mode: "insensitive" } } } }
      ]
    });
  }
  const where: Prisma.MatterWhereInput = { AND: whereParts };

  const compareNullable = <T>(
    a: T | null | undefined,
    b: T | null | undefined,
    compare: (x: T, y: T) => number
  ) => {
    const aEmpty = a === null || a === undefined;
    const bEmpty = b === null || b === undefined;
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    return compare(a as T, b as T);
  };

  const [allItems, total] = await Promise.all([
    prisma.matter.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      include: {
        primaryClient: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        cause: { select: { id: true, name: true } },
        procedures: {
          orderBy: { order: "desc" },
          take: 20,
          select: {
            id: true,
            type: true,
            caseNumber: true,
            status: true,
            engagement: true,
            concludedAt: true,
            customLabel: true,
            hearings: {
              ...(!canReadSchedule ? { where: { id: { in: [] } } } : {}),
              orderBy: { startsAt: "desc" },
              take: 1,
              select: { startsAt: true }
            },
            // 墨案 03：程序·阶段进度与最近期限（取最近一条未完成期限）
            stages: {
              orderBy: { order: "asc" },
              select: { id: true, name: true, order: true, completedAt: true, status: true }
            },
            deadlines: {
              where: { completed: false, ...(!canReadSchedule ? { id: { in: [] } } : {}) },
              orderBy: { dueAt: "asc" },
              take: 1,
              select: { title: true, dueAt: true, category: true }
            }
          }
        },
        // v0.8.1: 卡片化需要前几位对方/第三人
        parties: {
          where: { role: { in: ["OPPOSING_PARTY", "THIRD_PARTY"] } },
          orderBy: [{ role: "asc" }, { ordinal: "asc" }],
          take: 3,
          select: { id: true, name: true, role: true, standing: true }
        },
        // v0.16: 是否有归档申请待审批
        archiveRecords: {
          where: { status: "PENDING_REVIEW" },
          take: 1,
          select: { id: true }
        },
        // 墨案 03 列表「主办 / 协办」列：只取协办姓名用于展示
        members: {
          where: { role: "CO_LEAD" },
          take: 2,
          select: { user: { select: { id: true, name: true } } }
        },
        _count: { select: { procedures: true } }
      }
    }),
    prisma.matter.count({ where })
  ]);

  const sorted = allItems
    .map((matter) => ({
      ...matter,
      canReadSchedule,
      latestHearingAt:
        matter.procedures
          .map((p) => p.hearings[0]?.startsAt ?? null)
          .filter((d): d is Date => !!d)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
    }))
    .sort((a, b) => {
      const sortValue = (matter: typeof a) => {
        if (query.sortBy === "hearing") return matter.latestHearingAt;
        if (query.sortBy === "archivedAt") return matter.archivedAt;
        if (query.sortBy === "claimAmount") {
          return matter.claimAmount === null || matter.claimAmount === undefined
            ? null
            : Number(matter.claimAmount);
        }
        return matter.intakeDate;
      };
      const aValue = sortValue(a);
      const bValue = sortValue(b);
      const aEmpty = aValue === null || aValue === undefined;
      const bEmpty = bValue === null || bValue === undefined;
      if (aEmpty && bEmpty) return b.updatedAt.getTime() - a.updatedAt.getTime();
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const direction = query.sortDir === "asc" ? 1 : -1;
      const base =
        aValue instanceof Date || bValue instanceof Date
          ? compareNullable(aValue as Date | null, bValue as Date | null, (x, y) => x.getTime() - y.getTime())
          : compareNullable(aValue as number | null, bValue as number | null, (x, y) => x - y);
      if (base !== 0) return base * direction;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

  const start = (query.page - 1) * query.pageSize;
  const items = serializeDecimals(sorted.slice(start, start + query.pageSize));

  return { items, total, page: query.page, pageSize: query.pageSize };
}

// v0.32: 程序级基本信息编辑
export async function updateProcedureInfo(input: ProcedureInfoEditInput) {
  const session = await requireSession("matters.write");
  const data = procedureInfoEditSchema.parse(input);
  const partyRows = data.procedureParties;
  for (const party of data.updatedParties) {
    if (party.partyType !== "NATURAL_PERSON") continue;
    if (party.idNumber && !party.idType) throw new ActionError(`当事人「${party.name}」请选择证件类型`);
    const error = personIdError(party.idType, party.idNumber);
    if (error) throw new ActionError(`当事人「${party.name}」：${error}`);
  }
  for (const party of data.newProcedureParties) {
    if (party.partyType === "NATURAL_PERSON" && !party.idType) throw new ActionError(`新增当事人「${party.name}」请选择证件类型`);
    const number = party.partyType === "NATURAL_PERSON" ? party.idNumber : party.enterpriseSocialCode;
    if (!number) throw new ActionError(`新增当事人「${party.name}」请填写证件号码`);
    const error = personIdError(party.partyType === "NATURAL_PERSON" ? party.idType : "USCC", number);
    if (error) throw new ActionError(`新增当事人「${party.name}」：${error}`);
  }
  if (new Set(data.updatedParties.map(party => party.partyId)).size !== data.updatedParties.length) {
    throw new ActionError("同一当事人不能重复提交修改");
  }

  const matterId = await approvalTransaction(async tx => {
    await checkRoleMutation(tx, session.user, "matters.write");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${session.user.id} FOR SHARE`;
    const ref = await tx.matterProcedure.findUnique({ where: { id: data.procedureId }, select: { matterId: true } });
    if (!ref) throw new ActionError("程序不存在或无权修改");
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${ref.matterId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "MatterProcedure" WHERE id=${data.procedureId} FOR UPDATE`;
    const actor = await currentActor(tx, session.user.id, "matters.write");
    if (actor.role !== session.user.role || !hasCustomPermission(actor, "matters.write")) throw new ActionError("当前岗位无权修改程序");
    const proc = await tx.matterProcedure.findFirst({
      where: { id: data.procedureId, matterId: ref.matterId, matter: { deletedAt: null, ...matterAssociationFilter(session.user.id) } },
      include: {
        matter: { select: { status: true, primaryClientId: true, clientLinks: { select: { clientId: true } } } },
        procedureParties: true
      }
    });
    if (!proc) throw new ActionError("程序不存在或无权修改");
    if (proc.matter.status === "ARCHIVED") throw new ActionError("案件已归档，禁止修改");
    if (proc.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
      throw new ActionError("程序已被其他人修改，请保留输入并重新核对");
    }
    const handlingAgency = data.handlingAgency === undefined ? proc.handlingAgency : data.handlingAgency;
    assertAgencyAllowedForProcedure(handlingAgency, proc.type);

    const partyIds = [...new Set([...(partyRows?.map(row => row.partyId) ?? []), ...data.updatedParties.map(row => row.partyId)])];
    const realIds = partyIds.filter(id => !id.startsWith("client:"));
    const realParties = realIds.length ? await tx.party.findMany({
      where: { id: { in: realIds }, matterId: proc.matterId }, select: { id: true, updatedAt: true }
    }) : [];
    if (realParties.length !== realIds.length) throw new ActionError("存在不属于本案的当事人");
    const versions = new Map(realParties.map(party => [party.id, party.updatedAt]));
    for (const party of data.updatedParties) {
      if (versions.get(party.partyId)?.getTime() !== party.expectedUpdatedAt.getTime()) {
        throw new ActionError(`当事人「${party.name}」已被其他人修改，请保留输入并重新核对`);
      }
    }
    const linkedClients = new Set([
      ...(proc.matter.primaryClientId ? [proc.matter.primaryClientId] : []),
      ...proc.matter.clientLinks.map(link => link.clientId)
    ]);
    if (partyIds.some(id => id.startsWith("client:") && !linkedClients.has(id.slice(7)))) {
      throw new ActionError("存在不属于本案的客户");
    }

    for (const party of data.updatedParties) {
      const result = await tx.party.updateMany({
        where: { id: party.partyId, matterId: proc.matterId, updatedAt: party.expectedUpdatedAt },
        data: {
          role: party.role, name: party.name, partyType: party.partyType,
          idType: party.partyType === "NATURAL_PERSON" ? party.idType : null,
          idNumber: party.partyType === "NATURAL_PERSON" ? party.idNumber.toUpperCase() || null : null,
          enterpriseSocialCode: party.partyType === "NATURAL_PERSON" ? null : party.enterpriseSocialCode.toUpperCase() || null,
          enterpriseName: party.partyType === "NATURAL_PERSON" ? null : party.name,
          legalRep: party.partyType === "NATURAL_PERSON" ? null : party.legalRep || null,
          contactName: party.contactName || null, phone: party.phone || null, address: party.address || null
        }
      });
      if (result.count !== 1) throw new ActionError("当事人已变化，请保留输入并重新核对");
    }

    const mergedParties = [...(partyRows ?? proc.procedureParties.map(row => ({ partyId: row.partyId, standing: row.standing })))];
    for (const row of mergedParties) {
      if (row.partyId.startsWith("client:")) {
        row.partyId = await ensureClientParty(tx, proc.matterId, row.partyId.slice(7), row.standing);
      }
    }
    const nextOrdinalByRole = new Map<PartyRole, number>();
    for (const party of data.newProcedureParties) {
      if (!nextOrdinalByRole.has(party.role)) {
        const max = await tx.party.aggregate({ where: { matterId: proc.matterId, role: party.role }, _max: { ordinal: true } });
        nextOrdinalByRole.set(party.role, (max._max.ordinal ?? 0) + 1);
      }
      const ordinal = nextOrdinalByRole.get(party.role)!;
      nextOrdinalByRole.set(party.role, ordinal + 1);
      const created = await tx.party.create({
        data: {
          matterId: proc.matterId, ordinal, role: party.role, name: party.name, partyType: party.partyType,
          standing: party.standings[0],
          idType: party.partyType === "NATURAL_PERSON" ? party.idType : null,
          idNumber: party.partyType === "NATURAL_PERSON" ? party.idNumber.toUpperCase() : null,
          enterpriseSocialCode: party.partyType === "NATURAL_PERSON" ? null : party.enterpriseSocialCode.toUpperCase(),
          enterpriseName: party.partyType === "NATURAL_PERSON" ? null : party.name
        }, select: { id: true }
      });
      for (const standing of party.standings) mergedParties.push({ partyId: created.id, standing: standing });
    }

    const procedureData: Prisma.MatterProcedureUpdateManyMutationInput = {};
    for (const field of ["handlingAgency", "caseNumber", "presidingJudge", "presidingJudgeContact", "judgeAssistant", "judgeAssistantContact"] as const) {
      if (data[field] !== undefined) procedureData[field] = data[field] || null;
    }
    if (data.jurisdiction !== undefined || data.handlingAgency !== undefined) {
      procedureData.jurisdiction = normalizeJurisdictionForAgency(handlingAgency, data.jurisdiction === undefined ? proc.jurisdiction : data.jurisdiction);
    }
    if (data.ourStanding !== undefined) procedureData.ourStanding = data.ourStanding;
    if (data.acceptedAt !== undefined) procedureData.acceptedAt = data.acceptedAt;
    if (data.concludedAt !== undefined) {
      if (data.concludedAt && proc.status !== "CONCLUDED") throw new ActionError("请通过终结程序动作记录实际终结日期");
      if (!data.concludedAt && proc.status === "CONCLUDED") throw new ActionError("终结日期不能直接清空；恢复办理请使用程序状态动作");
      if (data.concludedAt) assertActualProcedureConclusion(data.concludedAt, data.acceptedAt === undefined ? proc.acceptedAt : data.acceptedAt);
      procedureData.concludedAt = data.concludedAt;
    } else if (data.acceptedAt && proc.concludedAt && proc.status === "CONCLUDED") assertActualProcedureConclusion(proc.concludedAt, data.acceptedAt);
    // 关联和实际 Party 修改也更新本次程序任务的前置值。
    procedureData.updatedAt = new Date();
    const updated = await tx.matterProcedure.updateMany({
      where: { id: proc.id, updatedAt: data.expectedUpdatedAt }, data: procedureData
    });
    if (updated.count !== 1) throw new ActionError("程序已变化，请保留输入并重新核对");

    if (partyRows !== undefined || data.newProcedureParties.length) {
      const rows = uniqueProcedureParties(mergedParties);
      const removedIds = proc.procedureParties.filter(old => !rows.some(row => row.partyId === old.partyId && row.standing === old.standing)).map(row => row.id);
      if (removedIds.length) await tx.procedureParty.deleteMany({ where: { id: { in: removedIds }, procedureId: proc.id } });
      let nextOrdinal = Math.max(0, ...proc.procedureParties.map(row => row.ordinal)) + 1;
      for (const row of rows) {
        const existing = proc.procedureParties.find(old => old.partyId === row.partyId && old.standing === row.standing);
        if (!existing) await tx.procedureParty.create({ data: { procedureId: proc.id, ...row, ordinal: nextOrdinal++ } });
      }
    }
    await auditTx(tx, { userId: session.user.id, action: "PROCEDURE_INFO_UPDATE", targetType: "MatterProcedure", targetId: proc.id, detail: { matterId: proc.matterId } });
    return proc.matterId;
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  await revalidateMatter(matterId);
}

function clientTypeToPartyType(type: "INDIVIDUAL" | "COMPANY" | "ORGANIZATION"): PartyType {
  if (type === "INDIVIDUAL") return "NATURAL_PERSON";
  if (type === "COMPANY") return "COMPANY";
  return "OTHER_ORG";
}

async function ensureClientParty(
  tx: Prisma.TransactionClient,
  matterId: string,
  clientId: string,
  standing: LitigationStanding
) {
  const client = await tx.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, type: true, idType: true, idNumber: true }
  });
  if (!client) throw new ActionError("客户不存在");
  // 客户证件号入库为密文，当事人表存明文：补入时必须先解密
  const clientIdPlain = decryptIdNumber(client.idNumber) || null;

  const existing = await tx.party.findFirst({
    where: {
      matterId,
      role: "CLIENT_PARTY",
      name: client.name
    },
    select: { id: true }
  });
  if (existing) return existing.id;

  const max = await tx.party.aggregate({
    where: { matterId, role: "CLIENT_PARTY" },
    _max: { ordinal: true }
  });
  const partyType = clientTypeToPartyType(client.type);
  const created = await tx.party.create({
    data: {
      matterId,
      role: "CLIENT_PARTY",
      ordinal: (max._max.ordinal ?? 0) + 1,
      name: client.name,
      partyType,
      standing,
      idType: partyType === "NATURAL_PERSON" ? (client.idType && client.idType !== "USCC" ? client.idType : "ID_CARD") : null,
      idNumber: partyType === "NATURAL_PERSON" ? clientIdPlain : null,
      enterpriseSocialCode: partyType === "NATURAL_PERSON" ? null : clientIdPlain,
      enterpriseName: partyType === "NATURAL_PERSON" ? null : client.name,
      notes: "由案件关联客户自动补入"
    },
    select: { id: true }
  });
  return created.id;
}

function uniqueProcedureParties(
  rows: { partyId: string; standing: LitigationStanding }[]
) {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = `${row.partyId}:${row.standing}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// v0.32: 关联案件 —— 搜索 / 关联 / 解除
export async function searchMattersForLink(matterId: string, q: string) {
  const session = await requireSession("matters.read");
  const query = q.trim();
  return prisma.$transaction(async tx => {
  await lockWritableMatters(tx, session.user, "matters.read", [matterId]);
  // 已关联的（两个方向）排除
  const links = await tx.matterLink.findMany({
    where: { OR: [{ matterId }, { relatedMatterId: matterId }] },
    select: { matterId: true, relatedMatterId: true }
  });
  const excludeIds = new Set<string>([matterId]);
  links.forEach((l) => {
    excludeIds.add(l.matterId);
    excludeIds.add(l.relatedMatterId);
  });
  const items = await tx.matter.findMany({
    where: {
      deletedAt: null,
      status: { not: "ARCHIVED" },
      id: { notIn: Array.from(excludeIds) },
      AND: [matterAssociationFilter(session.user.id), ...(query
        ? [{
            OR: [
              { title: { contains: query, mode: "insensitive" as const } },
              { firmCaseNo: { contains: query, mode: "insensitive" as const } }
            ]
          }]
        : [])]
    },
    select: { id: true, internalCode: true, firmCaseNo: true, title: true },
    orderBy: { createdAt: "desc" },
    take: 8
  });
  return items;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 });
}

export async function addMatterLink(
  matterId: string,
  relatedMatterId: string,
  relation?: "RELATED_CASE" | "REMAND" | "DERIVED_ENFORCEMENT" | "RELATED_CONTRACT" | "REFERENCE_ONLY"
) {
  const session = await requireSession("matters.write");
  if (matterId === relatedMatterId) throw new ActionError("不能关联到自身");
  // v1.x P1-7: 关联关系类型（缺省兼容旧行为=一般关联）+ 建链人
  const nextRelation = relation ?? "RELATED_CASE";
  await prisma.$transaction(async tx => {
    await lockWritableMatters(tx, session.user, "matters.write", [matterId, relatedMatterId]);
    await tx.matterLink.upsert({
      where: { matterId_relatedMatterId: { matterId, relatedMatterId } },
      create: { matterId, relatedMatterId, relation: nextRelation, notedById: session.user.id },
      update: { relation: nextRelation, notedById: session.user.id }
    });
    await auditTx(tx, { userId: session.user.id, action: "MATTER_LINK_ADD", targetType: "Matter",
      targetId: matterId, detail: { relatedMatterId, relation: nextRelation } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 });
  await revalidateMatter(matterId);
}

export async function removeMatterLink(matterId: string, relatedMatterId: string) {
  const session = await requireSession("matters.write");
  // 两个方向都删（无论当初谁关联谁）
  await prisma.$transaction(async tx => {
    await lockWritableMatters(tx, session.user, "matters.write", [matterId, relatedMatterId]);
    await tx.matterLink.deleteMany({ where: { OR: [
      { matterId, relatedMatterId }, { matterId: relatedMatterId, relatedMatterId: matterId }
    ] } });
    await auditTx(tx, { userId: session.user.id, action: "MATTER_LINK_REMOVE", targetType: "Matter",
      targetId: matterId, detail: { relatedMatterId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 });
  await revalidateMatter(matterId);
}

export async function getMatterById(id: string) {
  const session = await requireSession("matters.read");
  await assertCanReadMatter(session.user.id, session.user.role, id, session.user.rolePermissions);
  const scheduleDenied = !hasCustomPermission(session.user, "schedule.read") ? { where: { id: { in: [] as string[] } } } : {};
  const businessAccess = await hasMatterBusinessAccess(session.user.id, session.user.role, id, session.user.rolePermissions);
  const excludedHearings=await closedHearingIds(prisma);
  const matter = await prisma.matter.findFirst({
    where: { id, deletedAt: null },
    include: {
      primaryClient: { include: { contacts: { where: { isPrimary: true }, take: 1 } } },
      clientLinks: { include: { client: { select: { id: true, name: true, type: true, idNumber: true } } } },
      owner: { select: { id: true, name: true, role: true } },
      registeredBy: { select: { name: true } },
      members: {
        include: { user: { select: { id: true, name: true, role: true } } }
      },
      cause: true,
      parties: { orderBy: [{ role: "asc" }, { ordinal: "asc" }] },
      relatedEntities: { orderBy: { createdAt: "asc" } },
      // 收案登记内容随案件展示（案件详情页要能备查收案时填过的全部信息）
      intake: {
        select: {
          counterclaim: true,
          claimDescription: true,
          description: true,
          contactName: true,
          contactPhone: true,
          receivedAt: true,
          createdBy: { select: { name: true } }
        }
      },
      linksFrom: {
        where: { relatedMatter: { deletedAt: null, ...matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) } },
        include: { relatedMatter: { select: { id: true, internalCode: true, firmCaseNo: true, title: true, status: true } } }
      },
      linksTo: {
        where: { matter: { deletedAt: null, ...matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) } },
        include: { matter: { select: { id: true, internalCode: true, firmCaseNo: true, title: true, status: true } } }
      },
      procedures: {
        orderBy: { order: "asc" },
        include: {
          leadLawyer: { select: { name: true } },
          deadlines: { ...scheduleDenied, orderBy: [{ completed: "asc" }, { dueAt: "asc" }] },
          hearings: { where:{id:{notIn:excludedHearings}}, ...scheduleDenied, orderBy: { startsAt: "asc" } },
          stages: {
            orderBy: { order: "asc" },
            include: {
              tasks: { ...scheduleDenied, include: { responsibility: { select: { state: true, closedAt: true } } }, orderBy: [{ completed: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }] }
            }
          },
          procedureParties: {
            orderBy: [{ standing: "asc" }, { ordinal: "asc" }],
            include: { party: true }
          },
          memos: { ...scheduleDenied, orderBy: [{ done: "asc" }, { createdAt: "desc" }] }
        }
      },
      timelineEvents: {
        ...(!businessAccess || session.user.role === "CUSTOM" ? { where: { eventType: { in: ["MATTER_CREATED", "PROCEDURE_ADDED", "STAGE_ADDED", "STAGE_REMOVED", "DEADLINE_ADDED", "HEARING_SCHEDULED", "TEAM_CHANGED", "MATTER_CLOSED", "MATTER_REOPENED", "MATTER_ON_HOLD", "MATTER_ARCHIVED"] } } } : {}),
        orderBy: { occurredAt: "desc" }, take: 50
      }
    }
  });

  if (matter) {
    await audit({
      userId: session.user.id,
      action: "MATTER_VIEW",
      targetType: "Matter",
      targetId: id
    });
  }
  if (!matter) return null;
  const people = await withRoleNames([matter.owner, ...matter.members.map(member => member.user)]);
  const byId = new Map(people.map(user => [user.id, user]));
  return { ...matter, businessAccess, owner: byId.get(matter.owner.id)!, members: matter.members.map(member => ({ ...member, user: byId.get(member.user.id)! })) };
}

export async function createMatter(input: MatterCreateInput) {
  const session = await requireSession("intakes.create");
  const data = matterCreateSchema.parse(input);
  if ((await approvalSettings()).enabled) throw new ActionError("按事项审批已启用，请先收案登记并完成审批后转为正式案件");
  assertAgencyAllowedForProcedure(data.firstProcedure.handlingAgency, data.firstProcedure.type);
  await assertCauseAllowedForSelection({
    causeId: data.causeId,
    category: data.category,
    procedureType: data.firstProcedure.type
  });

  const internalCode = await generateInternalCode(data.category);
  const firmCaseNo = await generateFirmCaseNo(data.category);
  const [primaryClientId, ...otherClientIds] = data.clientIds;

  const created = await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "intakes.create");
    const matter = await tx.matter.create({
      data: {
        internalCode,
        firmCaseNo,
        title: data.title,
        category: data.category,
        ownerId: session.user.id,
        registeredById: session.user.id,

        ...emptyToNull({
          causeId: data.causeId,
          causeFreeText: data.causeFreeText
        }),

        claimAmount: data.claimAmount ?? undefined,
        ourStanding: data.ourStanding,
        counterclaimAsPlaintiff: data.counterclaimAsPlaintiff,
        counterclaimAsDefendant: data.counterclaimAsDefendant,
        intakeDate: data.intakeDate ?? new Date(),

        primaryClientId,

        // 主办律师默认是创建者
        members: {
          create: { userId: session.user.id, role: "LEAD" }
        },

        // 多客户关联表
        clientLinks: {
          create: data.clientIds.map((cid, idx) => ({
            clientId: cid,
            isPrimary: idx === 0,
            label: idx === 0 ? "主要委托方" : `委托方 ${idx + 1}`
          }))
        },

        // 当事人
        parties: {
          create: data.parties.map((p) =>
            emptyToNull({
              role: p.role,
              ordinal: p.ordinal,
              name: p.name,
              partyType: p.partyType,
              idType: p.partyType === "NATURAL_PERSON" ? (p.idType || "ID_CARD") : null,
              idNumber: p.idNumber,
              phone: p.phone,
              address: p.address,
              legalRep: p.legalRep,
              contactName: p.contactName,
              enterpriseSocialCode: p.enterpriseSocialCode,
              enterpriseName: p.enterpriseName,
              notes: p.notes
            })
          )
        },

        // 首程序
        procedures: {
          create: {
            type: data.firstProcedure.type,
            customLabel: data.firstProcedure.customLabel || null,
            engagement: "ENGAGED",
            order: 1,
            caseNumber: data.firstProcedure.caseNumber || null,
            handlingAgency: data.firstProcedure.handlingAgency || null,
            acceptedAt: data.firstProcedure.acceptedAt,
            status: "IN_PROGRESS"
          }
        },

        firstAcceptedAt: data.firstProcedure.acceptedAt
      }
    });

    // TimelineEvent: 案件创建
    await recordTimelineEvent(tx, {
        matterId: matter.id,
        eventType: "MATTER_CREATED",
        title: "案件已创建",
        occurredAt: new Date()
      });

    // v0.8: 默认卷宗
    await seedDefaultFolders(tx, matter.id, data.category);

    // 标记 otherClientIds 避免被 lint 误判未用
    void otherClientIds;

    return matter;
  });

  await audit({
    userId: session.user.id,
    action: "MATTER_CREATE",
    targetType: "Matter",
    targetId: created.id,
    detail: { internalCode: created.internalCode, title: created.title }
  });

  revalidatePath("/matters");
  return { ok: true, id: created.id, internalCode: created.internalCode };
}

/**
 * v0.5: 更新案件团队。
 * - 仅当前主办律师可操作；管理角色只负责审批，不因角色放开他人案件处理权
 * - ownerId 改变时同步替换 MatterMember 中的 LEAD
 * - coLeadIds 和 assistantIds 覆盖式更新对应角色（不影响主办自动 LEAD）
 */
export async function updateMatterTeam(input: MatterTeamEditInput) {
  const session = await requireSession("matters.write");
  const data = matterTeamEditSchema.parse(input);
  await approvalTransaction(async tx => {
    await checkRoleMutation(tx, session.user, "matters.write");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${session.user.id} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${data.matterId} FOR UPDATE`;
    const actor = await currentActor(tx, session.user.id, "matters.write");
    if (actor.role !== session.user.role || !hasCustomPermission(actor, "matters.write")) throw new ActionError("当前岗位无权修改案件");
    const matter = await tx.matter.findFirst({
      where: { id: data.matterId, deletedAt: null, ownerId: session.user.id },
      select: { id: true, ownerId: true, status: true, members: { select: { userId: true, role: true } } }
    });
    if (!matter) throw new ActionError("只有当前主办律师可以修改承办团队");
    if (matter.status === "ARCHIVED") throw new ActionError("案件已归档，禁止修改");
    const expected = new Map(data.expectedMembers.map(member => [member.userId, member.role]));
    if (matter.ownerId !== data.expectedOwnerId || matter.members.length !== expected.size || matter.members.some(member => expected.get(member.userId) !== member.role)) {
      throw new ActionError("承办团队已变化，请保留选择并重新核对");
    }
    const rows = [
      { matterId: matter.id, userId: matter.ownerId, role: "LEAD" as const },
      ...data.coLeadIds.map(userId => ({ matterId: matter.id, userId, role: "CO_LEAD" as const })),
      ...data.assistantIds.map(userId => ({ matterId: matter.id, userId, role: "ASSISTANT" as const }))
    ];
    await assertAssignableColleagues(rows.map(member => member.userId), matter.members.map(member => member.userId), tx);
    const removed = matter.members.filter(member => !rows.some(next => next.userId === member.userId)).map(member => member.userId);
    if (removed.length) {
      if (!await responsibilityReady(tx)) throw new ActionError("事项责任功能尚未启用，请先完成数据库升级");
      const affectedPeople = { OR: [{ assigneeId: { in: removed } }, { proposedAssigneeId: { in: removed } }] };
      const [work, urgent, procedures] = await Promise.all([
        tx.workResponsibility.count({ where: { state: "OPEN", AND: [affectedPeople, { OR: [
          { task: { matterId: matter.id } }, { deadline: { procedure: { matterId: matter.id } } }, { hearing: { procedure: { matterId: matter.id } } }
        ] }] } }),
        tx.intakeUrgentItem.count({ where: { matterId: matter.id, state: "OPEN", ...affectedPeople } }),
        tx.matterProcedure.count({ where: { matterId: matter.id, status: { not: "CONCLUDED" }, leadLawyerId: { in: removed } } })
      ]);
      if (work || urgent) throw new ActionError("拟移除成员仍有未完成或待接收事项，请先逐项交接");
      if (procedures) throw new ActionError("拟移除成员仍负责未结程序，请先完成程序责任交接");
      await tx.matterMember.deleteMany({ where: { matterId: matter.id, userId: { in: removed } } });
    }
    for (const member of rows) {
      const existing = matter.members.find(current => current.userId === member.userId);
      if (!existing) await tx.matterMember.create({ data: member });
      else if (existing.role !== member.role) await tx.matterMember.update({ where: { matterId_userId: { matterId: matter.id, userId: member.userId } }, data: { role: member.role } });
    }
    await recordTimelineEvent(tx, { matterId: matter.id, eventType: "TEAM_CHANGED", title: "更新办案团队", occurredAt: new Date(), refType: "Matter", refId: matter.id });
    await auditTx(tx, { userId: session.user.id, action: "MATTER_TEAM_UPDATE", targetType: "Matter", targetId: matter.id,
      detail: { ownerId: matter.ownerId, coLeads: data.coLeadIds.length, assistants: data.assistantIds.length } });
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  await revalidateMatter(data.matterId);
  return { ok: true };
}

/** 案件基本信息独立保存；收案日期和状态不由此入口改变。 */
export async function updateMatterBasicInfo(input: MatterBasicEditInput) {
  const session = await requireSession("matters.write");
  const data = matterBasicEditSchema.parse(input);
  await approvalTransaction(async tx => {
    await checkRoleMutation(tx, session.user, "matters.write");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${session.user.id} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id=${data.id} FOR UPDATE`;
    const actor = await currentActor(tx, session.user.id, "matters.write");
    if (actor.role !== session.user.role || !hasCustomPermission(actor, "matters.write")) throw new ActionError("当前岗位无权修改案件");
    const matter = await tx.matter.findFirst({
      where: { id: data.id, deletedAt: null, OR: [{ ownerId: session.user.id }, { members: { some: { userId: session.user.id, role: { in: ["LEAD", "CO_LEAD"] } } } }] },
      select: { id: true, title: true, status: true, updatedAt: true, teamAccessRestricted: true }
    });
    if (!matter) throw new ActionError("只有案件主办/协办可以编辑案件基本信息");
    if (matter.status === "ARCHIVED") throw new ActionError("案件已归档，禁止修改");
    if (matter.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) throw new ActionError("案件信息已变化，请保留输入并重新核对");
    await assertCauseAllowedForMatter(data.id, data.causeId, tx);
    const updated = await tx.matter.updateMany({
      where: { id: data.id, updatedAt: data.expectedUpdatedAt },
      data: { title: data.title, causeId: data.causeId || null, causeFreeText: data.causeFreeText || null,
        claimAmount: data.claimAmount == null ? null : new Prisma.Decimal(data.claimAmount), ourStanding: data.ourStanding ?? null,
        ...(data.teamAccessRestricted !== undefined ? { teamAccessRestricted: data.teamAccessRestricted } : {}) }
    });
    if (updated.count !== 1) throw new ActionError("案件信息已变化，请保留输入并重新核对");
    await auditTx(tx, { userId: session.user.id, action: "MATTER_BASIC_UPDATE", targetType: "Matter", targetId: data.id,
      detail: { titleBefore: matter.title, titleAfter: data.title,
        ...(data.teamAccessRestricted !== undefined && data.teamAccessRestricted !== matter.teamAccessRestricted ? { teamAccessRestricted: data.teamAccessRestricted } : {}) } });
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  await revalidateMatter(data.id);
  return { ok: true };
}

export async function softDeleteMatter(id: string) {
  const session = await requireSession("matters.write");
  await assertMatterWritable(id);
  await assertCanOwnMatter(session.user.id, id, "只有当前主办律师可以删除案件");

  // 2026-09-19 审计：删除前拦截未决交接与未结责任，否则遗留永久 PENDING 的交接、
  // 以及工作台里持续提醒却无入口关闭的待办（提醒查询不过滤 deletedAt）。
  const [handoverTable] = await prisma.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public."MatterHandover"') IS NOT NULL AS ready`;
  if (handoverTable?.ready) {
    const [pending] = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "MatterHandover" WHERE "matterId"=${id} AND status='PENDING'`;
    if (Number(pending.count)) throw new ActionError("案件存在待接收的交接，请先处理或取消交接后再删除");
  }
  if ((await readWorkRows(prisma)).some(w => w.matterId === id && w.state === "OPEN")) {
    throw new ActionError("案件存在未办结事项（任务/期限/开庭），请先办结或作废后再删除");
  }

  await roleMutation(session.user, "matters.write", async roleDb => roleDb.matter.update({
    where: { id },
    data: { deletedAt: new Date() }
  }));

  await audit({
    userId: session.user.id,
    action: "MATTER_DELETE",
    targetType: "Matter",
    targetId: id
  });

  revalidatePath("/matters");
  return { ok: true };
}
