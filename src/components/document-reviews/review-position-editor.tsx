"use client";

import { useCallback } from "react";
import { MaterialSourceLocationPicker, type MaterialSourceLocation, type MaterialSourceLocationLoader } from "@/components/documents/material-source-location-picker";
import { getDocumentReviewPositionOptions } from "@/server/document-reviews/actions";
import { reviewPositionInputSchema, type ReviewDocumentOption, type ReviewPositionInput } from "@/server/document-reviews/contracts";
import { ReviewPositionSourceButton } from "./review-position-source";

export function reviewPositionInput(value: MaterialSourceLocation): ReviewPositionInput | null {
  if (value.position) return { parseRunId: value.position.runId, anchorId: value.position.anchorId };
  return value.page ? { page: Number(value.page) } : null;
}
export function hasReviewPosition(value: MaterialSourceLocation) { return Boolean(value.page || value.position); }

export function ReviewPositionEditor({ documentId, matterId, slot, document, value, onChange, disabled }: {
  documentId: string; matterId: string | null; slot: "SUBJECT" | "BASIS" | "REVISION";
  document: ReviewDocumentOption; value: MaterialSourceLocation; onChange(value: MaterialSourceLocation): void; disabled: boolean;
}) {
  const sourceDocumentId = slot === "SUBJECT" ? undefined : document.id;
  const loadSources: MaterialSourceLocationLoader = useCallback(input => getDocumentReviewPositionOptions({
    documentId, slot, ...(sourceDocumentId ? { sourceDocumentId } : {}), ...(input.offset !== undefined ? { offset: input.offset } : {}),
  }), [documentId, slot, sourceDocumentId]);
  if (!matterId || !document.hasIdentity) return <p className="text-xs text-muted-foreground">此版本暂不能固定原文位置，可保留文字说明并核对原件。</p>;
  const input = reviewPositionInput(value);
  return <div className="space-y-2">
    <MaterialSourceLocationPicker key={`${documentId}:${slot}:${document.id}`} matterId={matterId} document={document}
      value={value} onChange={onChange} disabled={disabled} loadSources={loadSources} />
    {input && <ReviewPositionSourceButton disabled={disabled || !reviewPositionInputSchema.safeParse(input).success}
      target={{ kind: "DRAFT", input: { documentId, slot, ...(sourceDocumentId ? { sourceDocumentId } : {}), position: input } }}>查看所选位置</ReviewPositionSourceButton>}
  </div>;
}
