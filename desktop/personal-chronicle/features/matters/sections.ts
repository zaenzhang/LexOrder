export const matterSections = [
  ["overview", "案件概览"], ["tasks", "程序与任务"],
  ["materials", "案卷材料"], ["court", "法院来件"],
  ["evidence", "事实与争点"], ["research", "研究修订"],
  ["delivery", "文书与交付"], ["seal", "用印记录"],
  ["records", "办理记录"], ["finance", "案件收费"], ["archive", "归档检查"],
] as const

export const evidenceViews = [
  ["claims", "诉请与依据"], ["arguments", "争点攻防"], ["hearing", "庭审对抗图"],
  ["analysis", "分析母表"], ["graph", "案情图谱"],
] as const
export type EvidenceView = typeof evidenceViews[number][0]

export type MatterSection = typeof matterSections[number][0]
