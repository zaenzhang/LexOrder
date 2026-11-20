"use client"

import { BriefcaseBusinessIcon, ChevronsUpDownIcon, FolderOpenIcon, PlusIcon } from "lucide-react"
import Link from "@/features/shell/workspace-link"
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

  const title = current?.title ?? (matterId ? identityFailed ? "当前案件不可用" : "案件工作空间" : "选择案件")
  const detail = current?.internalCode
  const closeMobile = () => setOpenMobile(false)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger render={
            <SidebarMenuButton size="lg" aria-label={"切换案件：" + title}
              className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />
          }>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <BriefcaseBusinessIcon className="size-4" />
            </span>
            <span className="grid min-w-0 flex-1 text-start leading-tight">
              <span className="truncate font-medium" title={title}>{title}</span>
              {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
            </span>
            <ChevronsUpDownIcon className="ms-auto" />
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
  )
}
