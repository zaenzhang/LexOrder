import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  assertRead: vi.fn(),
  business: vi.fn(),
  readDocument: vi.fn(),
  matter: vi.fn(),
  documents: vi.fn(),
  folders: vi.fn(),
  templates: vi.fn(),
  summary: vi.fn(),
  finance: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/permissions", () => ({ assertCanReadMatter: mocks.assertRead, hasMatterBusinessAccess: mocks.business }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: mocks.readDocument }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  matter: { findFirst: mocks.matter },
  document: { findMany: mocks.documents },
  documentFolder: { findMany: mocks.folders },
  documentTemplate: { findMany: mocks.templates },
} }));
vi.mock("@/server/finance/actions", () => ({ getMatterFinance: mocks.finance }));
vi.mock("@/server/ai/matter-review-summary", () => ({ getMatterReviewSummary: mocks.summary }));

import { loadMatterDetailFinance, loadMatterMaterials } from "@/server/matters/detail-panels";

function useGrants(...permissionKeys: string[]) {
  mocks.session.mockResolvedValue({ user: { id: "actor", role: "CUSTOM",
    rolePermissions: permissionKeys.map(permissionKey => ({ permissionKey, scope: "OWN" }))
  } });
}

beforeEach(() => {
  vi.resetAllMocks();
  useGrants("matters.read", "documents.read", "finance.read");
  mocks.business.mockResolvedValue(true);
  mocks.matter.mockResolvedValue({ category: "CIVIL_COMMERCIAL", intake: null });
  mocks.documents.mockResolvedValue([{ id: "current" }, { id: "older" }, { id: "restricted" }]);
  mocks.readDocument.mockImplementation(async (_, doc) => doc.id !== "restricted");
  mocks.folders.mockResolvedValue([]);
  mocks.templates.mockResolvedValue([]);
  mocks.finance.mockResolvedValue({ entries: [] });
});

describe("案件区块的独立读取权限", () => {
  it("团队总览资格不能用来直调材料和财务", async () => {
    mocks.business.mockResolvedValue(false);
    await expect(loadMatterMaterials("matter")).rejects.toThrow("无权查看");
    await expect(loadMatterDetailFinance("matter")).rejects.toThrow("无权查看");
    expect(mocks.documents).not.toHaveBeenCalled();
    expect(mocks.finance).not.toHaveBeenCalled();
  });

  it("仅能写材料时可读取模板，不能看到材料元数据与审查汇总", async () => {
    useGrants("matters.read", "documents.write");
    expect(await loadMatterMaterials("matter")).toMatchObject({ documents: [], folders: [], reviewSummary: null });
    expect(mocks.templates).toHaveBeenCalledOnce();
    expect(mocks.documents).not.toHaveBeenCalled();
    expect(mocks.summary).not.toHaveBeenCalled();
    await expect(loadMatterDetailFinance("matter")).rejects.toThrow("无权查看");
    expect(mocks.finance).not.toHaveBeenCalled();
  });

  it("材料逐件鉴权并保留可读历史版本", async () => {
    const result = await loadMatterMaterials("matter");
    expect(result.documents.map(document => document.id)).toEqual(["current", "older"]);
    expect(mocks.readDocument).toHaveBeenCalledTimes(3);
  });

  it("财务读权限失败时不读取收案收费约定", async () => {
    mocks.finance.mockRejectedValue(new Error("案件不存在或无财务权限"));
    await expect(loadMatterDetailFinance("matter")).rejects.toThrow("无财务权限");
    expect(mocks.matter).not.toHaveBeenCalled();
  });
});
