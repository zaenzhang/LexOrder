// @vitest-environment node
// B2 阅读分析管道回归：AI 未配置降级 NEEDS_OCR（不显示为分析成功）、
// AI 输出结构化落建议、拒绝过的建议不重复弹回。
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, ai, ocr } = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    smsMessage: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    smsInboundFile: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    smsSuggestion: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    matterProcedure: { findFirst: vi.fn(), findMany: vi.fn() }
  },
  ai: { aiChat: vi.fn() },
  ocr: { recognizeText: vi.fn() }
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/ai/client", () => ({ aiChat: ai.aiChat, AiNotConfiguredError: class extends Error { constructor() { super("AI 未配置，请先到 管理后台 → AI 与外部服务 填写 API key"); this.name = "AiNotConfiguredError"; } } }));
vi.mock("@/server/ocr/provider", () => ({ recognizeText: ocr.recognizeText, OcrNotConfiguredError: class extends Error { constructor(m: string) { super(m); this.name = "OcrNotConfiguredError"; } } }));
vi.mock("@/lib/storage", () => ({ storage: { readFile: vi.fn(async () => Buffer.from("第1页内容\f第2页内容")), writeFile: vi.fn(async () => "k") } }));
vi.mock("@/lib/documents/text-extraction", () => ({
  extractDocumentTextLayer: vi.fn(async () => ({ text: "第1页内容\f第2页内容", pageCount: 2, source: "PDF_TEXT" })),
  NoTextLayerError: class extends Error {},
  UnsupportedTextExtraction: class extends Error {}
}));

import { analyzeInboundFile, analyzeDocumentText } from "@/server/sms/analysis";
import { AiNotConfiguredError } from "@/lib/ai/client";

const FILE = { id: "f1", smsId: "s1", storageKey: "k", mimeType: "application/pdf", displayName: null, originalName: "传票.pdf", downloadedById: "u1", state: "FILED", sms: { id: "s1", matchedMatterId: null, smsType: "HEARING_NOTICE", parsedJson: {} } };

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async callback => callback(db));
  db.$queryRaw.mockResolvedValue([]);
  db.smsMessage.findUnique.mockResolvedValue({ matchedMatterId: null, processingState: "READY_FOR_REVIEW", processed: false });
  db.smsMessage.update.mockResolvedValue({});
  db.auditLog.create.mockResolvedValue({});
  db.smsInboundFile.findUnique.mockResolvedValue(FILE);
  db.smsInboundFile.update.mockResolvedValue({});
  db.smsSuggestion.findFirst.mockResolvedValue(null);
  db.smsSuggestion.create.mockResolvedValue({});
  db.matterProcedure.findMany.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue({ role: "LAWYER", active: true });
  global.fetch = vi.fn();
});

describe("B2 阅读分析管道", () => {
  it("AI 未配置时文件降级 NEEDS_OCR，不显示为分析成功", async () => {
    ai.aiChat.mockRejectedValue(new AiNotConfiguredError());
    const res = await analyzeInboundFile("f1");
    expect(res.state).toBe("NEEDS_OCR");
    const update = db.smsInboundFile.update.mock.calls.at(-1)![0]; // 末笔为终态写入（首笔是 ANALYZING 占位）
    expect(update.data.analysisState).toBe("NEEDS_OCR");
    expect(update.data.analysisError).toContain("AI 未配置");
  });

  it("文书分类留在文件上，唯一案号提出归属和实际程序候选", async () => {
    ai.aiChat.mockResolvedValue({ content: JSON.stringify({
      docType: "传票", suggestedName: "传票-张三案.pdf",
      fields: [{ key: "caseNumber", value: "（2026）沪01民初1号", page: 1, excerpt: "案号（2026）沪01民初1号" }],
      events: [
        { kind: "HEARING", title: "开庭", dateText: "2026-10-20", timeText: "09:30" },
        { kind: "DEADLINE", title: "举证期限", dateText: "2026-10-10" }
      ],
      caseNumbers: ["（2026）沪01民初1号"], court: "上海市第一中级人民法院"
    }) });
    db.matterProcedure.findMany.mockResolvedValue([{ id: "p1", matterId: "m1", engagement: "ENGAGED", matter: { internalCode: "A-1", title: "张三案" } }]);
    const res = await analyzeInboundFile("f1");
    expect(res.state).toBe("ANALYZED");
    expect(res.suggestionCount).toBe(3); // Only decisions; classification is file metadata.
    const kinds = db.smsSuggestion.create.mock.calls.map(c => c[0].data.kind);
    expect(kinds).toContain("MATTER_MATCH");
    expect(kinds).toContain("HEARING");
    expect(kinds).toContain("DEADLINE");
    expect(kinds).not.toContain("DOC_TYPE");
    expect(db.smsSuggestion.create.mock.calls.find(call => call[0].data.kind === "HEARING")?.[0].data.payload.procedureId).toBe("p1");
  });

  it("拒绝过/已存在的同内容建议不重复创建", async () => {
    ai.aiChat.mockResolvedValue({ content: JSON.stringify({ docType: "传票", fields: [], events: [{ kind: "HEARING", title: "开庭", dateText: "2026-10-20" }], caseNumbers: [] }) });
    db.smsSuggestion.findFirst.mockResolvedValue({ id: "old", status: "REJECTED" });
    const res = await analyzeInboundFile("f1");
    expect(res.state).toBe("ANALYZED");
    expect(db.smsSuggestion.create).not.toHaveBeenCalled();
  });

  it("迟到分析在同一事务按当前案件保存新建议并重开整理，后台不冒充律师确认", async () => {
    db.smsMessage.findUnique.mockResolvedValue({ matchedMatterId: "current-matter", processingState: "ORGANIZED", processed: false });
    ai.aiChat.mockResolvedValue({ content: JSON.stringify({ docType: "传票", fields: [], events: [{ kind: "HEARING", title: "新安排", dateText: "2027-02-03" }], caseNumbers: ["当前案号"] }) });
    const result = await analyzeInboundFile("f1");
    expect(result).toEqual({ state: "ANALYZED", suggestionCount: 1 });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.matterProcedure.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ matterId: "current-matter" }) }));
    expect(db.smsMessage.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { processingState: "READY_FOR_REVIEW" } });
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: null, action: "SMS_ANALYSIS_ADDED_PENDING_SUGGESTIONS", detail: expect.objectContaining({ source: "BACKGROUND_ANALYSIS", sourceDownloadedById: "u1" }) }) }));
  });

  it("AI 输出垃圾文本时标 FAILED 并保留错误信息", async () => {
    ai.aiChat.mockResolvedValue({ content: "这不是 JSON" });
    const res = await analyzeInboundFile("f1");
    expect(res.state).toBe("FAILED");
  });

  it("analyzeDocumentText 拒绝编造：无日期事件被过滤", async () => {
    ai.aiChat.mockResolvedValue({ content: JSON.stringify({ docType: "其他", fields: [], events: [{ kind: "HEARING", title: "无日期开庭", dateText: "" }], caseNumbers: [] }) });
    const doc = await analyzeDocumentText("文本");
    expect(doc.events).toHaveLength(0);
  });
});
