export type DossierView = "archive" | "work" | "money" | "seal";
export type WorkPane = "materials" | "facts" | "tasks" | "records";

type DossierUpdate = Partial<{
  view: DossierView;
  workPane: WorkPane;
  procedure: string | null;
  stage: string | null;
  task: string | null;
  recordsExpanded: string | null;
  factsView: "facts" | "research";
  recordsView: "activity" | "delivery";
  research: string | null;
  issue: string | null;
  document: string | null;
  reviewIssue: string | null;
  delivery: string | null;
  deliveryEvent: string | null;
  deliveryDocument: string | null;
  contextRecord: string | null;
  contextReturnTo: string | null;
}>;

/** Native history is integrated with Next useSearchParams. */
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
