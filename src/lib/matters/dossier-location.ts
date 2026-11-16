export type DossierView = "archive" | "work" | "money" | "seal";
export type WorkPane = "materials" | "facts" | "tasks" | "records";
export type CaseMaterialEntry =
  | { kind: "material"; documentId: string }
  | { kind: "evidence"; evidenceItemId: string }
  | { kind: "create"; documentId: string | null }
  | { kind: "source"; evidenceItemId: string; sourceId: string; revision?: number };

type DossierUpdate = Partial<{
  view: DossierView;
  workPane: WorkPane;
  materialOrigin: string | null;
  materialWritten: string | null;
  materialEvidence: string | null;
  recordKind: string | null;
  recordsExpanded: string | null;
  procedure: string | null;
  stage: string | null;
  detail: CaseMaterialEntry["kind"] | null;
  document: string | null;
  evidence: string | null;
  source: string | null;
  revision: string | null;
}>;

/** User navigation adds a history entry; cancelling a navigation replaces it. */
export function updateDossierLocation(update: DossierUpdate, mode: "push" | "replace" = "push") {
  const url = new URL(window.location.href);
  url.searchParams.delete("work");
  url.searchParams.delete("scope");
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", next);
  }
}

export function dossierEntryParams(entry: CaseMaterialEntry | null): DossierUpdate {
  const clear = { detail: null, document: null, evidence: null, source: null, revision: null };
  if (!entry) return clear;
  if (entry.kind === "material" || entry.kind === "create") {
    return { ...clear, detail: entry.kind, document: entry.documentId };
  }
  if (entry.kind === "evidence") return { ...clear, detail: "evidence", evidence: entry.evidenceItemId };
  return { ...clear, detail: "source", evidence: entry.evidenceItemId, source: entry.sourceId,
    revision: entry.revision === undefined ? null : String(entry.revision) };
}

export function readDossierEntry(params: Pick<URLSearchParams, "get" | "has">): { entry: CaseMaterialEntry | null; invalid: boolean } {
  const kind = params.get("detail");
  const documentId = params.get("document");
  const evidenceItemId = params.get("evidence");
  const sourceId = params.get("source");
  const revisionValue = params.get("revision");
  if (!kind) return { entry: null, invalid: ["document", "evidence", "source", "revision"].some(key => params.has(key)) };
  if (kind === "material" && documentId) return { entry: { kind, documentId }, invalid: false };
  if (kind === "create" && (documentId || !params.has("document"))) return { entry: { kind, documentId }, invalid: false };
  if (kind === "evidence" && evidenceItemId) return { entry: { kind, evidenceItemId }, invalid: false };
  if (kind === "source" && evidenceItemId && sourceId) {
    const revision = revisionValue === null ? undefined : Number(revisionValue);
    if (revision === undefined || (Number.isSafeInteger(revision) && revision > 0)) {
      return { entry: { kind, evidenceItemId, sourceId, ...(revision === undefined ? {} : { revision }) }, invalid: false };
    }
  }
  return { entry: null, invalid: true };
}
