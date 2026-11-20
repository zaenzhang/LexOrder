// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentParseRun, Prisma } from "@prisma/client";
import type { ProcessingCoverage, SourceAnchor } from "@/lib/workbench/contracts";
import { matterInputCoverageSchema, type AvailableInputCoverageItem } from "@/lib/ai/input-coverage";

const { db, canRead, canReview, resolveRole, session } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() }, document: { findMany: vi.fn() }, documentParseRun: { findFirst: vi.fn() } },
  canRead: vi.fn(), canReview: vi.fn(), resolveRole: vi.fn(), session: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: canRead }));
vi.mock("@/server/ai/document-access", () => ({ canReviewDocument: canReview }));
vi.mock("@/lib/roles/service", () => ({ resolveRoleUser: resolveRole, checkRoleMutation: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: session }));
vi.mock("@/lib/archive/guard", () => ({ isArchiveFolderName: vi.fn() }));
vi.mock("@/server/cron/queue", () => ({ assertCurrentJobLease: vi.fn() }));
vi.mock("@/server/audit", () => ({ auditTx: vi.fn() }));

import { readMatterInputCoverage } from "@/server/ai/input-coverage-service";
import { getMatterInputCoverage } from "@/server/ai/input-coverage-actions";

const matterId = "synthetic-matter";
const sha = "a".repeat(64);
function document(id: string, parseGeneration = 1) {
  return { id, matterId, intakeId: null, uploadedById: "uploader", deletedAt: null,
    name: `合成材料-${id}`, version: 1, sha256: sha, parseGeneration };
}
type TestDocument = ReturnType<typeof document>;
function run(doc: TestDocument, texts = ["合成文本"], options: { generation?: number; id?: string; coverage?: ProcessingCoverage; state?: DocumentParseRun["state"] } = {}): DocumentParseRun {
  const generation = options.generation ?? doc.parseGeneration;
  const id = options.id ?? `run-${doc.id}-${generation}`;
  const coverage: ProcessingCoverage = options.coverage ?? {
    unitKind: "PAGE", totalUnits: texts.length, units: texts.map((_, index) => ({ unit: index + 1, status: "READY" })),
  };
  const anchors: SourceAnchor[] = texts.map((text, index) => ({
    anchorId: `anchor-${doc.id}-${index + 1}`, parseGenerationId: id, unit: index + 1,
    source: { kind: "CASE_MATERIAL", documentId: doc.id, matterId, sha256: sha },
    location: { kind: "PAGE", page: index + 1 }, text,
  }));
  return { id, documentId: doc.id, generation, requestedById: "uploader", parserVersion: "synthetic-parser-v1", sourceSha256: sha,
    state: options.state ?? "READY", anchors: anchors as unknown as Prisma.JsonValue, coverage: coverage as unknown as Prisma.JsonValue,
    errorCode: null, createdAt: new Date(), startedAt: new Date(), finishedAt: new Date() };
}
let documents: TestDocument[];
let runs: DocumentParseRun[];
beforeEach(() => {
  vi.resetAllMocks();
  documents = [document("a")];
  runs = [run(documents[0])];
  db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER" });
  resolveRole.mockResolvedValue({ enabled: true, role: "LAWYER" });
  canRead.mockResolvedValue(true);
  canReview.mockResolvedValue(true);
  session.mockResolvedValue({ user: { id: "current-user" } });
  db.document.findMany.mockImplementation(async ({ where }: { where: Prisma.DocumentWhereInput }) => {
    const selected = (where.id as { in: string[] }).in;
    return documents.filter(doc => selected.includes(doc.id) && doc.matterId === where.matterId);
  });
  db.documentParseRun.findFirst.mockImplementation(async ({ where }: { where: Prisma.DocumentParseRunWhereInput }) =>
    runs.find(row => row.documentId === where.documentId && (where.id ? row.id === where.id : row.generation === where.generation)) ?? null);
});
const input = (ids = ["a"]) => ({ matterId, documents: ids.map(documentId => ({ documentId })) });
function available(item: Awaited<ReturnType<typeof readMatterInputCoverage>>["items"][number]): AvailableInputCoverageItem {
  expect(item.status).toBe("AVAILABLE");
  if (item.status !== "AVAILABLE") throw new Error("Expected an available fixture");
  return item;
}

describe("离线指定材料输入检查", () => {
  it("空选择不读取材料或角色，不扩大到全案", async () => {
    const result = await readMatterInputCoverage("current-user", input([]));
    expect(result.items).toEqual([]);
    expect(result.modelSupply).toEqual({ status: "NOT_SENT", sentChars: 0 });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.document.findMany).not.toHaveBeenCalled();
    expect(db.documentParseRun.findFirst).not.toHaveBeenCalled();
  });

  it("无权或缺失的显式选择只返回请求 ID，不读解析正文或泄漏名称", async () => {
    canRead.mockResolvedValue(false);
    const result = await readMatterInputCoverage("current-user", input(["a", "missing"]));
    expect(result.items).toEqual([{ status: "UNAVAILABLE", documentId: "a" }, { status: "UNAVAILABLE", documentId: "missing" }]);
    expect(db.document.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: { in: ["a", "missing"] }, matterId, deletedAt: null, matter: { is: { deletedAt: null } },
    } }));
    expect(db.documentParseRun.findFirst).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(documents[0].name);
    expect(JSON.stringify(result)).not.toContain(sha);
  });

  it("请求顺序决定预算，部分页保留原位置和 UTF-16 范围，始终没有模型供给记录", async () => {
    documents = [document("a"), document("b")];
    runs = [run(documents[0], ["另一附件的反证"]), run(documents[1], ["b".repeat(35_999) + "😀尾页风险"])];
    const result = await readMatterInputCoverage("current-user", input(["b", "a"]));
    const first = available(result.items[0]);
    expect(first.documentId).toBe("b");
    expect(first.preparation.preparedChars).toBe(35_999);
    expect(first.preparation.ranges[0]).toMatchObject({ location: { kind: "PAGE", page: 1 }, start: 0, end: 35_999, totalChars: 36_005 });
    expect(first.issues.map(item => item.code)).toContain("PREPARATION_BUDGET");
    const second = available(result.items[1]);
    expect(second.preparation.preparedChars).toBe(0);
    expect(second.issues.map(item => item.code)).toContain("PREPARATION_BUDGET");
    expect(result.modelSupply).toEqual({ status: "NOT_SENT", sentChars: 0 });
    expect(JSON.stringify(result)).not.toContain("另一附件的反证");
  });

  it("案级预检遍历多个批次，切分时保留完整字符且不会返回正文", async () => {
    documents = [document("a"), document("b"), document("restricted"), document("unprocessed")];
    const body = "a".repeat(5999) + "😀" + "b".repeat(36_015) + "尾文字";
    runs = [run(documents[0], [body]), run(documents[1], ["第二份"]), run(documents[2], ["无处理权限的文字"])];
    canReview.mockImplementation(async (_user, row: TestDocument) => row.id !== "restricted");
    const result = await readMatterInputCoverage("current-user", { ...input(["a", "b", "restricted", "unprocessed", "missing"]), purpose: "FACT_ANALYSIS" });
    expect(result.modelSupply).toEqual({ status: "NOT_SENT", sentChars: 0 });
    const plan = result.analysisPlan;
    if (!plan) throw new Error("Expected partitioned analysis plan");
    expect(plan.batches).toHaveLength(2);
    expect(plan.plannedCharacters).toBe(body.length + "第二份".length);
    expect(plan.unplannedCharacters).toBe(0);
    const ranges = plan.batches.flatMap(batch => {
      expect(batch.characters).toBeLessThanOrEqual(36_000);
      expect(batch.ranges.length).toBeLessThanOrEqual(8);
      return batch.ranges;
    });
    expect(ranges[0]).toMatchObject({ documentId: "a", parseRunId: runs[0].id, start: 0, end: 5999 });
    expect(ranges.filter(range => range.documentId === "a").map(range => body.slice(range.start, range.end)).join("")).toEqual(body);
    expect(ranges.at(-1)).toMatchObject({ documentId: "b", parseRunId: runs[1].id });
    expect(result.items[3]).toMatchObject({ processing: { state: "NOT_PROCESSED" } });
    expect(result.items[4]).toEqual({ documentId: "missing", status: "UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("尾文字");
  });

  it("计划超过展示分段上限时逐字符披露余量", async () => {
    runs = [run(documents[0], Array.from({ length: 204 }, (_, index) => index + "字"))];
    const result = await getMatterInputCoverage({ ...input(), purpose: "FACT_ANALYSIS" });
    const plan = result.analysisPlan;
    if (!plan) throw new Error("Expected partitioned analysis plan");
    expect(plan.batches.flatMap(batch => batch.ranges)).toHaveLength(200);
    expect(plan.unplannedCharacters).toBe(16);
    expect(plan.plannedCharacters + plan.unplannedCharacters).toBe(result.summary.availableChars);
  });

  it.each(["source", "write"])("有阅读权但缺 %s 处理资格仍可查看本地范围", async (denied) => {
    if (denied === "source") canReview.mockResolvedValue(false);
    else resolveRole.mockResolvedValue({ enabled: true, role: "CUSTOM", rolePermissions: [{ permissionKey: "documents.read", scope: "OWN" }] });
    const item = available((await readMatterInputCoverage("current-user", input())).items[0]);
    expect(item.preparation).toMatchObject({ canPrepare: false, availableChars: 4, preparedChars: 0, rangeCount: 0 });
    expect(item.coverage?.counts.ready).toBe(1);
    expect(item.issues.map(entry => entry.code)).toContain("REVIEW_NOT_AUTHORIZED");
  });

  it("逐项区分未识别、失败、不支持和解析截断，不把末页缺口当已读", async () => {
    runs = [run(documents[0], ["第一页"], { state: "PARTIAL", coverage: {
      unitKind: "PAGE", totalUnits: 5, units: [
        { unit: 1, status: "READY" }, { unit: 2, status: "PENDING" }, { unit: 3, status: "FAILED" },
        { unit: 4, status: "UNSUPPORTED" }, { unit: 5, status: "TRUNCATED" },
      ],
    } })];
    const item = available((await readMatterInputCoverage("current-user", input())).items[0]);
    expect(item.coverage?.counts).toEqual({ ready: 1, pending: 1, failed: 1, unsupported: 1, truncated: 1 });
    expect(item.preparation.ranges.map(range => range.unit)).toEqual([1]);
    expect(item.issues.map(entry => entry.code)).toEqual(expect.arrayContaining(["PARSE_PENDING", "PARSE_FAILED", "PARSE_UNSUPPORTED", "PARSE_TRUNCATED"]));
  });

  it("当前新处理尚未开始不会借用旧 ready；只有显式历史选择才返回旧文本范围", async () => {
    documents = [document("a", 2)];
    const old = run(documents[0], ["旧文本"], { generation: 1 });
    const pending = { ...run(documents[0], [], { state: "PENDING" }), coverage: null, finishedAt: null };
    runs = [old, pending];
    const current = available((await readMatterInputCoverage("current-user", input())).items[0]);
    expect(current.run).toMatchObject({ id: pending.id, isCurrent: true });
    expect(current.preparation.preparedChars).toBe(0);
    expect(current.issues.map(entry => entry.code)).toContain("PROCESSING_PENDING");
    const historical = available((await readMatterInputCoverage("current-user", {
      matterId, documents: [{ documentId: "a", parseRunId: old.id }],
    })).items[0]);
    expect(historical.run).toMatchObject({ id: old.id, isCurrent: false });
    expect(historical.preparation.preparedChars).toBe(3);
    expect(historical.issues.map(entry => entry.code)).toContain("HISTORICAL_PARSE");
    expect(db.documentParseRun.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: old.id, documentId: "a" } }));
  });

  it("未知总量保留 null；已知片段不能推定完整材料", async () => {
    runs = [run(documents[0], ["合成文本"], { coverage: { unitKind: "PAGE", totalUnits: null, units: [{ unit: 1, status: "READY" }] } })];
    const item = available((await readMatterInputCoverage("current-user", input())).items[0]);
    expect(item.coverage?.totalUnits).toBeNull();
    expect(item.preparation.preparedChars).toBe(4);
    expect(item.issues.map(entry => entry.code)).toContain("UNKNOWN_TOTAL");
  });

  it.each(["other-document", "wrong-hash", "invalid-anchor"])("%s 不能成为输入范围", async (mismatch) => {
    if (mismatch === "other-document") runs[0].documentId = "other-document";
    if (mismatch === "wrong-hash") runs[0].sourceSha256 = "b".repeat(64);
    if (mismatch === "invalid-anchor") {
      const anchors = runs[0].anchors as unknown as SourceAnchor[];
      anchors[0].source = { kind: "CASE_MATERIAL", documentId: "other-document", matterId, sha256: sha };
    }
    const item = available((await readMatterInputCoverage("current-user", { matterId, documents: [{ documentId: "a", parseRunId: runs[0].id }] })).items[0]);
    expect(item.preparation).toMatchObject({ preparedChars: 0, availableChars: 0, ranges: [] });
    expect(item.issues.map(entry => entry.code)).toContain(mismatch === "invalid-anchor" ? "INVALID_SNAPSHOT" : "SOURCE_UNAVAILABLE");
  });

  it.each([false, true])("返回前出现新代次时显式历史=%s 的行为不同", async (historical) => {
    db.document.findMany.mockResolvedValueOnce([documents[0]]).mockResolvedValueOnce([{ ...documents[0], parseGeneration: 2 }]);
    const result = await readMatterInputCoverage("current-user", {
      matterId, documents: [{ documentId: "a", ...(historical ? { parseRunId: runs[0].id } : {}) }],
    });
    if (!historical) expect(result.items).toEqual([{ status: "UNAVAILABLE", documentId: "a" }]);
    else expect(available(result.items[0]).run?.isCurrent).toBe(false);
  });

  it("读取中撤销来源资格后清掉整项，并在过滤后重新分配可读材料预算", async () => {
    documents = [document("a"), document("b")];
    runs = [run(documents[0], ["a".repeat(36_000)]), run(documents[1], ["b".repeat(36_000)])];
    const reads = new Map<string, number>();
    canRead.mockImplementation(async (_userId: string, doc: TestDocument) => {
      const count = (reads.get(doc.id) ?? 0) + 1; reads.set(doc.id, count);
      return doc.id !== "a" || count === 1;
    });
    const result = await readMatterInputCoverage("current-user", input(["a", "b"]));
    expect(result.items[0]).toEqual({ status: "UNAVAILABLE", documentId: "a" });
    expect(available(result.items[1]).preparation.preparedChars).toBe(36_000);
    expect(result.summary.availableChars).toBe(36_000);
    expect(JSON.stringify(result)).not.toContain(documents[0].name);
  });

  it.each(["deleted", "changed-hash", "disabled-account"])("返回前 %s 不保留原名称/范围/计数", async (change) => {
    if (change === "deleted") db.document.findMany.mockResolvedValueOnce(documents).mockResolvedValueOnce([]);
    if (change === "changed-hash") db.document.findMany.mockResolvedValueOnce(documents).mockResolvedValueOnce([{ ...documents[0], sha256: "b".repeat(64) }]);
    if (change === "disabled-account") db.user.findUnique.mockResolvedValueOnce({ active: true, role: "LAWYER" }).mockResolvedValueOnce({ active: false, role: "LAWYER" });
    const result = await readMatterInputCoverage("current-user", input());
    expect(result.items).toEqual([{ status: "UNAVAILABLE", documentId: "a" }]);
    expect(result.summary).toMatchObject({ availableChars: 0, preparedChars: 0, rangeCount: 0 });
  });

  it("范围与单元明细上限按整次请求执行，数量及省略数仍可核对", async () => {
    documents = [document("a"), document("b")];
    runs = [run(documents[0], Array<string>(150).fill("字")), run(documents[1], Array<string>(100).fill("字"))];
    const result = await readMatterInputCoverage("current-user", input(["a", "b"]));
    expect(result.summary).toMatchObject({ preparedChars: 250, rangeCount: 250, omittedRangeCount: 50, omittedUnitCount: 50 });
    expect(available(result.items[0]).preparation.ranges).toHaveLength(150);
    expect(available(result.items[1]).preparation.ranges).toHaveLength(50);
    expect(available(result.items[1]).coverage?.counts.ready).toBe(100);
    expect(result.modelSupply).toEqual({ status: "NOT_SENT", sentChars: 0 });
  });

  it("严格拒绝额外授权字段、重复/过量/空白选择，动作使用真实会话身份", async () => {
    const invalid = [
      { ...input(), userId: "forged" }, { ...input(), maxChars: 1_000_000 },
      input(["a", "a"]), input(Array.from({ length: 51 }, (_, index) => `doc-${index}`)), input([" "]),
    ];
    for (const value of invalid) expect(() => matterInputCoverageSchema.parse(value)).toThrow();
    const result = await getMatterInputCoverage(input());
    expect(session).toHaveBeenCalledWith("documents.read");
    expect(canRead).toHaveBeenCalledWith("current-user", expect.objectContaining({ id: "a" }));
    expect(result.mode).toBe("PREVIEW");
  });
});
