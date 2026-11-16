/** Internal read service: actor IDs are trusted server inputs, never RPC arguments. */
import type { DocumentParseState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canReadDocument } from "@/lib/approvals/documents";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { resolveRoleUser } from "@/lib/roles/service";
import { canReviewDocument } from "@/server/ai/document-access";
import { materialLocationLabel, publishedMaterialSnapshot } from "@/server/documents/material-processing";
import { processingCoverageSchema, type ProcessingCoverage, type SourceAnchor } from "@/lib/workbench/contracts";
import {
  INPUT_COVERAGE_MAX_CHARS, INPUT_COVERAGE_MAX_DOCUMENTS, INPUT_COVERAGE_MAX_RANGES,
  INPUT_COVERAGE_MAX_UNIT_DETAILS, inputCoverageIssueLabels, matterInputCoverageSchema,
  type AvailableInputCoverageItem, type InputCoverageIssue, type InputCoverageIssueCode,
  type InputProcessingCoverage, type MatterInputCoverageInput, type MatterInputCoverageItem,
  type MatterInputCoverageView,
} from "@/lib/ai/input-coverage";

const documentSelect = {
  id: true, matterId: true, intakeId: true, uploadedById: true, deletedAt: true,
  name: true, version: true, sha256: true, parseGeneration: true,
} satisfies Prisma.DocumentSelect;
const runSelect = {
  id: true, documentId: true, generation: true, parserVersion: true, sourceSha256: true,
  state: true, coverage: true, anchors: true, errorCode: true, finishedAt: true,
} satisfies Prisma.DocumentParseRunSelect;
type InputDocument = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;
type InputRun = Prisma.DocumentParseRunGetPayload<{ select: typeof runSelect }>;
type AnchorMeasure = Pick<SourceAnchor, "anchorId" | "unit" | "location"> & { chars: number; prefix: string };
type Candidate = {
  document: InputDocument;
  explicitRun: boolean;
  run: Pick<InputRun, "id" | "generation" | "parserVersion" | "finishedAt"> | null;
  coverage: ProcessingCoverage | null;
  anchors: AnchorMeasure[];
  issues: InputCoverageIssue[];
  state: AvailableInputCoverageItem["processing"]["state"];
};
type AuthorizedCandidate = Candidate & { canPrepare: boolean };

const processingLabels: Record<AvailableInputCoverageItem["processing"]["state"], string> = {
  NOT_PROCESSED: "尚未提取文本", PENDING: "等待提取文本", RUNNING: "正在提取文本", READY: "文本提取完成",
  PARTIAL: "部分内容可读", FAILED: "文本提取失败", UNSUPPORTED: "暂不支持", CANCELLED: "已停止处理",
  UNAVAILABLE: "已提取内容暂不可用",
};
const stateIssues: Partial<Record<DocumentParseState, InputCoverageIssueCode>> = {
  PENDING: "PROCESSING_PENDING", RUNNING: "PROCESSING_RUNNING", FAILED: "PARSE_FAILED",
  UNSUPPORTED: "PARSE_UNSUPPORTED", CANCELLED: "PROCESSING_CANCELLED",
};
const issueDetails: Record<InputCoverageIssueCode, string> = {
  NOT_PROCESSED: "尚未从当前材料提取文本；可先查看原件或处理材料。",
  PROCESSING_PENDING: "当前文本提取尚未开始；本次检查不会改用以前提取的文本。",
  PROCESSING_RUNNING: "文本仍在提取中，请稍后重新检查。",
  PARSE_PENDING: "仍有内容等待识别，本次检查未包含这些内容。",
  PARSE_FAILED: "提取失败的部分未纳入本次检查，请查看原件或重试处理。",
  PARSE_UNSUPPORTED: "暂不支持的部分未纳入本次检查，可查看原件或补传可读版本。",
  PARSE_TRUNCATED: "提取时已有内容被截断，本次检查不包含该部分。",
  PROCESSING_CANCELLED: "文本处理已停止，本次检查未使用其内容。",
  SOURCE_UNVERIFIABLE: "原件版本标识缺失或无效，请先核对材料版本。",
  SOURCE_UNAVAILABLE: "选定文本与原件版本不一致或已不可用，请重新选择。",
  INVALID_SNAPSHOT: "已提取文本的位置和处理记录无法核对，不能计入本次可检查内容。",
  UNKNOWN_TOTAL: "目前无法确定完整页段总量，已有文本不代表整份材料均已处理。",
  REVIEW_NOT_AUTHORIZED: "仍可查看材料的处理情况；当前没有对这份材料发起 AI 审查的权限。",
  PREPARATION_BUDGET: "按所选材料顺序检查时达到字数上限，超出部分本次未包含。",
  HISTORICAL_PARSE: "本次明确选择了以前提取的文本，仍对应原材料版本，没有替换为新版。",
};
function issue(code: InputCoverageIssueCode): InputCoverageIssue {
  return { code, label: inputCoverageIssueLabels[code], detail: issueDetails[code] };
}
function addIssue(issues: InputCoverageIssue[], code: InputCoverageIssueCode) {
  if (!issues.some(item => item.code === code)) issues.push(issue(code));
}
async function currentActor(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!user?.active) return null;
  const actor = await resolveRoleUser(userId, user.role);
  return actor.enabled && hasCustomPermission(actor, "documents.read") ? actor : null;
}
function documentWhere(matterId: string, ids: string[]): Prisma.DocumentWhereInput {
  return { id: { in: ids }, matterId, deletedAt: null, matter: { is: { deletedAt: null } } };
}
function unavailable(documentId: string): MatterInputCoverageItem {
  return { status: "UNAVAILABLE", documentId };
}

/** Keep only bounded text prefixes needed to avoid splitting a UTF-16 surrogate pair. */
function measureAnchors(anchors: SourceAnchor[]): AnchorMeasure[] {
  let prefixBudget = INPUT_COVERAGE_MAX_CHARS;
  return [...anchors].sort((a, b) => a.unit - b.unit || (a.anchorId < b.anchorId ? -1 : a.anchorId > b.anchorId ? 1 : 0)).map(anchor => {
    const prefix = prefixBudget > 0 ? anchor.text.slice(0, prefixBudget + 1) : "";
    prefixBudget -= Math.min(prefixBudget, anchor.text.length);
    return { anchorId: anchor.anchorId, unit: anchor.unit, location: anchor.location, chars: anchor.text.length, prefix };
  });
}

async function readCandidate(document: InputDocument, selection: MatterInputCoverageInput["documents"][number]): Promise<Candidate> {
  const result: Candidate = {
    document, explicitRun: Boolean(selection.parseRunId), run: null, coverage: null,
    anchors: [], issues: [], state: "NOT_PROCESSED",
  };
  if (!document.sha256 || !/^[a-f0-9]{64}$/.test(document.sha256)) {
    result.state = "UNAVAILABLE";
    result.issues.push(issue("SOURCE_UNVERIFIABLE"));
    return result;
  }
  const run = await prisma.documentParseRun.findFirst({
    where: selection.parseRunId ? { id: selection.parseRunId, documentId: document.id }
      : { documentId: document.id, generation: document.parseGeneration },
    select: runSelect,
  });
  if (!run) {
    result.issues.push(issue(selection.parseRunId ? "SOURCE_UNAVAILABLE" : "NOT_PROCESSED"));
    if (selection.parseRunId) result.state = "UNAVAILABLE";
    return result;
  }
  if (run.documentId !== document.id || run.sourceSha256 !== document.sha256 ||
      (selection.parseRunId ? run.id !== selection.parseRunId : run.generation !== document.parseGeneration)) {
    result.state = "UNAVAILABLE";
    result.issues.push(issue("SOURCE_UNAVAILABLE"));
    return result;
  }
  result.run = { id: run.id, generation: run.generation, parserVersion: run.parserVersion, finishedAt: run.finishedAt };
  result.state = run.state;
  const coverage = processingCoverageSchema.safeParse(run.coverage);
  if (coverage.success) result.coverage = coverage.data;
  if (!result.coverage || result.coverage.totalUnits === null) addIssue(result.issues, "UNKNOWN_TOTAL");
  const stateIssue = stateIssues[run.state];
  if (stateIssue && !(run.state === "PENDING" && run.finishedAt)) addIssue(result.issues, stateIssue);
  const unitIssues = { PENDING: "PARSE_PENDING", FAILED: "PARSE_FAILED", UNSUPPORTED: "PARSE_UNSUPPORTED", TRUNCATED: "PARSE_TRUNCATED" } as const;
  for (const unit of result.coverage?.units ?? []) if (unit.status !== "READY") addIssue(result.issues, unitIssues[unit.status]);
  if (["READY", "PARTIAL"].includes(run.state)) {
    const snapshot = publishedMaterialSnapshot(run, document);
    if (!snapshot) {
      result.state = "UNAVAILABLE";
      addIssue(result.issues, "INVALID_SNAPSHOT");
    } else result.anchors = measureAnchors(snapshot.anchors);
  }
  return result;
}

function coverageView(coverage: ProcessingCoverage, remainingDetails: number): InputProcessingCoverage {
  const counts: InputProcessingCoverage["counts"] = { ready: 0, pending: 0, failed: 0, unsupported: 0, truncated: 0 };
  const statusKey = { READY: "ready", PENDING: "pending", FAILED: "failed", UNSUPPORTED: "unsupported", TRUNCATED: "truncated" } as const;
  for (const unit of coverage.units) counts[statusKey[unit.status]]++;
  // Missing/failed units are useful first; omission affects display only, not totals.
  const units = [...coverage.units].sort((a, b) => Number(a.status === "READY") - Number(b.status === "READY") || a.unit - b.unit).slice(0, remainingDetails);
  return { unitKind: coverage.unitKind, totalUnits: coverage.totalUnits, counts, units, omittedUnitCount: coverage.units.length - units.length };
}

function project(input: MatterInputCoverageInput, candidates: Map<string, AuthorizedCandidate>): MatterInputCoverageView {
  let remainingChars = INPUT_COVERAGE_MAX_CHARS;
  let remainingRanges = INPUT_COVERAGE_MAX_RANGES;
  let remainingUnits = INPUT_COVERAGE_MAX_UNIT_DETAILS;
  const items = input.documents.map((selection): MatterInputCoverageItem => {
    const candidate = candidates.get(selection.documentId);
    if (!candidate) return unavailable(selection.documentId);
    const { document, run, canPrepare } = candidate;
    const issues = [...candidate.issues];
    if (!canPrepare) addIssue(issues, "REVIEW_NOT_AUTHORIZED");
    if (run && run.generation !== document.parseGeneration) addIssue(issues, "HISTORICAL_PARSE");
    const coverage = candidate.coverage ? coverageView(candidate.coverage, remainingUnits) : null;
    remainingUnits -= coverage?.units.length ?? 0;
    const preparation: AvailableInputCoverageItem["preparation"] = {
      canPrepare, availableChars: candidate.anchors.reduce((sum, anchor) => sum + anchor.chars, 0),
      preparedChars: 0, unpreparedChars: 0, rangeCount: 0, ranges: [], omittedRangeCount: 0,
    };
    if (canPrepare) for (const anchor of candidate.anchors) {
      let end = Math.min(anchor.chars, remainingChars);
      if (end > 0 && end < anchor.chars && /[\uD800-\uDBFF]/.test(anchor.prefix[end - 1] ?? "") && /[\uDC00-\uDFFF]/.test(anchor.prefix[end] ?? "")) end--;
      if (end > 0) {
        preparation.preparedChars += end;
        preparation.rangeCount++;
        remainingChars -= end;
        if (remainingRanges > 0) {
          preparation.ranges.push({ anchorId: anchor.anchorId, unit: anchor.unit, location: anchor.location,
            locationLabel: materialLocationLabel(anchor.location), start: 0, end, totalChars: anchor.chars });
          remainingRanges--;
        }
      }
      // A partial anchor ends the ordered prefix, including a one-code-unit safety gap.
      if (end < anchor.chars) remainingChars = 0;
    }
    preparation.unpreparedChars = preparation.availableChars - preparation.preparedChars;
    preparation.omittedRangeCount = preparation.rangeCount - preparation.ranges.length;
    if (canPrepare && preparation.unpreparedChars > 0) addIssue(issues, "PREPARATION_BUDGET");
    return {
      status: "AVAILABLE", documentId: document.id, documentName: document.name, documentVersion: document.version,
      documentSha256: document.sha256, run: run ? { id: run.id, generation: run.generation, parserVersion: run.parserVersion, isCurrent: run.generation === document.parseGeneration } : null,
      processing: { state: candidate.state, label: candidate.state === "PENDING" && run?.finishedAt ? "尚有未识别内容" : processingLabels[candidate.state] },
      coverage, preparation, issues,
    };
  });
  const available = items.filter((item): item is AvailableInputCoverageItem => item.status === "AVAILABLE");
  return {
    mode: "PREVIEW", matterId: input.matterId, checkedAt: new Date().toISOString(),
    budget: { maxChars: INPUT_COVERAGE_MAX_CHARS, maxDocuments: INPUT_COVERAGE_MAX_DOCUMENTS,
      maxRangeDetails: INPUT_COVERAGE_MAX_RANGES, maxUnitDetails: INPUT_COVERAGE_MAX_UNIT_DETAILS, order: "REQUEST_ORDER" },
    modelSupply: { status: "NOT_SENT", sentChars: 0 },
    summary: {
      selectedDocuments: items.length, availableDocuments: available.length, unavailableDocuments: items.length - available.length,
      availableChars: available.reduce((sum, item) => sum + item.preparation.availableChars, 0),
      preparedChars: available.reduce((sum, item) => sum + item.preparation.preparedChars, 0),
      rangeCount: available.reduce((sum, item) => sum + item.preparation.rangeCount, 0),
      omittedRangeCount: available.reduce((sum, item) => sum + item.preparation.omittedRangeCount, 0),
      omittedUnitCount: available.reduce((sum, item) => sum + (item.coverage?.omittedUnitCount ?? 0), 0),
    },
    items,
  };
}

/** Offline preview only: no provider, retrieval expansion, original-file read or persistent AiRun. */
export async function readMatterInputCoverage(userId: string, untrustedInput: MatterInputCoverageInput): Promise<MatterInputCoverageView> {
  const input = matterInputCoverageSchema.parse(untrustedInput);
  if (!input.documents.length || !await currentActor(userId)) return project(input, new Map());
  const ids = input.documents.map(item => item.documentId);
  const docs = await prisma.document.findMany({ where: documentWhere(input.matterId, ids), select: documentSelect });
  const documentMap = new Map(docs.map(document => [document.id, document]));
  const candidates = new Map<string, Candidate>();
  for (const selection of input.documents) {
    const document = documentMap.get(selection.documentId);
    if (document && await canReadDocument(userId, document)) candidates.set(document.id, await readCandidate(document, selection));
  }
  if (!candidates.size) return project(input, new Map());

  // Re-read selected concrete versions and source permissions before publishing any diagnostics.
  const current = await prisma.document.findMany({
    where: documentWhere(input.matterId, [...candidates.keys()]), select: documentSelect,
  });
  const currentMap = new Map(current.map(document => [document.id, document]));
  const authorized = new Map<string, AuthorizedCandidate>();
  for (const [id, candidate] of candidates) {
    const document = currentMap.get(id);
    if (!document || document.sha256 !== candidate.document.sha256 || document.version !== candidate.document.version ||
        (!candidate.explicitRun && document.parseGeneration !== candidate.document.parseGeneration) ||
        !await canReadDocument(userId, document)) continue;
    authorized.set(id, { ...candidate, document, canPrepare: await canReviewDocument(userId, document) });
  }
  const actor = await currentActor(userId);
  if (!actor) return project(input, new Map());
  if (!hasCustomPermission(actor, "documents.write")) for (const candidate of authorized.values()) candidate.canPrepare = false;
  // Allocate after revocation filtering: hidden versions cannot consume visible input budget.
  return project(input, authorized);
}
