import { createHash } from "node:crypto";
import type {
  AdapterReply, IndexBinding, IndexProfile, RetrievalScope, RuntimeContext,
  SourceAnchor, SourceVersion,
} from "@/lib/workbench/contracts";

// Engineering fixtures only. No seed/import, real clients, legal conclusions or
// simulated OCR outputs. Original bytes are generated in memory for each run.
export const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const profile: IndexProfile = {
  parserVersion: "synthetic-utf8-v1",
  chunkerVersion: "one-line-v1",
  embeddingProvider: "fixture-only",
  embeddingModel: "fixture-embedding",
  embeddingRevision: "1",
  dimensions: 8,
  preprocessingVersion: "identity-v1",
  optionsFingerprint: digest("synthetic-options-without-credentials"),
};

type DocumentSpec = {
  id: string;
  family?: string;
  version?: number;
  statements: string[];
  pendingLast?: boolean;
};

const specifications: Record<"civil" | "arbitration", DocumentSpec[]> = {
  civil: [
    { id: "contract", statements: ["合成甲公司与合成乙公司订立货物合同。", "合同记载总价120000.00元，交付与质量验收分别确认。"] },
    { id: "delivery", statements: ["2026-05-10签收货物。", "仅确认签收数量，质量验收另行确认。"] },
    { id: "bank", statements: ["2026-05-11付款记录：40000.00元。"] },
    { id: "ledger-v1", family: "ledger", statements: ["客户台账累计付款40000.00元。"] },
    { id: "ledger-v2", family: "ledger", version: 2, statements: ["客户台账累计付款50000.00元。", "其中另10000.00元待补付款凭证。"] },
    { id: "objection", statements: ["2026-05-12对方提出部分货物存在质量问题。", "该陈述的真实性尚待核实。"] },
    { id: "conversation", statements: ["客户称已按约交付。", "对方称仍需补充验收资料。", "此段尚未进入处理结果。"], pendingLast: true },
  ],
  arbitration: [
    { id: "contract", statements: ["合成服务合同总价60000.00元，首期30000.00元。", "尾款与约定验收相关，争议处理条款待核实。"] },
    { id: "delivery", statements: ["2026-06-15服务方邮件称系统已交付，可安排验收。"] },
    { id: "minutes-v1", family: "minutes", statements: ["会议纪要：演示完成。"] },
    { id: "minutes-v2", family: "minutes", version: 2, statements: ["会议纪要：演示完成。", "安全项待整改，尚未签署验收单。"] },
    { id: "objection", statements: ["2026-06-16客户列明未完成事项，提出验收异议。"] },
    { id: "payment", statements: ["付款表记载首期款30000.00元。"] },
    { id: "payment-claim", statements: ["客户邮件称已付款35000.00元。", "额外5000.00元暂无对应凭证。"] },
    { id: "report", statements: ["报告记录已完成演示。", "其余验收项目尚未处理。"], pendingLast: true },
  ],
};

export function createWorkPackage(kind: "civil" | "arbitration", mode: RuntimeContext["mode"] = "PERSONAL") {
  const matterId = "synthetic-" + kind;
  const documents = specifications[kind].map(spec => {
    const documentId = matterId + "-" + spec.id;
    const lines = ["【合成验收资料，不用于真实事项】", ...spec.statements];
    const original = lines.join("\n");
    const bytes = new TextEncoder().encode(original);
    const source: SourceVersion = { kind: "CASE_MATERIAL", documentId, matterId, sha256: digest(bytes) };
    const parseGenerationId = documentId + "-parse-1";
    let start = 0;
    const anchors: SourceAnchor[] = lines.map((text, index) => {
      const anchor: SourceAnchor = {
        anchorId: documentId + "-anchor-" + (index + 1),
        source,
        parseGenerationId,
        unit: index + 1,
        location: { kind: "TEXT", start, end: start + text.length },
        text,
      };
      start += text.length + 1;
      return anchor;
    });
    const binding: IndexBinding = {
      bindingId: documentId + "-binding",
      source,
      parseGenerationId,
      indexGenerationId: documentId + "-index-1",
      profile: { ...profile },
      target: mode === "PERSONAL"
        ? { backend: "LANCEDB", instanceId: "fixture-local", tableId: matterId, documentId: "remote-" + documentId }
        : { backend: "RAGFLOW", instanceId: "fixture-ragflow", datasetId: matterId, documentId: "remote-" + documentId },
      state: "READY",
      coverage: {
        unitKind: "SEGMENT",
        totalUnits: lines.length,
        units: lines.map((_, index) => ({
          unit: index + 1,
          status: spec.pendingLast && index === lines.length - 1 ? "PENDING" : "READY",
        })),
      },
    };
    return {
      id: documentId,
      familyId: matterId + "-" + (spec.family ?? spec.id),
      version: spec.version ?? 1,
      filename: documentId + ".txt",
      original,
      bytes,
      binding,
      // The final unprocessed unit is intentionally NOT an available anchor.
      anchors: spec.pendingLast ? anchors.slice(0, -1) : anchors,
    };
  });
  const context: RuntimeContext = mode === "PERSONAL"
    ? { mode, actorId: "synthetic-local-actor", workspaceId: "synthetic-workspace" }
    : { mode, actorId: "synthetic-member", instanceId: "synthetic-server" };
  const scope: RetrievalScope = { context, matterId, bindings: documents.map(doc => doc.binding) };
  return {
    kind,
    provenance: "SYNTHETIC" as const,
    professionalReview: "PENDING" as const,
    documents,
    scope,
    anchors: documents.flatMap(doc => doc.anchors),
    // These are author-specified expectations, not generated model output.
    expected: kind === "civil" ? {
      support: ["合同记载120000.00元", "有40000.00元付款记录", "发生数量签收"],
      adverse: ["对方提出质量异议"],
      conflicts: ["台账新增10000.00元缺凭证"],
      unknown: ["质量异议是否成立", "付款条件是否满足", "最终可主张金额"],
      forbiddenConclusions: ["全部质量验收通过", "尚欠70000.00元已经确定", "付款已经业务到账确认"],
    } : {
      support: ["存在交付邮件", "会议记载演示完成", "有30000.00元付款记录"],
      adverse: ["未签署验收单", "安全项待整改"],
      conflicts: ["付款记载与邮件相差5000.00元"],
      unknown: ["尾款付款条件是否满足", "仲裁协议效力", "真实程序期限"],
      forbiddenConclusions: ["全部验收通过", "尾款当然应付", "已核实仲裁期限"],
    },
  };
}

export function successfulReply(work: ReturnType<typeof createWorkPackage>, documentIndex = 0): AdapterReply {
  const doc = work.documents[documentIndex];
  const anchor = doc.anchors[1];
  return {
    status: "SUCCESS",
    truncated: false,
    hits: [{
      bindingId: doc.binding.bindingId,
      anchorId: anchor.anchorId,
      indexGenerationId: doc.binding.indexGenerationId,
      quote: anchor.text,
    }],
  };
}

export const unverifiedLegalSource: SourceVersion = {
  kind: "LEGAL_AUTHORITY",
  provider: "synthetic-placeholder",
  recordId: "not-a-real-law",
  revisionId: "1",
  sha256: digest("合成法律来源占位内容；不能作为法律依据"),
  jurisdiction: "CN",
  authorityRole: "OTHER",
  effectiveFrom: null,
  effectiveTo: null,
  retrievedAt: "2026-11-16T00:00:00Z",
  verification: "UNVERIFIED",
  content: "FULL_TEXT",
  canIndex: true,
  canGenerate: true,
};

export const draftPracticeSource: SourceVersion = {
  kind: "PRACTICE_KNOWLEDGE",
  entryId: "synthetic-checklist",
  revisionId: "1",
  sha256: digest("合成方法清单：分别核对签收、验收和付款材料"),
  status: "DRAFT",
  audience: "PERSONAL",
  audienceScopeId: "synthetic-workspace",
};
