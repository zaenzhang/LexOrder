"use client"

import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select"
import { cn } from "@/lib/utils"

import { Link, usePathname, useRouter } from "../framework"
import { useBreadcrumbLabel } from "../shell/breadcrumbs"
import { activeHref } from "../shell/nav-active"
import type { NavLink } from "../shell/types"
import { ActiveNavIndicator } from "../ui-patterns/active-nav-indicator"
import { PageHeader } from "../ui-patterns/page-header"

export interface SettingsGroup {
  label: string
  items: NavLink[]
}

/**
 * The settings frame: a list of sections beside the content on wide screens,
 * a select above it on phones. Each section is its own page and its own save.
 */
export function SettingsLayout({
  groups,
  title = "Settings",
  description = "Your workspace, your team and your account.",
  navigationLabel,
  children,
}: {
  groups: SettingsGroup[]
  title?: string
  /** One line under the title: what the settings cover in this product. */
  description?: string
  navigationLabel?: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const links = groups.flatMap((group) => group.items)
  const current = activeHref(pathname, links) ?? links[0]?.href
  // The breadcrumb names the section the way this menu does ("API keys", not "Api keys").
  useBreadcrumbLabel(pathname === "/settings" ? null : (links.find((link) => link.href === current)?.title ?? null))

  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="grid items-start gap-6 lg:grid-cols-[13rem_1fr]">
        <nav aria-label={navigationLabel ?? "Settings sections"} className="relative hidden flex-col gap-5 lg:sticky lg:top-20 lg:flex">
          <ActiveNavIndicator activeKey={current ?? null} className="rounded-lg bg-card shadow-(--surface-shadow) ring-1 ring-foreground/5" />
          {groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <span className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.label}</span>
              {group.items.map((item) => {
                const Icon = item.icon
                const active = current === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group/link relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                      !active && "hover:bg-muted/60",
                      active && "font-medium text-foreground"
                    )}
                  >
                    {Icon && <Icon className={cn("size-4 transition-colors duration-150", active && "text-primary")} />}
                    {item.title}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
        <NativeSelect aria-label={navigationLabel ?? "Settings section"} className="lg:hidden" value={current} onChange={(event) => router.push(event.target.value)}>
          {groups.map((group) => (
            <NativeSelectOptGroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <NativeSelectOption key={item.href} value={item.href}>
                  {item.title}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ))}
        </NativeSelect>
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
      </div>
    </>
  )
}
