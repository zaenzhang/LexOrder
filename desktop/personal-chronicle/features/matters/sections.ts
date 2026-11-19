export const matterSections = [
  ["overview", "概览"], ["materials", "材料"], ["evidence", "事实与争点"], ["research", "研究"],
  ["tasks", "程序与任务"], ["delivery", "文书与交付"], ["records", "办理记录"], ["finance", "财务"], ["seal", "用印"],
] as const

export type MatterSection = typeof matterSections[number][0]
