"use client";

export type DossierView = "archive" | "work" | "money" | "seal";
export type WorkPane = "materials" | "facts" | "tasks" | "records";

/** One current URL contract; concrete IDs always keep their original version. */
export function replaceDossierLocation(update: Partial<{
  view: DossierView;
  procedure: string | null;
  stage: string | null;
  workPane: WorkPane;
  scope: "all" | null;
  factsView: "facts" | "research";
  recordsView: "activity" | "delivery";
  research: string | null;
  issue: string | null;
  document: string | null;
  reviewIssue: string | null;
  delivery: string | null;
  deliveryEvent: string | null;
  deliveryDocument: string | null;
  task: string | null;
}>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
