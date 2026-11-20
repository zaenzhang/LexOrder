"use client"

import { BriefcaseBusinessIcon, ChevronDownIcon, FolderOpenIcon, LayoutDashboardIcon, PlusIcon } from "lucide-react"
import Link from "@/features/shell/workspace-link"
import wordmark from "@/components/chronicle/luji-wordmark.png?url"
import appMark from "@/desktop-preview/icons/32x32.png?url"
import { useEffect, useState } from "react"

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { usePractice } from "@/features/practice/data"
import { readRecentMatters } from "./recent-matter"
import type { MatterSection } from "./sections"
import { evidenceEndpoint, readPersonal, type Matter } from "./personal-client"

type MatterChoices = { matters: Matter[]; hasMore: boolean }

export function MatterWorkspaceSwitcher({ matterId, identity, identityFailed, lastSections }: {
  matterId?: string; identity?: Matter; identityFailed?: boolean; lastSections: Record<string, MatterSection>
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const workspace = usePractice<{id:string}>("workspace", {}, open)
  const saved = workspace.data && open ? readRecentMatters(workspace.data.id) : []
  const [choices, setChoices] = useState<MatterChoices>()
  const [choiceError, setChoiceError] = useState("")
  const current = identity ?? choices?.matters.find(matter => matter.id === matterId)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    readPersonal<MatterChoices>(evidenceEndpoint, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setChoices(result); setChoiceError("") } })
      .catch((error: Error) => { if (!controller.signal.aborted) { setChoices(undefined); setChoiceError(error.message) } })
    return () => controller.abort()
  }, [open])

  const title = current?.title ?? (matterId ? identityFailed ? "当前案件不可用" : "案件工作空间" : "个人工作区")
  const closeMobile = () => setOpenMobile(false)

  return (
    <>
      <div className="mx-2 mb-1 flex items-center gap-2 group-data-[collapsible=icon]:hidden">
        <img src={wordmark} alt="律迹" className="h-5 w-auto shrink-0 dark:invert" />
        <img src={appMark} alt="" className="size-5 shrink-0" />
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger render={
              <SidebarMenuButton aria-label={"切换案件：" + title}
                className="group-data-[collapsible=icon]:justify-center data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />
            }>
              <span className="min-w-0 flex-1 truncate font-medium group-data-[collapsible=icon]:hidden" title={title}>{title}</span>
              <ChevronDownIcon aria-hidden className="text-sidebar-foreground/60 group-aria-expanded/menu-button:rotate-180 motion-safe:transition-transform motion-safe:duration-150" strokeWidth={1.75} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-64 max-w-[min(26rem,calc(100vw-2rem))]" align="start" side={isMobile ? "bottom" : "right"} sideOffset={4}>
              <DropdownMenuGroup>
                <DropdownMenuLabel>切换案件</DropdownMenuLabel>
                {choices?.matters.map(matter => (
                  <DropdownMenuItem key={matter.id} nativeButton={false}
                    render={<Link href={"/matters/" + matter.id + "/" + (lastSections[matter.id] ?? saved.find(visit => visit.id === matter.id)?.section ?? "overview")} onClick={closeMobile} />}
                    aria-current={matter.id === matterId ? "true" : undefined} className="gap-2 p-2">
                    <BriefcaseBusinessIcon className="shrink-0" />
                    <span className="truncate">{matter.title}</span>
                    {matter.id === matterId && <DropdownMenuShortcut>当前</DropdownMenuShortcut>}
                  </DropdownMenuItem>
                ))}
                {(!choices || !choices.matters.length) && <div className="px-2 py-2 text-sm text-muted-foreground" role="status">
                  {choiceError || (choices ? "暂无案件" : "正在读取案件…")}
                </div>}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem nativeButton={false} render={<Link href="/practice/today" onClick={closeMobile} />} className="gap-2 p-2">
                <LayoutDashboardIcon />
                个人工作区
              </DropdownMenuItem>
              <DropdownMenuItem nativeButton={false} render={<Link href="/practice/intakes?create=1" onClick={closeMobile} />} className="gap-2 p-2">
                <PlusIcon />
                添加工作区
              </DropdownMenuItem>
              <DropdownMenuItem nativeButton={false} render={<Link href="/matters/list" onClick={closeMobile} />} className="gap-2 p-2">
                <FolderOpenIcon />
                {choices?.hasMore ? "查看全部案件" : "案件列表"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  )
}
