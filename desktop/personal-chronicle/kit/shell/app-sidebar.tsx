"use client"

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
  const { setOpenMobile } = useSidebar()

  return (
    <Sidebar variant={workbench ? defaultVariant : variant} collapsible={collapsible} side={direction === "rtl" ? "right" : "left"}>
      <SidebarHeader>
        {workspaceSwitcher ?? <WorkspaceSwitcher workspaces={config.workspaces} labels={config.workspaceLabels} />}
      </SidebarHeader>
      {workbench && <SidebarSeparator />}
      <SidebarContent>
        {/* A real box, not display: contents (some screen readers drop those): the nav is the links' landmark. */}
        <nav aria-label={workbench ? "主导航" : "Main"} className="flex flex-col">
          <NavMain groups={config.nav} badges={badges} navigationLink={NavigationLink} />
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
        {workbench ? <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
          <span className="grid size-6 shrink-0 place-items-center rounded-md border border-sidebar-border">律</span>
          <span className="truncate group-data-[collapsible=icon]:hidden">本机用户</span>
        </div> : <NavUser user={config.user} />}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
