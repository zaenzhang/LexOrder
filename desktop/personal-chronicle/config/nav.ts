import {
  BarChart3Icon,
  BellIcon,
  BriefcaseBusinessIcon,
  CalendarDaysIcon,
  CheckSquareIcon,
  CircleHelpIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  LockKeyholeIcon,
  MailIcon,
  MessagesSquareIcon,
  SettingsIcon,
  SparklesIcon,
  TagIcon,
  TriangleAlertIcon,
  UsersIcon,
  UsersRoundIcon,
  WalletCardsIcon,
  WrenchIcon,
} from "lucide-react"

import { ShadcnStoreMark } from "@/components/chronicle/shadcnstore-mark"
import { BRAND } from "@/config/brand"
import { CLIENT_TABS } from "@/config/client-tabs"
import { authPath, type AuthScreen, type AuthVariant } from "@/features/auth/auth-paths"
import { showGoFurther } from "@/features/demo/config"
import type { NavGroup, NavLink } from "@/kit/shell/types"
import type { LucideIcon } from "lucide-react"

const AUTH_SCREENS: [AuthScreen, string][] = [
  ["sign-in", "Sign in"],
  ["sign-up", "Sign up"],
  ["forgot-password", "Forgot password"],
]
const AUTH_LAYOUTS: AuthVariant[] = [1, 2, 3]

/** Every auth screen in each of its three layouts (features/auth/auth-variant.tsx). */
const AUTH_PAGES: NavLink[] = AUTH_SCREENS.flatMap(([screen, title]) =>
  AUTH_LAYOUTS.map((variant) => ({ title: `${title} ${variant}`, href: authPath(screen, variant) }))
)

const ERROR_PAGES: NavLink[] = [
  { title: "Unauthorized", href: "/errors/unauthorized" },
  { title: "Forbidden", href: "/errors/forbidden" },
  { title: "Not found", href: "/errors/not-found" },
  { title: "Server error", href: "/errors/internal-server-error" },
  { title: "Maintenance", href: "/errors/under-maintenance" },
]

/**
 * One list drives the sidebar, the top nav, ⌘K and the G shortcuts
 * (G then the letter jumps to the page). Add a page here and it appears
 * everywhere at once. A link with `items` folds in the sidebar and opens
 * by itself on any page inside it.
 */
export const NAV: NavGroup[] = [
  {
    items: [
      { title: "Overview", href: "/", icon: LayoutDashboardIcon, shortcut: "o" },
      { title: "Analytics", href: "/analytics", icon: BarChart3Icon, shortcut: "a" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { title: "Users", href: "/users", icon: UsersIcon, shortcut: "u" },
      { title: "Tasks", href: "/tasks", icon: CheckSquareIcon, shortcut: "t", badge: "tasks" },
    ],
  },
  {
    label: "工作区",
    items: [
      { title: "案件", href: "/matters/list", icon: BriefcaseBusinessIcon },
      { title: "今日", href: "/practice/today", icon: ListTodoIcon },
      {
        title: "客户",
        href: CLIENT_TABS[0].href,
        icon: UsersRoundIcon,
        activePaths: CLIENT_TABS.slice(1).map(tab => tab.href),
      },
      { title: "日程", href: "/practice/schedule", icon: CalendarDaysIcon },
      { title: "财务", href: "/practice/finance", icon: WalletCardsIcon },
      { title: "工具", href: "/practice/skills", icon: WrenchIcon },
    ],
  },
  {
    label: "Apps",
    items: [
      { title: "Mail", href: "/mail", icon: MailIcon, shortcut: "m", badge: "mail" },
      { title: "Chat", href: "/chat", icon: MessagesSquareIcon, shortcut: "c" },
      { title: "Calendar", href: "/calendar", icon: CalendarDaysIcon, shortcut: "l" },
    ],
  },
  {
    label: "Pages",
    items: [
      { title: "Pricing", href: "/pricing", icon: TagIcon, shortcut: "p" },
      { title: "FAQs", href: "/faqs", icon: CircleHelpIcon, shortcut: "f" },
      { title: "Landing", href: "/landing", icon: GlobeIcon },
      { title: "Auth pages", href: "/sign-in", icon: LockKeyholeIcon, items: AUTH_PAGES, expandOnly: true },
      { title: "Errors", href: "/errors/not-found", icon: TriangleAlertIcon, items: ERROR_PAGES, expandOnly: true },
    ],
  },
]

const FIXED_NAV = {
  notifications: { icon: BellIcon, shortcut: "n" },
  settings: { icon: SettingsIcon, shortcut: "s" },
}

export const WORKBENCH_NAV = NAV.find(group => group.label === "工作区")!
export const WORKBENCH_SECONDARY: NavLink[] = [
  { ...FIXED_NAV.notifications, title: "通知", href: "/practice/notifications" },
  { ...FIXED_NAV.settings, title: "设置", href: "/practice/profile" },
]

export const SECONDARY_NAV: NavLink[] = [
  { ...FIXED_NAV.notifications, title: "Notifications", href: "/notifications" },
  { ...FIXED_NAV.settings, title: "Settings", href: "/settings" },
  // The public demo and `pnpm dev` only: what the paid templates add (features/demo). `pnpm build` never shows it.
  ...(showGoFurther ? [{ title: "Go further", href: "/go-further", icon: SparklesIcon }] : []),
  // The template credit (config/brand.ts, credits.show). A plain link, so it never gets a G shortcut.
  ...(BRAND.credits.show ? [{ title: `Built with ${BRAND.credits.by}`, href: BRAND.credits.href, icon: ShadcnStoreMark as unknown as LucideIcon }] : []),
]
