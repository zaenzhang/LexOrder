import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    matter: { findFirst: vi.fn(), updateMany: vi.fn() },
    matterProcedure: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    party: { findMany: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
    procedureParty: { deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    matterMember: { deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn() }, workResponsibility: { count: vi.fn() }, intakeUrgentItem: { count: vi.fn() }
  };
  return { tx, transaction: vi.fn(), session: vi.fn(), actor: vi.fn(), audit: vi.fn(), timeline: vi.fn(), cause: vi.fn(), revalidate: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: { ...mocks.tx, $transaction: mocks.transaction } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/server/intakes/workflow", () => ({ currentActor: mocks.actor }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: mocks.audit }));
vi.mock("@/server/timeline/record", () => ({ recordTimelineEvent: mocks.timeline }));
vi.mock("@/server/causes/validation", () => ({ assertCauseAllowedForMatter: mocks.cause, assertCauseAllowedForSelection: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: mocks.revalidate }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateMatterBasicInfo, updateMatterTeam, updateProcedureInfo } from "@/server/matters/actions";

const matterId = "cmtestmatter00000000000001";
const ownerId = "cmtestowner000000000000001";
const memberId = "cmtestmember00000000000001";
const partyId = "cmtestparty000000000000001";
const procedureId = "cmtestprocedure00000000001";
const version = new Date("2026-11-16T01:00:00Z");
const members = [{ userId: ownerId, role: "LEAD" as const }, { userId: memberId, role: "CO_LEAD" as const }];
const teamInput = { matterId, expectedOwnerId: ownerId, expectedMembers: members, coLeadIds: [memberId], assistantIds: [] };
const partyEdit = { partyId, expectedUpdatedAt: version, name: "合成当事人", role: "OPPOSING_PARTY" as const,
  partyType: "NATURAL_PERSON" as const, idType: "PASSPORT" as const, idNumber: "TESTONLY123", enterpriseSocialCode: "", legalRep: "", contactName: "", phone: "", address: "" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mocks.tx));
  mocks.session.mockResolvedValue({ user: { id: ownerId, role: "LAWYER" } });
  mocks.actor.mockResolvedValue({ role: "LAWYER" });
  mocks.tx.$queryRaw.mockResolvedValue([{ ready: true }]);
  mocks.tx.matter.findFirst.mockResolvedValue({ id: matterId, ownerId, status: "ACTIVE", title: "原合成案件", updatedAt: version, teamAccessRestricted: false, members });
  mocks.tx.matter.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.matterProcedure.findUnique.mockResolvedValue({ matterId });
  mocks.tx.matterProcedure.findFirst.mockResolvedValue({ id: procedureId, matterId, type: "FIRST_INSTANCE", status: "IN_PROGRESS", updatedAt: version,
    jurisdiction: "上海市", handlingAgency: "合成机构", caseNumber: "合成案号", acceptedAt: version, concludedAt: null, procedureParties: [],
    matter: { status: "ACTIVE", primaryClientId: null, clientLinks: [] } });
  mocks.tx.matterProcedure.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.party.findMany.mockResolvedValue([{ id: partyId, updatedAt: version }]);
  mocks.tx.party.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.user.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map(id => ({ id, active: true })));
  mocks.tx.workResponsibility.count.mockResolvedValue(0);
  mocks.tx.intakeUrgentItem.count.mockResolvedValue(0);
  mocks.tx.matterProcedure.count.mockResolvedValue(0);
  mocks.audit.mockResolvedValue(undefined);
  mocks.timeline.mockResolvedValue(undefined);
  mocks.cause.mockResolvedValue(undefined);
  mocks.revalidate.mockResolvedValue(undefined);
});

describe("分对象编辑的身份、前置值及事务边界", () => {
  it("未认证时不读取案件或程序", async () => {
    mocks.session.mockRejectedValueOnce(new ActionError("请登录"));
    await expect(updateProcedureInfo({ procedureId, expectedUpdatedAt: version })).rejects.toThrow("请登录");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.tx.matterProcedure.findFirst).not.toHaveBeenCalled();
  });

  it("事务内当前身份失效时，在敏感读和写入前停止", async () => {
    mocks.actor.mockRejectedValueOnce(new ActionError("当前岗位无权处理"));
    await expect(updateMatterBasicInfo({ id: matterId, title: "新合成案件", expectedUpdatedAt: version })).rejects.toThrow("当前岗位无权");
    expect(mocks.tx.matter.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.matter.updateMany).not.toHaveBeenCalled();
  });

  it("基本信息仅更新案件，并在同一事务核对案由和写审计", async () => {
    await updateMatterBasicInfo({ id: matterId, title: "新合成案件", expectedUpdatedAt: version, claimAmount: 123, teamAccessRestricted: true });
    expect(mocks.tx.matter.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: matterId, updatedAt: version }, data: expect.objectContaining({ title: "新合成案件", teamAccessRestricted: true }) }));
    expect(mocks.cause).toHaveBeenCalledWith(matterId, undefined, mocks.tx);
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "MATTER_BASIC_UPDATE" }));
    expect(mocks.tx.matterProcedure.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.matterMember.deleteMany).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "ReadCommitted" }));
  });

  it("案件前置时间不同则零写入", async () => {
    await expect(updateMatterBasicInfo({ id: matterId, title: "新合成案件", expectedUpdatedAt: new Date(0) })).rejects.toThrow("案件信息已变化");
    expect(mocks.tx.matter.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("基本信息条件写入发现变化时不写成功审计、不刷新为成功", async () => {
    mocks.tx.matter.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(updateMatterBasicInfo({ id: matterId, title: "新合成案件", expectedUpdatedAt: version })).rejects.toThrow("案件信息已变化");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("关键审计失败使事务回调失败，不再吞错返回成功", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("synthetic audit failure"));
    await expect(updateMatterBasicInfo({ id: matterId, title: "新合成案件", expectedUpdatedAt: version })).rejects.toThrow("synthetic audit failure");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("程序及实际修改的当事人", () => {
  it("省略程序可选字段保持原值，只提交明确提供的字段", async () => {
    await updateProcedureInfo({ procedureId, expectedUpdatedAt: version, caseNumber: "新的合成案号" });
    const data = mocks.tx.matterProcedure.updateMany.mock.calls[0][0].data;
    expect(data).toEqual({ caseNumber: "新的合成案号", updatedAt: expect.any(Date) });
    expect(mocks.tx.procedureParty.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.party.updateMany).not.toHaveBeenCalled();
  });

  it("明确空字符串和 null 清除对应字段，但清除结案日期不重开程序", async () => {
    await updateProcedureInfo({ procedureId, expectedUpdatedAt: version, caseNumber: "", concludedAt: null });
    const data = mocks.tx.matterProcedure.updateMany.mock.calls[0][0].data;
    expect(data).toEqual({ caseNumber: null, concludedAt: null, updatedAt: expect.any(Date) });
    expect(data).not.toHaveProperty("status");
  });

  it("程序版本冲突在当事人写入前停止", async () => {
    await expect(updateProcedureInfo({ procedureId, expectedUpdatedAt: new Date(0), updatedParties: [partyEdit] })).rejects.toThrow("程序已被其他人修改");
    expect(mocks.tx.party.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.matterProcedure.updateMany).not.toHaveBeenCalled();
  });

  it("当事人不属本案，即使未在程序关联列表里也不能修改", async () => {
    mocks.tx.party.findMany.mockResolvedValueOnce([]);
    await expect(updateProcedureInfo({ procedureId, expectedUpdatedAt: version, updatedParties: [partyEdit] })).rejects.toThrow("不属于本案");
    expect(mocks.tx.party.findMany).toHaveBeenCalledWith({ where: { id: { in: [partyId] }, matterId }, select: { id: true, updatedAt: true } });
    expect(mocks.tx.party.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.matterProcedure.updateMany).not.toHaveBeenCalled();
  });

  it("Party 版本冲突在任何实际对象写入前停止", async () => {
    await expect(updateProcedureInfo({ procedureId, expectedUpdatedAt: version, updatedParties: [{ ...partyEdit, expectedUpdatedAt: new Date(0) }] })).rejects.toThrow("当事人「合成当事人」已被其他人修改");
    expect(mocks.tx.party.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.matterProcedure.updateMany).not.toHaveBeenCalled();
  });

  it("只修改指定 Party，所有对象写入及审计使用同一事务", async () => {
    await updateProcedureInfo({ procedureId, expectedUpdatedAt: version, updatedParties: [partyEdit] });
    expect(mocks.tx.party.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: partyId, matterId, updatedAt: version }, data: expect.objectContaining({ name: "合成当事人" }) }));
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "PROCEDURE_INFO_UPDATE" }));
    expect(mocks.tx.matter.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.matterMember.update).not.toHaveBeenCalled();
  });

  it("保留未变化程序关系的 note、创建时间和顺序，不先全删再建", async () => {
    const proc = await mocks.tx.matterProcedure.findFirst();
    mocks.tx.matterProcedure.findFirst.mockResolvedValue({ ...proc, procedureParties: [{ id: "relation1", partyId, standing: "DEFENDANT", ordinal: 7, note: "合成备注" }] });
    await updateProcedureInfo({ procedureId, expectedUpdatedAt: version, caseNumber: "新号", procedureParties: [{ partyId, standing: "DEFENDANT" }] });
    expect(mocks.tx.procedureParty.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.procedureParty.create).not.toHaveBeenCalled();
    expect(mocks.tx.procedureParty.update).not.toHaveBeenCalled();
  });

  it("不能用其他案件的 client 虚拟标识创建本案当事人", async () => {
    await expect(updateProcedureInfo({ procedureId, expectedUpdatedAt: version, procedureParties: [{ partyId: "client:cmtestclient00000000000001", standing: "PLAINTIFF" }] })).rejects.toThrow("不属于本案的客户");
    expect(mocks.tx.party.create).not.toHaveBeenCalled();
    expect(mocks.tx.matterProcedure.updateMany).not.toHaveBeenCalled();
  });
});

describe("成员独立保存及主办交接边界", () => {
  it("拒绝夹带 ownerId 的旧合同，不由成员编辑改变主办", async () => {
    await expect(updateMatterTeam({ ...teamInput, ownerId: memberId } as typeof teamInput)).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("原主办或成员角色集合变化即拒绝陈旧表单", async () => {
    await expect(updateMatterTeam({ ...teamInput, expectedOwnerId: memberId, coLeadIds: [] })).rejects.toThrow("承办团队已变化");
    await expect(updateMatterTeam({ ...teamInput, expectedMembers: [{ userId: ownerId, role: "LEAD" }, { userId: memberId, role: "ASSISTANT" }] })).rejects.toThrow("承办团队已变化");
    expect(mocks.tx.matterMember.update).not.toHaveBeenCalled();
    expect(mocks.tx.matterMember.deleteMany).not.toHaveBeenCalled();
  });

  it("权限查询只允许当前主办，不使用客户端 expectedOwnerId 授权", async () => {
    mocks.tx.matter.findFirst.mockResolvedValueOnce(null);
    await expect(updateMatterTeam(teamInput)).rejects.toThrow("只有当前主办");
    expect(mocks.tx.matter.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: matterId, deletedAt: null, ownerId } }));
    expect(mocks.tx.matterMember.update).not.toHaveBeenCalled();
  });

  it("成员角色变更原位更新、保留加入时间，成员事件与审计同事务", async () => {
    await updateMatterTeam({ ...teamInput, coLeadIds: [], assistantIds: [memberId] });
    expect(mocks.tx.matterMember.update).toHaveBeenCalledWith({ where: { matterId_userId: { matterId, userId: memberId } }, data: { role: "ASSISTANT" } });
    expect(mocks.tx.matterMember.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.matterMember.create).not.toHaveBeenCalled();
    expect(mocks.tx.matter.updateMany).not.toHaveBeenCalled();
    expect(mocks.timeline).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ eventType: "TEAM_CHANGED" }));
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "MATTER_TEAM_UPDATE" }));
  });

  it.each(["work", "urgent", "procedure"] as const)("拟移除人员仍承担 %s 时必须先交接", async kind => {
    if (kind === "work") mocks.tx.workResponsibility.count.mockResolvedValueOnce(1);
    if (kind === "urgent") mocks.tx.intakeUrgentItem.count.mockResolvedValueOnce(1);
    if (kind === "procedure") mocks.tx.matterProcedure.count.mockResolvedValueOnce(1);
    await expect(updateMatterTeam({ ...teamInput, coLeadIds: [] })).rejects.toThrow(/交接/);
    expect(mocks.tx.matterMember.deleteMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("已归档案件不能用成员编辑绕过归档边界", async () => {
    mocks.tx.matter.findFirst.mockResolvedValueOnce({ id: matterId, ownerId, status: "ARCHIVED", members });
    await expect(updateMatterTeam(teamInput)).rejects.toThrow("案件已归档");
    expect(mocks.tx.matterMember.update).not.toHaveBeenCalled();
  });
});
