import { ensureExt } from "@/lib/storage/mime-ext";

const officeDraft = /^\.(?:docx?|xlsx?|pptx?|txt)$/;

/** Received originals, submitted drafts and fixed versions stay in the reader. */
export function draftExtension(doc: { status: string; sourceOrigin: string | null; mimeType: string | null }) {
  const ext = ensureExt("", doc.mimeType);
  return doc.status === "DRAFT" && doc.sourceOrigin === "TEAM_PRODUCED" && officeDraft.test(ext) ? ext : null;
}
