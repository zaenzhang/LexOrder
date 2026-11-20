"use client"

import { MenuIcon, SearchIcon } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

import { Link, usePathname, type KitLink } from "../framework"
import { useCommandMenu } from "../command/command-menu"
import { useCustomizer } from "../customizer/customizer-provider"
import { CustomizerPanel } from "../customizer/customizer-panel"
import { AppSidebar } from "./app-sidebar"
import { BreadcrumbLabelProvider, Breadcrumbs, titleFor, type BreadcrumbResolver } from "./breadcrumbs"
import { ModeToggle } from "./mode-toggle"
import { initials, UserMenuContent } from "./nav-user"
import { TopNav } from "./top-nav"
import type { ShellConfig } from "./types"

function SearchButton({ workbench }: { workbench?: boolean }) {
  const { setOpen } = useCommandMenu()
  return (
    <Button
      variant="outline"
      className={cn("w-9 justify-center px-0 text-muted-foreground sm:justify-between sm:px-2.5", workbench ? "transition-colors sm:w-36 xl:w-56" : "sm:w-56")}
      onClick={() => setOpen(true)}
      aria-keyshortcuts="Meta+K Control+K"
      aria-label={workbench ? "搜索工作区页面" : "Search"}
    >
      <span className="flex items-center gap-2">
        <SearchIcon />
        <span className="sr-only whitespace-nowrap sm:not-sr-only">{workbench ? "搜索…" : "Search…"}</span>
      </span>
      <KbdGroup aria-hidden className="hidden sm:inline-flex">
        <Kbd>{workbench ? "Ctrl" : "⌘"}</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </Button>
  )
}

export interface AppShellProps {
  config: ShellConfig
  badges: Record<string, number>
  /** Header buttons placed before the customizer (notifications, assistant). */
  actions?: React.ReactNode
  /** Panels rendered beside the content, e.g. an assistant side panel. */
  aside?: React.ReactNode
  /** Breadcrumb title of the home route ("/"). Default: the nav entry for "/", else "Overview". */
  home?: string
  resolveBreadcrumbs?: BreadcrumbResolver
  workspaceSwitcher?: React.ReactNode
  workbench?: boolean
  navigationLink?: KitLink
  children: React.ReactNode
}

/**
 * The frame every dashboard page sits in. Layout, sidebar style and content
 * width come from the customizer; navigation comes from `config`.
 */
export function AppShell({ config, badges, actions, aside, home: homeTitle, resolveBreadcrumbs, workspaceSwitcher, workbench, navigationLink: NavigationLink = Link, children }: AppShellProps) {
  const layoutPreference = useCustomizer((state) => state.layout)
  const layout = workbench ? "sidebar" : layoutPreference
  const contentWidth = useCustomizer((state) => state.contentWidth)
  const Brand = config.brand.logo
  const links = [...config.nav.flatMap((group) => group.items), ...config.secondary]
  const home = { title: homeTitle ?? titleFor("/", links) ?? "Overview", href: "/" }
  // The shell stays mounted across routes, so the mobile menu closes itself when a link is followed.
  const [menuOpen, setMenuOpen] = useState(false)

  // The sidebar layout's SidebarInset is already the page's <main>, so the content there is a <div>.
  const Content = layout === "top" ? "main" : "div"
  const pathname = usePathname()
  const previousPath = useRef(pathname)
  const contentElement = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const changed = previousPath.current !== pathname
    previousPath.current = pathname
    if (!workbench || !changed || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const body = contentElement.current
    if (!body) return
    const easing = getComputedStyle(body).getPropertyValue("--ease-smooth-out").trim() || "ease-out"
    const transition = body.animate([{ opacity: 0.92 }, { opacity: 1 }], { duration: 100, easing })
    return () => transition?.cancel()
  }, [pathname, workbench])
  const main = (
    <Content ref={contentElement} className={cn("flex w-full min-w-0 flex-1 flex-col gap-6 bg-page p-4", workbench ? "md:px-7 md:pb-7 md:pt-8" : "md:p-6", contentWidth === "contained" && "mx-auto max-w-7xl")}>
      {children}
    </Content>
  )

  const toolbar = (
    <div className="ms-auto flex shrink-0 items-center gap-1">
      {workbench && <>
        <span className="me-2 hidden items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground xl:inline-flex"><span aria-hidden className="size-1.5 rounded-full bg-emerald-600" />个人工作区</span>
        <NavigationLink className="me-1 whitespace-nowrap text-xs text-primary hover:underline sm:me-2" href="/analytics">设计参考</NavigationLink>
      </>}
      <SearchButton workbench={workbench} />
      {actions}
      <ModeToggle workbench={workbench} />
      <CustomizerPanel workbench={workbench} />
    </div>
  )

  if (layout === "top") {
    return (
      <BreadcrumbLabelProvider>
        <div className="flex min-h-svh flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" />}>
                <MenuIcon />
              </SheetTrigger>
              <SheetContent side="left" className="w-72">
                <SheetHeader>
                  <SheetTitle>{config.brand.name}</SheetTitle>
                </SheetHeader>
                <nav className="flex min-h-0 flex-col gap-1 overflow-y-auto px-2">
                  {links.flatMap((link) => link.expandOnly && link.items ? link.items : [link]).filter((link) => !link.disabled).map((link) => (
                    <Button key={link.href} variant="ghost" className="justify-start" nativeButton={false} render={<Link href={link.href} onClick={() => setMenuOpen(false)} />}>
                      {link.icon && <link.icon data-icon="inline-start" />}
                      {link.title}
                    </Button>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
            <Link href="/" className="flex items-center gap-2 font-medium">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Brand className="size-4" />
              </span>
              <span className="sr-only sm:not-sr-only">{config.brand.name}</span>
            </Link>
            <TopNav groups={config.nav} />
            {toolbar}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu" />}>
                <Avatar className="size-7">
                  {config.user.avatar && <AvatarImage src={config.user.avatar} alt={config.user.name} />}
                  <AvatarFallback>{initials(config.user.name)}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <UserMenuContent user={config.user} />
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <div className={cn("flex w-full min-w-0 flex-1 flex-col", contentWidth === "contained" && "mx-auto max-w-7xl")}>
            <div className="px-4 pt-4 md:px-6">
              <Breadcrumbs links={links} home={home} resolve={resolveBreadcrumbs} />
            </div>
            {main}
          </div>
          {aside}
        </div>
      </BreadcrumbLabelProvider>
    )
  }

  return (
    <BreadcrumbLabelProvider>
      <SidebarProvider>
        <AppSidebar config={config} badges={badges} workspaceSwitcher={workspaceSwitcher} workbench={workbench} navigationLink={NavigationLink} />
        {/* min-w-0 lets wide tables scroll inside their card instead of widening the page. */}
        <SidebarInset className="min-w-0">
          <header className={cn("sticky top-0 z-30 flex h-14 min-w-0 shrink-0 items-center gap-2 border-b px-4 md:rounded-t-xl", workbench ? "bg-background md:px-7" : "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80")}>
            <SidebarTrigger className="-ms-1" />
            <Separator orientation="vertical" className="me-1 data-vertical:h-4 data-vertical:self-center" />
            <div className="min-w-0 [&_[data-slot=breadcrumb-item]]:min-w-0 [&_[data-slot=breadcrumb-page]]:truncate">
              <Breadcrumbs links={links} home={home} resolve={resolveBreadcrumbs} />
            </div>
            {toolbar}
          </header>
          {main}
        </SidebarInset>
        {aside}
      </SidebarProvider>
    </BreadcrumbLabelProvider>
  )
}
