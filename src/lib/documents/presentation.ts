import { isInlinePreviewable, officePreviewKind } from "@/lib/storage/mime-ext";
import type { SourceAnchor } from "@/lib/workbench/contracts";

export interface MaterialPresentation {
  previewKind: "NATIVE" | "CONVERTED" | "NONE";
  previewUrl: string | null;
  downloadUrl: string;
}

/** Links describe the already authorized version, not its permissions or conversion outcome. */
export function materialPresentation(document: { id: string; mimeType: string | null; name: string },
  location?: SourceAnchor["location"]): MaterialPresentation {
  const base = `/api/documents/${encodeURIComponent(document.id)}`;
  const downloadUrl = `${base}/download`;
  if (officePreviewKind(document.mimeType, document.name)) {
    return { previewKind: "CONVERTED", previewUrl: `${base}/preview`, downloadUrl };
  }
  if (isInlinePreviewable(document.mimeType)) {
    const page = document.mimeType?.toLowerCase() === "application/pdf" && location?.kind === "PAGE" ? `#page=${location.page}` : "";
    return { previewKind: "NATIVE", previewUrl: `${downloadUrl}?inline=1${page}`, downloadUrl };
  }
  return { previewKind: "NONE", previewUrl: null, downloadUrl };
}
