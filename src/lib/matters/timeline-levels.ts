export const timelineLevels = ["NORMAL", "IMPORTANT", "KEY"] as const
export type TimelineLevel = (typeof timelineLevels)[number]

export type TimelineEventKind = "fact" | "hearing" | "deadline" | "accepted" | "concluded"
export type TimelineEventReference = { kind: TimelineEventKind; id: string }

export function timelineEventKey(kind: TimelineEventKind, id: string) {
  return kind + ":" + id
}
