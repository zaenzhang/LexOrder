import { type FragmentSelection } from "@/lib/workbench/fixed-fragments";
import { ActionError } from "@/lib/action-error";
import { signoffItemLabels, type SignoffKind, type SkillDecisions } from "./signoff-contract";

type Decision = SkillDecisions[number];
const dispositionLabels = { ADOPT: "采用", PARTIAL: "部分支持", NEEDS_SOURCE: "待补出处" };
type ResearchText = { conclusion: string; unresolved: string; supportingAnalysis: string };

export function decisionParagraphs(kind: SignoffKind, decision: Decision) {
  const label = signoffItemLabels[kind] + " · " + dispositionLabels[decision.disposition];
  return { field: decision.disposition === "NEEDS_SOURCE" ? "unresolved" as const : "conclusion" as const,
    judgment: label + " · " + decision.value, reason: label + " · " + decision.reason };
}

function removeOwnedParagraph(text: string, paragraph: string) {
  const bounded = "\n\n" + text + "\n\n";
  const target = "\n\n" + paragraph + "\n\n";
  const first = bounded.indexOf(target);
  if (first < 0 || bounded.indexOf(target, first + 1) >= 0) {
    throw new ActionError("该项既有取舍已在研究正文中改写或重复，请先在当前研究中人工核对");
  }
  const kept = bounded.slice(0, first) + "\n\n" + bounded.slice(first + target.length);
  return kept.slice(2, -2);
}

export function removePriorDecision(text: ResearchText, kind: SignoffKind, decision: Decision): ResearchText {
  const paragraphs = decisionParagraphs(kind, decision);
  return { conclusion: text.conclusion, unresolved: text.unresolved, supportingAnalysis: removeOwnedParagraph(text.supportingAnalysis, paragraphs.reason),
    [paragraphs.field]: removeOwnedParagraph(text[paragraphs.field], paragraphs.judgment) };
}

export function countNewFragments(selected: FragmentSelection[], previouslyRead: FragmentSelection[]) {
  return selected.filter(range => !previouslyRead.some(old =>
    old.documentId === range.documentId && old.parseRunId === range.parseRunId && old.anchorId === range.anchorId &&
    old.start <= range.start && old.end >= range.end,
  )).length;
}
