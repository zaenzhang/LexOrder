// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => {
  const url = process.env.WORKBENCH_TEST_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith("_test")) throw new Error("案件搜索测试仅允许独立的 _test 数据库");
  return { url, actor: { id: "", role: "LAWYER", runtimeMode: "SERVER" } };
});
vi.mock("@/lib/prisma", async () => {
  const { createPrismaClient } = await import("@/lib/prisma-client");
  return { prisma: createPrismaClient(config.url ?? "postgresql://unused:unused@127.0.0.1:1/search_test") };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: config.actor })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma as db } from "@/lib/prisma";
import { listMatters } from "@/server/matters/actions";
import { buildMattersExportWorkbook } from "@/server/matters/export-xlsx";

const key = randomUUID();
const users: string[] = [], matters: string[] = [], clients: string[] = [];
let ownId: string, teamMatterId: string, teamId: string, primaryId: string, secondaryId: string;
const primaryName = `合成主客户-${key}`, secondaryName = `合成共同客户-${key}`;
const dayStart = new Date("2026-11-16T16:00:00Z"), dayEnd = new Date("2026-11-17T15:59:59.999Z");

async function makeUser() {
  const user = await db.user.create({ data: { name: "合成搜索经办", email: `${randomUUID()}@example.invalid`, passwordHash: "disabled-test-only", role: "LAWYER" } });
  users.push(user.id);
  return user.id;
}
async function makeMatter(ownerId: string, label: string, extra: Partial<Pick<Prisma.MatterUncheckedCreateInput, "firmCaseNo" | "deletedAt" | "teamAccessRestricted">> = {}) {
  const matter = await db.matter.create({ data: {
    title: `合成搜索-${label}-${key}`, internalCode: `S07-${label}-${key}`, ownerId,
    status: "IN_PROGRESS", intakeDate: new Date("2026-11-17T02:00:00Z"), primaryClientId: primaryId,
    clientLinks: { create: { clientId: secondaryId } }, ...extra,
  } });
  matters.push(matter.id);
  return matter.id;
}

describe.skipIf(!config.url)("案件关联搜索：真实 PostgreSQL 与既有服务", () => {
  beforeAll(async () => {
    await db.$connect();
    const reader = await makeUser(), other = await makeUser(), colleague = await makeUser();
    config.actor.id = reader;
    for (const [name, deletedAt] of [[primaryName, null], [secondaryName, new Date()]] as const) {
      const client = await db.client.create({ data: { name, deletedAt, type: "COMPANY", tags: [], ownerUserId: reader } });
      clients.push(client.id);
    }
    [primaryId, secondaryId] = clients;
    ownId = await makeMatter(reader, "主案", { firmCaseNo: `FIRM-${key}` });
    const hiddenId = await makeMatter(other, "无权");
    const deletedId = await makeMatter(reader, "删除", { deletedAt: new Date() });
    teamMatterId = await makeMatter(colleague, "团队可读");
    await makeMatter(colleague, "团队受限", { teamAccessRestricted: true });
    const team = await db.team.create({ data: { name: `合成搜索团队-${key}`, leaderId: colleague,
      members: { create: [{ userId: colleague }, { userId: reader, canViewAllMatters: true }] } } });
    teamId = team.id;

    // 第一个程序位于列表显示的最新20个程序之外，且是保留的历史信息程序。
    await db.matterProcedure.createMany({ data: Array.from({ length: 21 }, (_, index) => ({
      matterId: ownId, type: "FIRST_INSTANCE" as const, order: index + 1,
      caseNumber: index === 0 ? `窗口外程序-${key}` : index < 3 ? `重复命中-${key}` : null,
      engagement: "INFORMATIONAL" as const, status: "CONCLUDED" as const,
      concludedAt: new Date("2026-11-16T04:00:00Z"),
    })) });
    for (const matterId of [hiddenId, deletedId]) {
      await db.matterProcedure.create({ data: { matterId, type: "FIRST_INSTANCE", order: 1, caseNumber: `窗口外程序-${key}` } });
    }
    await db.party.createMany({ data: [
      ...Array.from({ length: 4 }, (_, index) => ({ matterId: ownId, role: "OPPOSING_PARTY" as const,
        ordinal: index + 1, name: index === 3 ? `第四当事人-${key}` : `合成对方${index}-${key}` })),
      { matterId: ownId, role: "THIRD_PARTY", ordinal: 1, name: `第三人-${key}` },
    ] });
  });

  afterAll(async () => {
    await db.matter.updateMany({ where: { id: { in: matters } }, data: { deletedAt: new Date() } });
    await db.client.updateMany({ where: { id: { in: clients } }, data: { deletedAt: new Date() } });
    if (teamId) await db.team.update({ where: { id: teamId }, data: { active: false } });
    await db.user.updateMany({ where: { id: { in: users } }, data: { active: false } });
    await db.$disconnect();
  });

  it.each([
    ["名称", `合成搜索-主案-${key}`], ["内部编号", `S07-主案-${key}`], ["所内案号", `FIRM-${key}`],
    ["历史且在显示窗口外的程序案号", `窗口外程序-${key}`],
    ["第四位对方", `第四当事人-${key}`], ["第三人", `第三人-${key}`],
    ["同案多个程序命中", `重复命中-${key}`],
  ])("按%s匹配真实关联，返回及总数均为一个可读案件", async (_label, search) => {
    const result = await listMatters({ search });
    expect(result.items.map(item => item.id)).toEqual([ownId]);
    expect(result.total).toBe(1);
  });

  it.each([primaryName, secondaryName])("主客户与仍关联的停用共同客户均可查案：%s", async search => {
    const result = await listMatters({ search });
    expect(result.items.map(item => item.id).sort()).toEqual([ownId, teamMatterId].sort());
    expect(result.total).toBe(2);
  });

  it("搜索仍与本人、状态和日期条件求交集，空搜索保留原本人列表", async () => {
    const result = await listMatters({ search: secondaryName, scope: "mine", statusIn: ["IN_PROGRESS"],
      intakeDateFrom: dayStart, intakeDateTo: dayEnd, pageSize: 1 });
    expect(result.items.map(item => item.id)).toEqual([ownId]);
    expect(result.total).toBe(1);
    expect((await listMatters({ search: secondaryName, statusIn: ["ARCHIVED"] })).total).toBe(0);
    expect((await listMatters({ search: secondaryName, intakeDateFrom: new Date("2026-11-18T00:00:00+08:00") })).total).toBe(0);
    expect((await listMatters({ search: "", scope: "mine" })).items.map(item => item.id)).toEqual([ownId]);
  });

  it("共同客户进入导出筛选，但团队只读、无权、受限和删除案件不获导出资格", async () => {
    const params = { tab: "all" as const, search: secondaryName, sortBy: "intakeDate" as const, sortDir: "desc" as const };
    const own = await buildMattersExportWorkbook(params, config.actor);
    expect(own.total).toBe(1);
    expect(own.buffer.length).toBeGreaterThan(0);
    const onlyTeam = await buildMattersExportWorkbook({ ...params, search: `合成搜索-团队可读-${key}` }, config.actor);
    expect(onlyTeam.total).toBe(0);
  });
});
