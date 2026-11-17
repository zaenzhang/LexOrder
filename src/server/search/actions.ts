"use server";
import type { DeadlineDuePrecision } from "@/lib/deadline-due";

import { hasCustomPermission } from "@/lib/roles/catalog";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import {
  matterReadVisibilityFilter,
  intakeReadVisibilityFilter,
  clientVisibilityFilter,
} from "@/lib/permissions";
import { canReadDocument } from "@/lib/approvals/documents";
import { blindIdNumber } from "@/lib/clients/id-number-crypto";
import { normalizeIdNumber } from "@/lib/clients/identity";
import { matterHref } from "@/lib/matters/route";
import { customMatterFilter } from "@/lib/permissions";
import { clientTypeLabel, deadlineCategoryLabel, intakeStatusLabel, matterStatusLabel } from "@/lib/enums";
import type { DocumentSourceOrigin, Prisma } from "@prisma/client";
import { materialTextProjection, publishedMaterialSnapshot } from "@/server/documents/material-processing";
import { materialPresentation } from "@/lib/documents/presentation";
import type { SourceAnchor } from "@/lib/workbench/contracts";
import { ActionError } from "@/lib/action-error";
import { decodeSearchCursor, encodeSearchCursor, searchBoundary, searchGroups, searchPageSchema, searchQuerySchema, type SearchGroup, type SearchPosition } from "./cursor";
import type { z } from "zod";

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  type: "matter" | "client" | "intake" | "document" | "deadline";
  /** 墨案 11 页展示字段（仅授权后返回） */
  snippet?: string;
  pageNo?: number | null;
  sourceOrigin?: DocumentSourceOrigin | null;
  ocr?: boolean;
  /** 归属说明（如「属于 XX · LL-2026-…」） */
  context?: string;
  code?: string;
  /** 命中字段说明（名称命中 / 案号命中 / 委托方命中 / 备注命中 …） */
  matchedBy?: string;
  meta?: string;
  dueAt?: string;
  duePrecision?: DeadlineDuePrecision | null;
  /** 材料/期限所属案件链接（「跳转案件」） */
  matterLink?: string;
  documentVersion?: number;
  parseRunId?: string;
  anchorId?: string;
  sourceLocation?: SourceAnchor["location"];
}

export interface GlobalSearchResult {
  matters: SearchResultItem[];
  clients: SearchResultItem[];
  intakes: SearchResultItem[];
  documents: SearchResultItem[];
  deadlines: SearchResultItem[];
  /** v1.x 批次⑤（11 页注脚）：识别失败未纳入全文的材料数（失败状态可见） */
  documentsFailedCount: number;
  nextCursorByGroup: Record<SearchGroup, string | null>;
}
export type SearchResultPage = { items: SearchResultItem[]; nextCursor: string | null };

/** 文档检索候选窗口：粗过滤后仍大于展示上限，留出逐条精校被拒的余量 */
const DOCUMENT_CANDIDATE_LIMIT = 200;

function documentVisibilityScope(userId: string, role: string, rolePermissions: unknown): Prisma.DocumentWhereInput {
  const grants = rolePermissions as Parameters<typeof matterReadVisibilityFilter>[2];
  return { OR: [
    { matter: { is: matterReadVisibilityFilter(userId, role, grants) } },
    { intake: { is: intakeReadVisibilityFilter(userId, role, grants) } },
    { uploadedById: userId },
  ] };
}

/** Count only readable failures. No unscoped aggregate may reveal other matters. */
async function countDocumentFailuresAuthorized(userId: string, role: string, rolePermissions: unknown): Promise<number> {
  if (!hasCustomPermission({ role, rolePermissions } as Parameters<typeof hasCustomPermission>[0], "documents.read")) return 0;
  let cursor: string | undefined;
  let count = 0;
  for (;;) {
    const batch = await prisma.document.findMany({
      where: { deletedAt: null, ocrStatus: "FAILED", AND: [documentVisibilityScope(userId, role, rolePermissions)] },
      select: { id: true, uploadedById: true, matterId: true, intakeId: true, deletedAt: true },
      orderBy: { id: "asc" }, take: DOCUMENT_CANDIDATE_LIMIT,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const doc of batch) if (await canReadDocument(userId, doc)) count++;
    if (batch.length < DOCUMENT_CANDIDATE_LIMIT) return count;
    cursor = batch[batch.length - 1].id;
  }
}

/**
 * v1.x P0-2: 文档候选池检索——名称/标签命中，或抽取文本层命中（全文检索）。
 * 命中正文不等于可读正文：候选逐条经 canReadDocument（与下载同口径，
 * 含收案材料、申请附件等场景）后过滤；条目数与片段只对有权文档返回。
 */
async function searchDocumentsAuthorized(
  q: string,
  userId: string,
  role: string,
  rolePermissions: unknown,
  limit: number,
  point: SearchPosition | null
): Promise<SearchResultPage> {
  if (!hasCustomPermission(
    { role, rolePermissions } as Parameters<typeof hasCustomPermission>[0],
    "documents.read"
  )) {
    return { items: [], nextCursor: null };
  }

  // 第八轮体检：取数窗口必须收窄到「可能可见」的集合。此前 take 在 canReadDocument
  // 逐条过滤之前，全所最近 N 份文档若都不属于本人，本人自己案件里的材料会搜不到
  // ——表现为「系统说没有」，比报错更难察觉，且律所越大漏得越狠。
  //
  // canReadDocument 含用印审批、审批历史等需额外查询的分支，无法完整下推为 where；
  // 这里只下推可表达的归属条件作为**超集粗过滤**，精确判定仍由逐条 canReadDocument 负责。
  // 复用 matterReadVisibilityFilter / intakeReadVisibilityFilter（已覆盖 CUSTOM 角色
  // 与团队范围），合伙人/ALL 范围下两者返回 {}，等价于不收窄。
  //
  // 已知取舍：仅凭用印/审批通道可读、且既不挂案件也不挂收案、又非本人上传的孤立
  // 文档，不进入候选池。这类文档通常仍挂在某案件下，实际影响有限；彻底解法需把
  // 审批通道物化为可查询关联，另行排期。
  const visibilityScope = documentVisibilityScope(userId, role, rolePermissions);

  const candidates = await prisma.document.findMany({
    where: {
      deletedAt: null,
      // 必须用 AND 包裹：可见性与关键词都是 OR 组，平铺会让后写的 OR 覆盖前一个
      AND: [
        visibilityScope,
        searchBoundary("createdAt", point),
        {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { tags: { has: q } },
            { textContent: { contains: q, mode: "insensitive" } },
          ],
        },
      ],
    },
    take: DOCUMENT_CANDIDATE_LIMIT + 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true, createdAt: true, name: true, mimeType: true, category: true, textContent: true, tags: true,
      uploadedById: true, matterId: true, intakeId: true,
      sourceOrigin: true, textSource: true, deletedAt: true,
      sha256: true, version: true, parseGeneration: true,
      parseRuns: { where: { finishedAt: { not: null }, state: { in: ["READY", "PARTIAL"] } }, orderBy: { generation: "desc" }, take: 1 },
      matter: { select: { id: true, internalCode: true, title: true } },
      stage: { select: { name: true } },
      intake: { select: { id: true, title: true } },
    },
  });

  const results: SearchResultItem[] = [];
  let scanned = 0;
  for (const doc of candidates.slice(0, DOCUMENT_CANDIDATE_LIMIT)) {
    if (results.length >= limit) break;
    scanned++;
    if (!(await canReadDocument(userId, doc))) continue;

    // New parses use only their current immutable representation. Legacy text remains searchable,
    // but DOCX/TXT offsets never become invented physical page numbers.
    let snippet = "";
    let pageNo: number | null = null;
    const run = doc.parseRuns[0];
    const snapshot = run && run.generation === doc.parseGeneration ? publishedMaterialSnapshot(run, doc) : null;
    const text = doc.parseGeneration > 0 ? snapshot ? materialTextProjection(snapshot) : null : doc.textContent;
    let anchor: SourceAnchor | undefined;
    if (text) {
      const idx = text.toLowerCase().indexOf(q.toLowerCase());
      if (idx >= 0) {
        snippet = text.slice(Math.max(0, idx - 20), idx + q.length + 40).replace(/\s+/g, " ");
        anchor = snapshot?.anchors.find(item => item.text.toLowerCase().includes(q.toLowerCase()));
        if (anchor?.location.kind === "PAGE") pageNo = anchor.location.page;
        else if (!doc.parseGeneration && doc.textSource === "PDF_TEXT") {
          const { pageOfOffset } = await import("@/lib/documents/text-extraction");
          pageNo = pageOfOffset(text, idx);
        }
      }
    }
    if (!snippet && !doc.name.toLowerCase().includes(q.toLowerCase()) && !doc.tags.includes(q)) continue;
    const contextLabel =
      doc.matter?.internalCode
      ?? (doc.intake ? `收案 · ${doc.intake.title}` : "");
    const matterLink = doc.matter ? matterHref(doc.matter) : doc.intake ? `/intakes/${doc.intake.id}` : undefined;
    const presentation = materialPresentation(doc, anchor?.location ?? (pageNo ? { kind: "PAGE", page: pageNo } : undefined));
    results.push({
      id: doc.id,
      title: doc.name,
      subtitle: snippet ? `${contextLabel}${pageNo ? ` · 第 ${pageNo} 页` : ""} · 命中正文：…${snippet}…` : contextLabel,
      href: presentation.previewUrl ?? presentation.downloadUrl,
      type: "document" as const,
      snippet: snippet || undefined,
      pageNo,
      sourceOrigin: doc.sourceOrigin ?? null,
      ocr: doc.textSource === "OCR",
      matchedBy: snippet ? "正文命中" : "名称命中",
      context: doc.matter
        ? `属于 ${doc.matter.title ?? ""}${doc.stage?.name ? ` · ${doc.stage.name}` : ""}`
        : doc.intake ? `属于 收案 · ${doc.intake.title}` : "",
      code: doc.matter?.internalCode,
      matterLink,
      documentVersion: doc.version,
      parseRunId: snapshot ? run.id : undefined,
      anchorId: anchor?.anchorId,
      sourceLocation: anchor?.location,
      meta: [doc.version > 1 ? `版本 ${doc.version}` : "", snapshot && run.state === "PARTIAL" ? "仅部分内容已处理" : ""].filter(Boolean).join(" · ") || undefined,
    });
  }
  const last = candidates[scanned - 1];
  return { items: results, nextCursor: last && scanned < candidates.length
    ? encodeSearchCursor(userId, q, "documents", { at: last.createdAt.toISOString(), id: last.id }) : null };
}

type SearchActor = Awaited<ReturnType<typeof requireSession>>["user"];
const PAGE_SIZE = 20;

function groupAvailable(actor: SearchActor, group: SearchGroup) {
  const permission = group === "documents" ? "documents.read" : group === "deadlines" ? "schedule.read"
    : group === "clients" ? "clients.read" : "matters.read";
  return hasCustomPermission(actor, permission);
}

async function readSearchGroup(actor: SearchActor, q: string, group: SearchGroup, point: SearchPosition | null): Promise<SearchResultPage> {
  if (!groupAvailable(actor, group)) return { items: [], nextCursor: null };
  const userId = actor.id, role = actor.role, lower = q.toLowerCase();
  const mVis = matterReadVisibilityFilter(userId, role, actor.rolePermissions);
  const finish = <T extends { id: string }>(rows: T[], date: (row: T) => Date, project: (row: T) => SearchResultItem): SearchResultPage => {
    const displayed = rows.slice(0, PAGE_SIZE), last = displayed.at(-1);
    return { items: displayed.map(project), nextCursor: rows.length > PAGE_SIZE && last
      ? encodeSearchCursor(userId, q, group, { at: date(last).toISOString(), id: last.id }) : null };
  };
  if (group === "documents") return searchDocumentsAuthorized(q, userId, role, actor.rolePermissions, PAGE_SIZE, point);
  if (group === "matters") {
    const rows = await prisma.matter.findMany({
      where: { deletedAt: null, AND: [mVis, searchBoundary("updatedAt", point), { OR: [
        { title: { contains: q, mode: "insensitive" } }, { internalCode: { contains: q, mode: "insensitive" } },
        { primaryClient: { name: { contains: q, mode: "insensitive" } } },
      ] }] }, take: PAGE_SIZE + 1, orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, updatedAt: true, title: true, internalCode: true, status: true, owner: { select: { name: true } }, primaryClient: { select: { name: true } } },
    });
    return finish(rows, row => row.updatedAt, m => {
      const matchedBy = m.title.toLowerCase().includes(lower) ? "名称命中" : m.internalCode.toLowerCase().includes(lower) ? "编号命中" : "委托方命中";
      return { id: m.id, title: m.title, subtitle: `${m.internalCode} · ${matterStatusLabel[m.status]}`, href: matterHref(m), type: "matter", code: m.internalCode,
        matchedBy: matchedBy === "委托方命中" && m.primaryClient?.name ? `委托方「${m.primaryClient.name}」命中` : matchedBy,
        meta: [m.owner?.name ? `主办 ${m.owner.name}` : null, matterStatusLabel[m.status]].filter(Boolean).join(" · ") };
    });
  }
  if (group === "clients") {
    const rows = await prisma.client.findMany({
      where: { deletedAt: null, AND: [clientVisibilityFilter(userId, role, actor.rolePermissions), searchBoundary("updatedAt", point), { OR: [
        { name: { contains: q, mode: "insensitive" } }, { idNumberBlind: blindIdNumber(normalizeIdNumber(q) ?? "") },
        { phone: { contains: q } }, { notes: { contains: q, mode: "insensitive" } },
      ] }] }, take: PAGE_SIZE + 1, orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, updatedAt: true, name: true, type: true, notes: true, _count: { select: { matters: true } } },
    });
    return finish(rows, row => row.updatedAt, c => {
      const byNotes = !c.name.toLowerCase().includes(lower) && c.notes?.toLowerCase().includes(lower);
      const text = c.notes ?? "", idx = text.toLowerCase().indexOf(lower);
      const around = idx < 0 ? text.slice(0, 40) : `${idx > 12 ? "…" : ""}${text.slice(Math.max(0, idx - 12), idx + q.length + 24)}${idx + q.length + 24 < text.length ? "…" : ""}`;
      return { id: c.id, title: c.name, subtitle: clientTypeLabel[c.type], href: `/clients/${c.id}`, type: "client",
        matchedBy: byNotes ? `备注：「${around}」` : c.name.toLowerCase().includes(lower) ? "名称命中" : "证件/电话命中",
        meta: `${clientTypeLabel[c.type]} · 累计案件 ${c._count.matters}` };
    });
  }
  if (group === "intakes") {
    const rows = await prisma.intake.findMany({
      where: { status: { not: "CONVERTED" }, AND: [intakeReadVisibilityFilter(userId, role, actor.rolePermissions), searchBoundary("receivedAt", point), { OR: [
        { title: { contains: q, mode: "insensitive" } }, { client: { name: { contains: q, mode: "insensitive" } } },
      ] }] }, take: PAGE_SIZE + 1, orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      select: { id: true, title: true, status: true, receivedAt: true, client: { select: { name: true } } },
    });
    return finish(rows, row => row.receivedAt, i => ({ id: i.id, title: i.title, subtitle: intakeStatusLabel[i.status], href: `/intakes/${i.id}`, type: "intake",
      meta: [i.client?.name ? `委托方 ${i.client.name}` : null, intakeStatusLabel[i.status]].filter(Boolean).join(" · "), dueAt: i.receivedAt.toISOString() }));
  }
  const deadlineMatterFilter = role === "CUSTOM"
    ? { AND: [customMatterFilter(userId, actor.rolePermissions, "schedule.read", true), mVis] } : mVis;
  const rows = await prisma.deadline.findMany({
    where: { completed: false, title: { contains: q, mode: "insensitive" },
      procedure: { engagement: "ENGAGED", matter: { deletedAt: null, ...deadlineMatterFilter } }, AND: [searchBoundary("dueAt", point, true)] },
    take: PAGE_SIZE + 1, orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, category: true, dueAt: true, duePrecision: true,
      procedure: { select: { matter: { select: { id: true, internalCode: true, title: true } } } } },
  });
  return finish(rows, row => row.dueAt, d => {
    const matter = d.procedure.matter;
    return { id: d.id, title: d.title, subtitle: `${matter.internalCode} · ${deadlineCategoryLabel[d.category]}`, href: matterHref(matter), type: "deadline",
      code: matter.internalCode, context: matter.title, meta: deadlineCategoryLabel[d.category], dueAt: d.dueAt.toISOString(), duePrecision: d.duePrecision, matterLink: matterHref(matter) };
  });
}

export async function globalSearch(query: string): Promise<GlobalSearchResult> {
  const session = await requireSession("personal"), q = searchQuerySchema.parse(query);
  const [pages, documentsFailedCount] = await Promise.all([
    Promise.all(searchGroups.map(async group => [group, q ? await readSearchGroup(session.user, q, group, null) : { items: [], nextCursor: null }] as const)),
    q ? countDocumentFailuresAuthorized(session.user.id, session.user.role, session.user.rolePermissions) : Promise.resolve(0),
  ]);
  const byGroup = Object.fromEntries(pages) as Record<SearchGroup, SearchResultPage>;
  return { matters: byGroup.matters.items, clients: byGroup.clients.items, intakes: byGroup.intakes.items,
    documents: byGroup.documents.items, deadlines: byGroup.deadlines.items, documentsFailedCount,
    nextCursorByGroup: Object.fromEntries(pages.map(([group, page]) => [group, page.nextCursor])) as Record<SearchGroup, string | null> };
}

/** A continuation is a current authorized read, never an authority granted by an old cursor. */
export async function continueGlobalSearch(input: z.input<typeof searchPageSchema>): Promise<SearchResultPage> {
  const data = searchPageSchema.parse(input), session = await requireSession("personal");
  if (!groupAvailable(session.user, data.group)) throw new ActionError("当前资格不能读取此检索范围");
  const point = decodeSearchCursor(data.cursor, session.user.id, data.query, data.group);
  return readSearchGroup(session.user, data.query, data.group, point);
}
