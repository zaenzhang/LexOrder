"use client"

import { ArchiveIcon, BookOpenIcon, ClipboardListIcon, FileCheckIcon, FileStackIcon, GavelIcon, InboxIcon, KeyboardIcon, LayoutDashboardIcon, ListChecksIcon, StampIcon, WalletIcon, MoonIcon, UserPlusIcon, UsersIcon, type LucideIcon } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { useNavigation } from "react-router"
import { usePathname, useRouter } from "@/kit/framework"
import { lazy, Suspense, useCallback, useMemo, useState } from "react"

import { NAV, SECONDARY_NAV, WORKBENCH_NAV, WORKBENCH_SECONDARY } from "@/config/nav"
import { SITE } from "@/config/site"
import type { User } from "@/data/schema"
import { useDemoCommands } from "@/features/demo/demo-commands"
import { workspace } from "@/data/generate"
import { useRecentMatter } from "@/features/matters/recent-matter"
import { MatterSessionProvider } from "@/features/matters/matter-session"
import { MatterWorkspaceSwitcher } from "@/features/matters/matter-workspace-switcher"
import { readPersonal, workspaceEndpoint, type Matter } from "@/features/matters/personal-client"
import { evidenceViews, matterSections, type MatterSection } from "@/features/matters/sections"
import { useMail } from "@/features/mail/store"
import { useNotifications } from "@/features/notifications/store"
import { CommandMenuProvider, type CommandAction, type CommandSearchResult } from "@/kit/command/command-menu"
import { NotificationBell } from "@/kit/notifications/notification-bell"
import type { NavGroup, NavLink } from "@/kit/shell/types"
import { AppShell } from "@/kit/shell/app-shell"
import { PageLoadingProvider, PagePending } from "@/kit/ui-patterns/page-loading"
import { ShortcutsProvider, useShortcutsHelp } from "@/kit/shortcuts/shortcuts"
import { useList } from "@/kit/data/hooks"
import { adapter, type Resources } from "@/lib/data"

import { useDesktopPlugins } from "./desktop-plugins"
import WorkspaceLink from "./workspace-link"
import { WorkbenchNotifications } from "./workbench-notifications"

/**
 * Chronicle's frame: the Dashboard Kit shell (sidebar or top nav, customizer,
 * ⌘K, G shortcuts, notifications) wired to the sample workspace. Everything
 * it shows comes from config/nav.ts, config/site.ts and lib/data.ts.
 */

/** Open means not done, the same as the Tasks page header. */
const OPEN_TASKS = { pageSize: 1, filters: { status: ["backlog", "todo", "in_progress", "review"] } }
/** The seed's count, so the badge is in the first HTML and does not pop in. */
const SEED_OPEN_TASKS = workspace().tasks.filter((task) => task.status !== "done").length

const DebugPanel = import.meta.env.DEV
  ? lazy(() => import("./debug-panel").then(module => ({ default: module.DebugPanel })))
  : null

const DEMO_LINKS = [...NAV.flatMap((group) => group.items), ...SECONDARY_NAV]
const WORKBENCH_LINKS = [...WORKBENCH_NAV.items, ...WORKBENCH_SECONDARY]

const SECTION_ICONS: Record<MatterSection, LucideIcon> = {
  overview: LayoutDashboardIcon, materials: FileStackIcon, court: InboxIcon, evidence: GavelIcon, research: BookOpenIcon,
  tasks: ListChecksIcon, delivery: FileCheckIcon, records: ClipboardListIcon, finance: WalletIcon, seal: StampIcon, archive: ArchiveIcon,
}

function caseRoute(pathname: string) {
  const [, root, id, key, extra] = pathname.split("/")
  if (root !== "matters" || !id || !/^c[a-z0-9]{24,}$/.test(id) || (extra && key !== "research" && key !== "evidence" && key !== "delivery")) return
  const section = matterSections.find(([value]) => value === key)
  if (section) return { id, title: section[0] === "evidence" && extra
    ? evidenceViews.find(([key]) => key === extra)?.[1] ?? section[1] : extra && key === "delivery" ? "文书工作台" : section[1], section: section[0] }
}

function DemoNotifications() {
  const items = useNotifications((state) => state.items)
  const markRead = useNotifications((state) => state.markRead)
  return <NotificationBell items={items} onMarkRead={markRead} viewAllHref="/notifications" settingsHref="/settings/notifications"
    emptyDescription="Payments, cancellations and upgrades appear here." />
}

function Frame({ children, workbench }: { children: React.ReactNode; workbench: boolean }) {
  const tasks = useList<Resources, "tasks">("tasks", OPEN_TASKS, !workbench).data?.total ?? SEED_OPEN_TASKS
  const mail = useMail((state) => workbench ? 0 : state.mails.filter(item => !item.read && item.folder === "inbox").length)
  const route = caseRoute(usePathname())
  useRecentMatter(route?.id, route?.section)
  const [session, setSession] = useState<{ current?: string; sections: Record<string, MatterSection> }>({ sections: {} })
  if (route && (session.current !== route.id || session.sections[route.id] !== route.section)) {
    setSession({ current: route.id, sections: { ...session.sections, [route.id]: route.section } })
  }
  const matterId = route?.id ?? session.current
  const identity = useQuery({
    enabled: workbench && Boolean(matterId),
    queryKey: ["chronicle", "matter-identity", matterId],
    queryFn: ({ signal }) => readPersonal<Matter>(workspaceEndpoint + "?" +
      new URLSearchParams({ matter: matterId!, section: "identity" }), { signal }),
    retry: false, staleTime: 30_000,
  })
  function resolveBreadcrumbs(pathname: string) {
    if (!workbench) return
    const matter = caseRoute(pathname)
    if (!matter) {
      const current = WORKBENCH_LINKS.flatMap(link => [link, ...(link.items ?? [])]).find(link => link.href === pathname)
      const page = { href: pathname, title: current?.title ?? "个人工作区", isLast: true }
      return pathname === "/practice/today" ? [page] : [{ href: "/practice/today", title: "工作区", isLast: false }, page]
    }
    return [{ href: "/matters/list", title: "案件", isLast: false },
      ...(identity.data?.id === matter.id && matter.section !== "overview" ? [{ href: `/matters/${matter.id}/overview`, title: identity.data.internalCode, isLast: false }] : []),
      { href: pathname, title: matter.title, isLast: true }]
  }
  function sectionLink(key: MatterSection, title: string): NavLink {
    return { title, href: matterId ? "/matters/" + matterId + "/" + key : "/matters/list#" + key,
      icon: SECTION_ICONS[key], disabled: !matterId }
  }
  const sections = Object.fromEntries(matterSections.map(([key, title]) => [key, sectionLink(key, title)])) as Record<MatterSection, NavLink>
  const caseLinks = [
      sections.overview,
      sections.tasks,
      { ...sections.materials, expandOnly: true, items: [{ ...sections.materials, title: "材料目录" }, sections.court] },
      { ...sections.evidence, expandOnly: true, items: [
        ...evidenceViews.map(([key, title]) => ({ title, href: key === "claims" ? sections.evidence.href : sections.evidence.href + "/" + key })),
        sections.research,
      ] },
      { ...sections.delivery, expandOnly: true, items: [{ ...sections.delivery, title: "文书列表" }, sections.seal] },
      { ...sections.records, title: "案务管理", expandOnly: true, items: [sections.records, sections.finance, sections.archive] },
    ]
  const nav: NavGroup[] = workbench
    ? [...(matterId ? [{ label: "当前案件", items: caseLinks }] : []), WORKBENCH_NAV]
    : NAV.filter(group => group !== WORKBENCH_NAV)
  return (
    <AppShell
      navigationLink={workbench ? WorkspaceLink : undefined}
      config={{ ...SITE, nav, secondary: workbench ? WORKBENCH_SECONDARY : SECONDARY_NAV }}
      workbench={workbench}
      workspaceSwitcher={workbench ? <MatterWorkspaceSwitcher matterId={matterId} identity={identity.data} identityFailed={identity.isError} lastSections={session.sections} /> : undefined}
      resolveBreadcrumbs={resolveBreadcrumbs}
      badges={workbench ? {} : { tasks, mail }}
      actions={workbench ? <WorkbenchNotifications /> : <DemoNotifications />}
    >
      {children}
    </AppShell>
  )
}

const USER_ICON: LucideIcon = UsersIcon

function Commands({ children, workbench }: { children: React.ReactNode; workbench: boolean }) {
  const { resolvedTheme, setTheme } = useTheme()
  const help = useShortcutsHelp()
  const router = useRouter()
  const demo = useDemoCommands()
  const current = caseRoute(usePathname())
  const catalog = useDesktopPlugins(workbench && !!current)

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

  const pluginActions: CommandAction[] = [
    { id: "local-plugins", title: "查看本机插件", group: "插件", run: () => router.push("/practice/plugins") },
    ...(current ? catalog.data?.plugins.flatMap(plugin => plugin.commands.map(command => ({
      id: plugin.id + "/" + command.id,
      title: command.title,
      group: plugin.name,
      run: () => router.push("/matters/" + current.id + "/" + command.section),
    }))) ?? [] : []),
  ]

  return (
    <CommandMenuProvider workbench={workbench} links={workbench ? WORKBENCH_LINKS : DEMO_LINKS} actions={workbench ? pluginActions : actions} search={workbench ? undefined : search}
      description={workbench ? "前往工作区页面" : "Search users by name, email or account, jump to a page, or run an action."}>
      {children}
    </CommandMenuProvider>
  )
}

export function ChronicleShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const workbench = /^\/(matters|practice)(\/|$)/.test(path)
  const navigation = useNavigation()
  return (
    <ShortcutsProvider
      links={workbench ? WORKBENCH_LINKS : DEMO_LINKS}
      extra={[
        { keys: ["⌘", "K"], label: "Search and actions" },
        { keys: ["⌘", "B"], label: "Collapse or expand the sidebar" },
        { keys: ["D"], label: "Toggle dark mode" },
        { keys: ["?"], label: "Show these shortcuts" },
      ]}
    >
      <Commands workbench={workbench}>
        <PageLoadingProvider enabled={workbench}>
          <PagePending active={navigation.state !== "idle"} />
          <MatterSessionProvider><Frame workbench={workbench}>{children}</Frame></MatterSessionProvider>
        </PageLoadingProvider>
        {DebugPanel && <Suspense><DebugPanel /></Suspense>}
      </Commands>
    </ShortcutsProvider>
  )
}
