"use client"

import { cn } from "@/lib/utils"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarSeparator,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

import { Link, usePathname, type KitLink } from "../framework"
import { useCustomizer, useKitTheme } from "../customizer/customizer-provider"
import { ActiveNavIndicator } from "../ui-patterns/active-nav-indicator"
import { isActive } from "./nav-active"
import { NavMain } from "./nav-main"
import { NavUser } from "./nav-user"
import type { ShellConfig } from "./types"
import { WorkspaceSwitcher } from "./workspace-switcher"

export function AppSidebar({ config, badges, workspaceSwitcher, workbench, navigationLink: NavigationLink = Link }: { config: ShellConfig; badges: Record<string, number>; workspaceSwitcher?: React.ReactNode; workbench?: boolean; navigationLink?: KitLink }) {
  const defaultVariant = useKitTheme().defaults.sidebarVariant
  const variant = useCustomizer((state) => state.sidebarVariant)
  const collapsible = useCustomizer((state) => state.sidebarCollapsible)
  const direction = useCustomizer((state) => state.direction)
  const pathname = usePathname()
  const { isMobile, state, setOpenMobile } = useSidebar()

  return (
    <Sidebar variant={workbench ? defaultVariant : variant} collapsible={collapsible} side={direction === "rtl" ? "right" : "left"}>
      <SidebarHeader>
        {workspaceSwitcher ?? <WorkspaceSwitcher workspaces={config.workspaces} labels={config.workspaceLabels} />}
      </SidebarHeader>
      {workbench && <SidebarSeparator />}
      <SidebarContent>
        {/* A real box, not display: contents (some screen readers drop those): the nav is the links' landmark. */}
        <nav
          aria-label={workbench ? "主导航" : "Main"}
          className={cn(
            "relative flex flex-col",
            workbench && "isolate [&>[data-sidebar=group]]:z-10 [&_[aria-current=page]]:bg-transparent!",
            workbench && "[&_[data-sidebar=menu-button][data-active][aria-expanded=true]]:bg-sidebar-accent/55 [&_[data-sidebar=menu-button]>svg]:[stroke-width:1.75] [&_[data-sidebar=menu-button][data-active]>svg:first-child]:text-primary",
          )}
        >
          {workbench && (
            <ActiveNavIndicator
              activeKey={pathname + (isMobile ? ":mobile" : ":" + state)}
              className="rounded-md bg-sidebar-accent"
              subMenuSelector='[data-sidebar="menu-sub"]'
            />
          )}
          <NavMain groups={config.nav} badges={badges} navigationLink={NavigationLink} compactGroups={workbench} />
          {workspaceSwitcher && !workbench && (
            <SidebarGroup>
              <WorkspaceSwitcher workspaces={config.workspaces} labels={config.workspaceLabels} />
            </SidebarGroup>
          )}
        </nav>
      </SidebarContent>
      <SidebarFooter className={workbench ? "border-t border-sidebar-border" : undefined}>
        <nav aria-label="固定入口">
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {config.secondary.map((link) => {
                  const Icon = link.icon
                  return (
                    <SidebarMenuItem key={link.href}>
                      <SidebarMenuButton size="sm" tooltip={link.title} isActive={isActive(pathname, link.href)} aria-current={isActive(pathname, link.href) ? "page" : undefined} render={<NavigationLink href={link.href} onClick={() => setOpenMobile(false)} />}>
                        {Icon && <Icon />}
                        <span>{link.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
        <NavUser user={config.user} links={workbench ? config.secondary : undefined} navigationLink={NavigationLink} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
