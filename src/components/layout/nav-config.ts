import {
  IconActivity, IconArticle, IconBookStroked, IconBox, IconCalendarStroked,
  IconChecklistStroked, IconCreditCardStroked, IconFolderStroked, IconGlobeStroked,
  IconHistogram, IconHomeStroked, IconUserGroup, IconUserStroked,
} from "@douyinfe/semi-icons";
import type { NavCounts } from "@/server/layout/nav-counts";

export type NavItem = {
  label: string;
  href: string;
  icon: typeof IconHomeStroked;
  countKey?: keyof NavCounts;
};

/**
 * 侧栏单列（2026-09-19 用户确认）：条目不多，不再分组，按「工作台 → 案件动线 → 客户与钱」的顺序平铺。
 * 法院短信是有时效的来件队列而非导航分类，入口在顶栏（与通知铃并排）；
 * 工具抽屉「更多应用」固定在底部用户卡上方。
 */
export const primaryNav: NavItem[] = [
  { label: "工作台", href: "/", icon: IconHomeStroked },
  { label: "案件", href: "/matters", icon: IconFolderStroked, countKey: "matters" },
  { label: "审批", href: "/approvals", icon: IconChecklistStroked, countKey: "approvals" },
  { label: "日程", href: "/schedule", icon: IconCalendarStroked },
  { label: "客户", href: "/clients", icon: IconUserGroup, countKey: "clients" },
  { label: "财务", href: "/finance", icon: IconCreditCardStroked },
  { label: "报表", href: "/reports", icon: IconHistogram }
];

// 原顶栏「应用」聚合入口：实务工具=全局弹窗；法律导航=外链；其余为独立页
export const APP_ITEMS: { label: string; icon: typeof IconHomeStroked; kind: "tools" | "link" | "external"; href?: string }[] = [
  { label: "实务工具", icon: IconActivity, kind: "tools" },
  { label: "快递跟踪", href: "/express", icon: IconBox, kind: "link" },
  { label: "律所文书", href: "/firm-resources", icon: IconFolderStroked, kind: "link" },
  { label: "公告指引", href: "/announcements", icon: IconArticle, kind: "link" },
  { label: "制度规范", href: "/policy", icon: IconBookStroked, kind: "link" },
  { label: "通讯录", href: "/contacts", icon: IconUserStroked, kind: "link" },
  { label: "法律导航", href: "https://yesen.cn", icon: IconGlobeStroked, kind: "external" }
];
