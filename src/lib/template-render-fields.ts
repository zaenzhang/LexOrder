/** Exact subjects used for one template render; null is an explicit unselected target. */
export type TemplateSelection = {
  clientId: string | null;
  opposingPartyId: string | null;
  thirdPartyId: string | null;
  procedureId: string | null;
};

export const EMPTY_TEMPLATE_SELECTION: TemplateSelection = {
  clientId: null, opposingPartyId: null, thirdPartyId: null, procedureId: null,
};

export type TemplateSubjectKey = "client" | "opposing" | "third" | "proceeding" | "plaintiffs" | "defendants" | "thirds";
export type TemplateSubjects = Partial<Record<TemplateSubjectKey, string[]>>;
export type TemplateField = {
  path: string;
  value: string;
  editable: boolean;
  required: boolean;
  missing: boolean;
  controlsScope: boolean;
  subjectLabel?: string;
};

export type TemplatePreparation = {
  templateId: string;
  templateUpdatedAt: string;
  templateSourceDocumentId: string;
  selection: TemplateSelection;
  choices: Record<"clients" | "opposing" | "thirds" | "procedures", { id: string; label: string }[]>;
  /** Original values and identities, never the user's effective draft text. */
  expectedValues: Record<string, string>;
  expectedSubjects: TemplateSubjects;
  fields: TemplateField[];
};

/** A value for an existing subject must be tied to that subject before rendering. */
export function missingTemplateTargets(variables: string[], selection: TemplateSelection, choices: TemplatePreparation["choices"]): string[] {
  const targets = [
    { key: "clientId", list: "clients", prefix: "client", label: "委托人" },
    { key: "opposingPartyId", list: "opposing", prefix: "opposing", label: "对方当事人" },
    { key: "thirdPartyId", list: "thirds", prefix: "third", label: "第三人" },
    { key: "procedureId", list: "procedures", prefix: "proceeding", label: "程序" },
  ] as const;
  return targets.filter(target => !selection[target.key] && choices[target.list].length > 0
    && variables.some(path => path === target.prefix || path.startsWith(`${target.prefix}.`))).map(target => target.label);
}
