import { z } from "zod";
import type { DocumentParseState } from "@prisma/client";
import { identifierSchema, type ProcessingCoverage, type SourceAnchor } from "@/lib/workbench/contracts";

export const INPUT_COVERAGE_MAX_DOCUMENTS = 50;
export const INPUT_COVERAGE_MAX_CHARS = 36_000;
export const INPUT_COVERAGE_MAX_RANGES = 200;
export const INPUT_COVERAGE_MAX_UNIT_DETAILS = 200;
const selectionId = identifierSchema.trim().min(1);

export const matterInputCoverageSchema = z.strictObject({
  matterId: selectionId,
  documents: z.array(z.strictObject({
    documentId: selectionId,
    // Only an explicit run selects historical parsing of this exact Document version.
    parseRunId: selectionId.optional(),
  })).max(INPUT_COVERAGE_MAX_DOCUMENTS),
}).superRefine((input, context) => {
  const ids = new Set<string>();
  for (const [index, selection] of input.documents.entries()) {
    if (ids.has(selection.documentId)) context.addIssue({
      code: "custom", path: ["documents", index, "documentId"], message: "同一材料版本只能选择一次",
    });
    ids.add(selection.documentId);
  }
});
export type MatterInputCoverageInput = z.infer<typeof matterInputCoverageSchema>;

export const inputCoverageIssueLabels = {
  NOT_PROCESSED: "尚未提取文本",
  PROCESSING_PENDING: "等待提取文本",
  PROCESSING_RUNNING: "正在提取文本",
  PARSE_PENDING: "仍有未识别内容",
  PARSE_FAILED: "部分内容提取失败",
  PARSE_UNSUPPORTED: "存在不支持的内容",
  PARSE_TRUNCATED: "部分内容未能完整提取",
  PROCESSING_CANCELLED: "处理已停止",
  SOURCE_UNVERIFIABLE: "无法核对原件版本",
  SOURCE_UNAVAILABLE: "选定的文本版本不可用",
  INVALID_SNAPSHOT: "已提取内容的来源不完整",
  UNKNOWN_TOTAL: "完整页段数量尚不确定",
  REVIEW_NOT_AUTHORIZED: "没有发起 AI 审查的权限",
  PREPARATION_BUDGET: "超出本次可检查字数",
  HISTORICAL_PARSE: "使用以前提取的文本",
} as const;
export type InputCoverageIssueCode = keyof typeof inputCoverageIssueLabels;
export type InputCoverageIssue = { code: InputCoverageIssueCode; label: string; detail: string };

export type InputCoverageRange = {
  anchorId: string;
  unit: number;
  location: SourceAnchor["location"];
  locationLabel: string;
  /** UTF-16 offsets in this immutable anchor.text; zero-based, end-exclusive. */
  start: number;
  end: number;
  totalChars: number;
};

export type InputProcessingCoverage = {
  unitKind: ProcessingCoverage["unitKind"];
  totalUnits: number | null;
  counts: { ready: number; pending: number; failed: number; unsupported: number; truncated: number };
  units: ProcessingCoverage["units"];
  /** Only details are omitted; counts and totalUnits retain their known values. */
  omittedUnitCount: number;
};

export type AvailableInputCoverageItem = {
  status: "AVAILABLE";
  documentId: string;
  documentName: string;
  documentVersion: number;
  documentSha256: string | null;
  run: { id: string; generation: number; parserVersion: string; isCurrent: boolean } | null;
  processing: { state: DocumentParseState | "NOT_PROCESSED" | "UNAVAILABLE"; label: string };
  coverage: InputProcessingCoverage | null;
  preparation: {
    /** Current source-processing authorization only; says nothing about model configuration. */
    canPrepare: boolean;
    availableChars: number;
    preparedChars: number;
    unpreparedChars: number;
    rangeCount: number;
    ranges: InputCoverageRange[];
    omittedRangeCount: number;
  };
  issues: InputCoverageIssue[];
};

export type MatterInputCoverageItem = AvailableInputCoverageItem | {
  status: "UNAVAILABLE";
  // Echo only the caller's selection; never include former names, hashes or ranges.
  documentId: string;
};

export type MatterInputCoverageView = {
  mode: "PREVIEW";
  matterId: string;
  checkedAt: string;
  budget: {
    maxChars: number;
    maxDocuments: number;
    maxRangeDetails: number;
    maxUnitDetails: number;
    order: "REQUEST_ORDER";
  };
  modelSupply: { status: "NOT_SENT"; sentChars: 0 };
  summary: {
    selectedDocuments: number;
    availableDocuments: number;
    unavailableDocuments: number;
    availableChars: number;
    preparedChars: number;
    rangeCount: number;
    omittedRangeCount: number;
    omittedUnitCount: number;
  };
  items: MatterInputCoverageItem[];
};
