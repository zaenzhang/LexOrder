// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { matterHrefById, resolveMatterRoute, revalidateMatter } from "@/server/matters/route";

const { findUnique, findUniqueOrThrow, revalidatePath } = vi.hoisted(() => ({
  findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), revalidatePath: vi.fn()
}));
vi.mock("@/lib/prisma", () => ({ prisma: { matter: { findUnique, findUniqueOrThrow } } }));
vi.mock("next/cache", () => ({ revalidatePath }));

const matter = { id: "cmq3lxgrm002nitzfhh8qn8ql", internalCode: "M2C-2fa82183-21" };
const literal = { id: "literal-matter", internalCode: "M2C-%2F-a" };
const deleted = { id: "deleted-matter", internalCode: "M2C-deleted", deletedAt: new Date() };
const records = [{ ...matter, deletedAt: null }, { ...literal, deletedAt: null }, deleted];

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockImplementation(async ({ where }: { where: { internalCode?: string; id?: string } }) =>
    records.find(record => where.internalCode !== undefined
      ? record.internalCode === where.internalCode : record.id === where.id) ?? null
  );
  findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const record = records.find(row => row.id === where.id);
    if (!record) throw new Error("案件不存在");
    return record;
  });
});

describe("事项详情只按实际编号解析", () => {
  it("精确匹配混合大小写编号，只查询一次", async () => {
    await expect(resolveMatterRoute(matter.internalCode)).resolves.toEqual(matter);
    expect(findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { internalCode: matter.internalCode },
      select: { id: true, internalCode: true, deletedAt: true }
    });
  });

  it.each([matter.id, "m2c-2FA82183-21", "M2C%2D2fa82183%2D21", ` ${matter.internalCode} `, "", "   "])(
    "拒绝非实际编号 %j，不尝试旧 ID、大小写或解码后备", async param => {
      await expect(resolveMatterRoute(param)).resolves.toBeNull();
      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { internalCode: param } }));
    }
  );

  it("Next 已解码的字面百分号编号保持原值", async () => {
    await expect(resolveMatterRoute(literal.internalCode)).resolves.toEqual(literal);
    await expect(resolveMatterRoute("M2C-/-a")).resolves.toBeNull();
  });

  it("不同大小写的真实编号各自精确命中", async () => {
    const upper = { ...matter, id: "upper-matter", internalCode: matter.internalCode.toUpperCase(), deletedAt: null };
    findUnique.mockResolvedValueOnce(upper);
    await expect(resolveMatterRoute(upper.internalCode)).resolves.toEqual({ id: upper.id, internalCode: upper.internalCode });
    expect(findUnique).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { internalCode: upper.internalCode } }));
  });

  it("软删除事项不可打开", async () => {
    await expect(resolveMatterRoute(deleted.internalCode)).resolves.toBeNull();
  });
});

describe("通过主键生成现行通知与缓存地址", () => {
  it("通知链接先取真实编号，不生成主键地址", async () => {
    await expect(matterHrefById(matter.id)).resolves.toBe(`/matters/${matter.internalCode}`);
    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: matter.id }, select: { internalCode: true } });
  });

  it("目标不存在时明确失败，不生成失效的旧 ID 地址", async () => {
    await expect(matterHrefById("missing")).rejects.toThrow("案件不存在");
  });

  it("缓存更新与页面使用相同编号地址", async () => {
    await revalidateMatter(literal.id);
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/matters/M2C-%252F-a");
  });
});
