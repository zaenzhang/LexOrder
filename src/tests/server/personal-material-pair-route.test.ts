import { beforeEach, expect, it, vi } from "vitest";

const { findMany, permission } = vi.hoisted(() => ({ findMany: vi.fn(), permission: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { document: { findMany } } }));
vi.mock("@/lib/runtime/mode", () => ({ isPersonalMode: () => true }));
vi.mock("@/lib/runtime/personal-channel", () => ({ personalChannelAllowed: () => true }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "lawyer" } })) }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: permission }));

import { GET } from "@/app/api/personal/matter-workspace/route";

const matter = "c" + "m".repeat(24);
const first = "c" + "a".repeat(24);
const second = "c" + "b".repeat(24);
const rows = [
  { id: second, name: "清单.txt", version: 2, mimeType: "text/plain", isLatest: false },
  { id: first, name: "合同.pdf", version: 1, mimeType: "application/pdf", isLatest: true },
];
function request(ids: string[]) {
  const query = new URLSearchParams({ matter, section: "material-pair" });
  ids.forEach(id => query.append("document", id));
  return new Request("http://localhost/api/personal/matter-workspace?" + query);
}

beforeEach(() => {
  findMany.mockReset().mockResolvedValue(rows);
  permission.mockReset().mockResolvedValue(true);
});
it("并排核对按提交次序返回本案固定原件", async () => {
  const response = await GET(request([first, second]));
  expect(response.status).toBe(200);
  expect(findMany.mock.calls[0][0].where).toMatchObject({ matterId: matter, id: { in: [first, second] }, deletedAt: null });
  expect((await response.json()).versions.map((version: { id: string }) => version.id)).toEqual([first, second]);
});
it("拒绝重复选择，且一份原件受限时不会返回另一份", async () => {
  expect((await GET(request([first, first]))).status).toBe(400);
  expect(findMany).not.toHaveBeenCalled();
  permission.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const denied = await GET(request([first, second]));
  expect(denied.status).toBe(403);
  expect(await denied.json()).not.toHaveProperty("versions");
});
