"use client"

import { BookOpenIcon, BriefcaseBusinessIcon, ClipboardListIcon, FileCheckIcon, FileStackIcon, GavelIcon, KeyboardIcon, LayoutDashboardIcon, ListChecksIcon, StampIcon, WalletIcon, MoonIcon, UserPlusIcon, UsersIcon, type LucideIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { usePathname, useRouter } from "next/navigation"
import { lazy, Suspense, useCallback, useMemo, useState } from "react"

import { NAV, SECONDARY_NAV } from "@/config/nav"
import { SITE } from "@/config/site"
import type { User } from "@/data/schema"
import { useDemoCommands } from "@/features/demo/demo-commands"
import { workspace } from "@/data/generate"
import { useRecentMatter } from "@/features/matters/recent-matter"
import { MatterSessionProvider } from "@/features/matters/matter-session"
import { MatterWorkspaceSwitcher } from "@/features/matters/matter-workspace-switcher"
import { matterSections, type MatterSection } from "@/features/matters/sections"
import { useMail } from "@/features/mail/store"
import { useNotifications } from "@/features/notifications/store"
import { CommandMenuProvider, type CommandAction, type CommandSearchResult } from "@/kit/command/command-menu"
import { NotificationBell } from "@/kit/notifications/notification-bell"
import { useCustomizer } from "@/kit/customizer/customizer-provider"
import type { NavGroup, NavLink } from "@/kit/shell/types"
import { AppShell } from "@/kit/shell/app-shell"
import { ShortcutsProvider, useShortcutsHelp } from "@/kit/shortcuts/shortcuts"
import { useList } from "@/kit/data/hooks"
import { adapter, type Resources } from "@/lib/data"

/**
 * Chronicle's frame: the Dashboard Kit shell (sidebar or top nav, customizer,
 * ⌘K, G shortcuts, notifications) wired to the sample workspace. Everything
 * it shows comes from config/nav.ts, config/site.ts and lib/data.ts.
 */

/** Open means not done, the same as the Tasks page header. */
const OPEN_TASKS = { pageSize: 1, filters: { status: ["backlog", "todo", "in_progress", "review"] } }
/** The seed's count, so the badge is in the first HTML and does not pop in. */
const SEED_OPEN_TASKS = workspace().tasks.filter((task) => task.status !== "done").length

const DebugPanel = process.env.NODE_ENV === "development"
  ? lazy(() => import("./debug-panel").then(module => ({ default: module.DebugPanel })))
  : null

const LINKS = [...NAV.flatMap((group) => group.items), ...SECONDARY_NAV]

const SECTION_ICONS: Record<MatterSection, LucideIcon> = {
  overview: LayoutDashboardIcon, materials: FileStackIcon, evidence: GavelIcon, research: BookOpenIcon,
  tasks: ListChecksIcon, delivery: FileCheckIcon, records: ClipboardListIcon, finance: WalletIcon, seal: StampIcon,
}

function caseRoute(pathname: string) {
  const [, root, id, key, extra] = pathname.split("/")
  if (root !== "matters" || !id || !/^c[a-z0-9]{24,}$/.test(id) || extra) return
  const section = matterSections.find(([value]) => value === key)
  if (section) return { id, title: section[1], section: section[0] }
}

function resolveCaseBreadcrumbs(pathname: string) {
  const matter = caseRoute(pathname)
  if (!matter) return
  return [{ href: "/matters/list", title: "案件总览", isLast: false }, { href: pathname, title: matter.title, isLast: true }]
}

function Frame({ children }: { children: React.ReactNode }) {
  const route = caseRoute(usePathname())
  useRecentMatter(route?.id, route?.section)
  const [session, setSession] = useState<{ current?: string; sections: Record<string, MatterSection> }>({ sections: {} })
  if (route && (session.current !== route.id || session.sections[route.id] !== route.section)) {
    setSession({ current: route.id, sections: { ...session.sections, [route.id]: route.section } })
  }
  const matterId = route?.id ?? session.current
  const topNav = useCustomizer((state) => state.layout === "top")
  function sectionLink(key: MatterSection, title: string): NavLink {
    return { title, href: matterId ? "/matters/" + matterId + "/" + key : "/matters/list#" + key,
      icon: SECTION_ICONS[key], disabled: !matterId }
  }
  const sections = Object.fromEntries(matterSections.map(([key, title]) => [key, sectionLink(key, title)])) as Record<MatterSection, NavLink>
  const caseLinks = topNav
    ? [{ ...sections.materials, title: "案件", icon: BriefcaseBusinessIcon, expandOnly: true,
        items: matterSections.filter(([key]) => key !== "overview").map(([key]) => sections[key]) }]
    : [
      sections.materials,
      { ...sections.evidence, title: "事实与研究", expandOnly: true, items: [sections.evidence, sections.research] },
      sections.tasks, sections.delivery, sections.records,
      { ...sections.finance, title: "财务与用印", expandOnly: true, items: [sections.finance, sections.seal] },
    ]
  const nav: NavGroup[] = NAV.map(group => group.label === "Workspace"
    ? { ...group, items: [...group.items, ...caseLinks] }
    : group)
  const items = useNotifications((state) => state.items)
  const markRead = useNotifications((state) => state.markRead)
  // Open work, through the adapter like every screen, so it follows the board.
  const openTasks = useList<Resources, "tasks">("tasks", OPEN_TASKS).data?.total ?? SEED_OPEN_TASKS
  const unreadMail = useMail((state) => state.mails.filter((mail) => !mail.read && mail.folder === "inbox").length)
  return (
    <AppShell
      config={{ ...SITE, nav }}
      workspaceSwitcher={<MatterWorkspaceSwitcher matterId={matterId} lastSections={session.sections} />}
      resolveBreadcrumbs={resolveCaseBreadcrumbs}
      badges={{ tasks: openTasks, mail: unreadMail }}
      actions={<NotificationBell items={items} onMarkRead={markRead} viewAllHref="/notifications" settingsHref="/settings/notifications" emptyDescription="Payments, cancellations and upgrades appear here." />}
    >
      {children}
    </AppShell>
  )
}

const USER_ICON: LucideIcon = UsersIcon

function Commands({ children }: { children: React.ReactNode }) {
  const { resolvedTheme, setTheme } = useTheme()
  const help = useShortcutsHelp()
  const router = useRouter()
  const demo = useDemoCommands()

  const actions = useMemo<CommandAction[]>(
    () => [
      { id: "invite", title: "Invite a user", icon: UserPlusIcon, group: "Actions", run: () => router.push("/users?invite=1") },
      { id: "over-limit", title: "Show users over their seat limit", icon: UsersIcon, group: "Actions", run: () => router.push("/users?view=over-limit") },
      {
        id: "theme",
        title: resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        icon: MoonIcon,
        shortcut: "D",
        group: "Preferences",
        run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      },
      { id: "shortcuts", title: "Keyboard shortcuts", icon: KeyboardIcon, shortcut: "?", group: "Preferences", run: () => help?.openHelp() },
      ...demo,
    ],
    [demo, help, resolvedTheme, router, setTheme]
  )

  const search = useCallback(async (text: string): Promise<CommandSearchResult[]> => {
    const result = await adapter.list("users", { search: text, pageSize: 8 })
    return result.rows.map((user: User) => ({ id: user.id, title: user.name, subtitle: `${user.email} · ${user.accountName}`, href: `/users/${user.id}`, group: "Users", icon: USER_ICON }))
  }, [])

  return (
    <CommandMenuProvider links={LINKS} actions={actions} search={search} description="Search users by name, email or account, jump to a page, or run an action.">
      {children}
    </CommandMenuProvider>
  )
}

export function ChronicleShell({ children }: { children: React.ReactNode }) {
  return (
    <ShortcutsProvider
      links={LINKS}
      extra={[
        { keys: ["⌘", "K"], label: "Search and actions" },
        { keys: ["⌘", "B"], label: "Collapse or expand the sidebar" },
        { keys: ["D"], label: "Toggle dark mode" },
        { keys: ["?"], label: "Show these shortcuts" },
      ]}
    >
      <Commands>
        <MatterSessionProvider><Frame>{children}</Frame></MatterSessionProvider>
        {DebugPanel && <Suspense><DebugPanel /></Suspense>}
      </Commands>
    </ShortcutsProvider>
  )
}
