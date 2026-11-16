// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMatterRoute } from "@/server/matters/route";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { matter: { findMany } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const matter = { id: "cmq3lxgrm002nitzfhh8qn8ql", internalCode: "M2C-2fa82183-21" };
const exactMatter = { ...matter, deletedAt: null };

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([]);
});

describe("事项详情路由解析", () => {
  it("原混合大小写编号优先精确命中，不先转大写查另一事项", async () => {
    findMany.mockResolvedValueOnce([exactMatter]);
    await expect(resolveMatterRoute(matter.internalCode)).resolves.toEqual(matter);
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { OR: [{ id: matter.internalCode }, { internalCode: matter.internalCode }] },
      select: { id: true, internalCode: true, deletedAt: true },
      take: 2
    });
  });

  it("仅唯一的大小写不敏感编号允许回退，并返回真实编号供规范跳转", async () => {
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([matter]);
    await expect(resolveMatterRoute("m2c-2FA82183-21")).resolves.toEqual(matter);
    expect(findMany).toHaveBeenLastCalledWith({
      where: { deletedAt: null, internalCode: { equals: "m2c-2FA82183-21", mode: "insensitive" } },
      select: { id: true, internalCode: true },
      take: 2
    });
  });

  it("两个大小写变体同时匹配时拒绝随意选一案", async () => {
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      matter, { id: "other", internalCode: matter.internalCode.toUpperCase() }
    ]);
    await expect(resolveMatterRoute("m2c-2FA82183-21")).resolves.toBeNull();
  });

  it("原字面百分号编号精确匹配优先，避免二次解码指向另一事项", async () => {
    const literal = { ...exactMatter, internalCode: "M2C-%2F-a" };
    findMany.mockResolvedValueOnce([literal]);
    await expect(resolveMatterRoute(literal.internalCode)).resolves.toEqual({
      id: literal.id, internalCode: literal.internalCode
    });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("URL 编码的混合大小写编号在解码后仍精确命中", async () => {
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([exactMatter]);
    await expect(resolveMatterRoute("M2C%2D2fa82183%2D21")).resolves.toEqual(matter);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { OR: [{ id: matter.internalCode }, { internalCode: matter.internalCode }] }
    }));
  });

  it.each([matter.id, `%63${matter.id.slice(1)}`])("旧 ID %s 保持大小写并可解码", async (param) => {
    if (param !== matter.id) findMany.mockResolvedValueOnce([]);
    findMany.mockResolvedValueOnce([exactMatter]);
    await expect(resolveMatterRoute(param)).resolves.toEqual(matter);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { OR: [{ id: matter.id }, { internalCode: matter.id }] }
    }));
  });

  it("精确匹配已软删除事项立即拒绝，不回退到其他大小写变体", async () => {
    findMany.mockResolvedValueOnce([{ ...exactMatter, deletedAt: new Date() }]);
    await expect(resolveMatterRoute(matter.internalCode)).resolves.toBeNull();
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("精确编号与另一事项 ID 冲突时拒绝歧义", async () => {
    findMany.mockResolvedValueOnce([
      exactMatter, { id: matter.internalCode, internalCode: "LL-2026-OTHER", deletedAt: null }
    ]);
    await expect(resolveMatterRoute(matter.internalCode)).resolves.toBeNull();
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("裸百分号不会抛错，回退候选仍须是相同字面编号", async () => {
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...matter, internalCode: "M2C-100abc" }]);
    await expect(resolveMatterRoute("M2C-100%a")).resolves.toBeNull();
  });

  it("不存在的旧 ID 不会进行 ID 大小写模糊匹配", async () => {
    await expect(resolveMatterRoute(matter.id.toUpperCase())).resolves.toBeNull();
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: {
        deletedAt: null,
        internalCode: { equals: matter.id.toUpperCase(), mode: "insensitive" }
      }
    }));
  });

  it.each(["", "   "])("空参数 %j 不查数据库", async (param) => {
    await expect(resolveMatterRoute(param)).resolves.toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
