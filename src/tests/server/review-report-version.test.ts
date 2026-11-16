// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ document: vi.fn(), ingest: vi.fn(), handle: vi.fn(), writable: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { document: { findUnique: mocks.document } } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "synthetic-user", role: "LAWYER" } })) }));
vi.mock("@/lib/permissions", () => ({ assertCanHandleMatter: mocks.handle, matterAssociationFilter: vi.fn(), matterVisibilityFilter: vi.fn() }));
vi.mock("@/lib/archive/guard", () => ({ assertDocumentWritable: mocks.writable }));
vi.mock("@/server/documents/material-ingest", () => ({ ingestMaterial: mocks.ingest, withdrawMaterial: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { uploadNewVersion } from "@/server/documents/actions";

const prior = { id: "synthetic-document", matterId: "synthetic-matter", intakeId: null, uploadedById: "synthetic-user",
  deletedAt: null, isLatest: true, version: 1, category: "OTHER", name: "合成原稿.txt", tags: ["合成"],
  reviewReportFor: null, encrypted: false, procedureId: null, stageId: null, folderId: null,
  sourceParty: null, sourceOrigin: null, archiveChecklistItemId: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.document.mockResolvedValue(prior);
  mocks.ingest.mockResolvedValue({ id: "synthetic-new-version", version: 2 });
});

describe("固定审查报告的传新版入口", () => {
  it.each(["relation", "unbound-marker"])("按 %s 拒绝替换，不读取文件正文或进入摄入", async kind => {
    mocks.document.mockResolvedValue({ ...prior,
      reviewReportFor: kind === "relation" ? { id: "synthetic-review-record" } : null,
      tags: kind === "unbound-marker" ? ["AI审查"] : [],
    });
    const file = new File(["合成报告修订"], "修订.txt", { type: "text/plain" });
    const read = vi.spyOn(file, "arrayBuffer");
    await expect(uploadNewVersion({ documentId: prior.id, file })).rejects.toThrow("审查报告为固定记录");
    expect(mocks.handle).toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("普通材料仍以具体原版本和原请求键进入现有摄入", async () => {
    const file = new File(["合成普通材料修订"], "修订.txt", { type: "text/plain" });
    const requestKey = "00000000-0000-4000-8000-000000000001";
    await expect(uploadNewVersion({ documentId: prior.id, file, requestKey })).resolves.toEqual({ ok: true, id: "synthetic-new-version", version: 2 });
    expect(mocks.ingest).toHaveBeenCalledWith(expect.objectContaining({
      priorDocumentId: prior.id, requestKey, document: expect.objectContaining({ tags: prior.tags, matterId: prior.matterId }),
    }));
  });
});
