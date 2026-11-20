import type { DocumentCategory, Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { canReadDocument } from "@/lib/approvals/documents";
import type { z } from "zod";
import type { sourceLocationSchema } from "@/lib/workbench/contracts";
import type { FragmentSelection } from "@/lib/workbench/fixed-fragments";
import { exactTextRange } from "@/lib/workbench/fixed-text-range";
import { materialLocationLabel, publishedMaterialSnapshot } from "@/server/documents/material-processing";
import { canReviewDocument } from "./document-access";

export type FixedFragment = FragmentSelection & {
  index: number; text: string; name: string; category: DocumentCategory; version: number; location: string;
  documentSha256: string; sourceLocation: z.infer<typeof sourceLocationSchema>;
};

export async function loadFixedFragments(tx: Prisma.TransactionClient, access: { user: { id: string }; matter: { id: string } }, ranges: FragmentSelection[], exportable = false, onlyIndex?: number): Promise<FixedFragment[]> {
  const documentIds = [...new Set(ranges.map(range => range.documentId))];
  if (onlyIndex !== undefined && !ranges[onlyIndex - 1]) throw new ActionError("片段不属于本次委托");
  const selected = onlyIndex === undefined ? ranges : [ranges[onlyIndex - 1]];
  const runIds = [...new Set(selected.map(range => range.parseRunId))];
  const documents = await tx.document.findMany({
    where: { id: { in: documentIds }, matterId: access.matter.id, deletedAt: null },
    select: { id: true, matterId: true, intakeId: true, uploadedById: true, sha256: true, name: true, category: true, version: true },
  });
  if (documents.length !== documentIds.length) throw new ActionError("委托材料已撤回或不属于本案");
  for (const document of documents) {
    const allowed = exportable ? await canReviewDocument(access.user.id, document, tx) : await canReadDocument(access.user.id, document, tx);
    if (!allowed) throw new ActionError("委托材料的访问资格已变化");
  }
  const byDocument = new Map(documents.map(document => [document.id, document]));
  const runs = await tx.documentParseRun.findMany({
    where: { id: { in: runIds }, documentId: { in: documentIds } },
    select: { id: true, documentId: true, sourceSha256: true, generation: true, parserVersion: true, state: true, anchors: true, coverage: true, finishedAt: true },
  });
  const anchorsByRun = new Map(runs.map(run => {
    const document = byDocument.get(run.documentId)!;
    const published = publishedMaterialSnapshot(run, document);
    return [run.id, { document, anchors: new Map(published?.anchors.map(anchor => [anchor.anchorId, anchor])) }] as const;
  }));
  return selected.map((range, index) => {
    const parsed = anchorsByRun.get(range.parseRunId);
    const anchor = parsed?.anchors.get(range.anchorId);
    if (!parsed || parsed.document.id !== range.documentId || !anchor) throw new ActionError("固定解析版本或位置已不可用");
    return {
      ...range, index: onlyIndex ?? index + 1, text: exactTextRange(anchor.text, range.start, range.end),
      name: parsed.document.name, category: parsed.document.category, version: parsed.document.version, location: materialLocationLabel(anchor.location),
      documentSha256: parsed.document.sha256!, sourceLocation: anchor.location,
    };
  });
}
