"use client"

import { BriefcaseBusinessIcon, ChevronsUpDownIcon, FolderOpenIcon } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import type { MatterSection } from "./sections"
import { evidenceEndpoint, readPersonal, workspaceEndpoint, type Matter } from "./personal-client"

type MatterChoices = { matters: Matter[]; hasMore: boolean }

export function MatterWorkspaceSwitcher({ matterId, lastSections }: { matterId?: string; lastSections: Record<string, MatterSection> }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const [choices, setChoices] = useState<MatterChoices>()
  const [choiceError, setChoiceError] = useState("")
  const [identity, setIdentity] = useState<{ id: string; title: string; internalCode?: string }>()
  const [identityError, setIdentityError] = useState<string>()
  const current = choices?.matters.find(matter => matter.id === matterId)
    ?? (identity?.id === matterId ? identity : undefined)
  const hasCurrent = !!current

  useEffect(() => {
    if (!matterId || hasCurrent) return
    const controller = new AbortController()
    const query = new URLSearchParams({ matter: matterId, section: "overview" })
    readPersonal<{ title: string; internalCode?: string }>(workspaceEndpoint + "?" + query, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setIdentity({ ...result, id: matterId }) })
      .catch(() => { if (!controller.signal.aborted) setIdentityError(matterId) })
    return () => controller.abort()
  }, [matterId, hasCurrent])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    readPersonal<MatterChoices>(evidenceEndpoint, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setChoices(result); setChoiceError("") } })
      .catch((error: Error) => { if (!controller.signal.aborted) { setChoices(undefined); setChoiceError(error.message) } })
    return () => controller.abort()
  }, [open])

  const title = current?.title ?? (matterId ? identityError === matterId ? "当前案件不可用" : "案件工作空间" : "选择案件")
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
                  render={<Link href={"/matters/" + matter.id + "/" + (lastSections[matter.id] ?? "overview")} onClick={closeMobile} />}
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
            <DropdownMenuItem nativeButton={false} render={<Link href="/matters/list" onClick={closeMobile} />} className="gap-2 p-2">
              <FolderOpenIcon />
              {choices?.hasMore ? "查看全部案件" : "案件总览"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
