import type { ComponentType } from "react"
import { createBrowserRouter, Outlet, type RouteObject } from "react-router"

import RootLayout from "@/app/layout"
import NotFound from "@/app/not-found"
import { ChronicleShell } from "@/features/shell/chronicle-shell"
import { SettingsFrame, WorkbenchSettingsFrame } from "@/features/settings/settings-frame"
import { Spinner } from "@/components/ui/spinner"

type Page = { default: ComponentType; metadata?: { title: string } }

const views = import.meta.glob<Page>([
  "/app/**/page.tsx",
  "/app/**/page.demo.tsx",
  "/app/**/page.further.tsx",
])
const pages: RouteObject[] = []
const shell: RouteObject[] = []
const settings: RouteObject[] = []
const workbenchSettings: RouteObject[] = []
const demo = import.meta.env.MODE === "demo"

for (const [file, load] of Object.entries(views)) {
  if (file.endsWith(".demo.tsx") && !demo) continue
  if (file.endsWith(".further.tsx") && !demo && !import.meta.env.DEV) continue
  const path = file.slice("/app/".length).split("/").slice(0, -1)
    .filter(segment => !segment.startsWith("("))
    .map(segment => segment.replace(/^\[(.+)\]$/, ":$1")).join("/")
  const lazy = async () => {
    const { default: Component, metadata } = await load()
    return {
      Component: () => <>{metadata?.title && <title>{metadata.title} · Chronicle</title>}<Component /></>,
    }
  }
  const target = file.startsWith("/app/(shell)/settings/") ? settings
    : file.startsWith("/app/(shell)/practice/profile/") ? workbenchSettings
    : file.startsWith("/app/(shell)/") ? shell : pages
  target.push(path ? { path, lazy } : { index: true, lazy })
}
shell.push({ Component: () => <SettingsFrame><Outlet /></SettingsFrame>, children: settings })
shell.push({ Component: () => <WorkbenchSettingsFrame><Outlet /></WorkbenchSettingsFrame>, children: workbenchSettings })
pages.push({ Component: () => <ChronicleShell><Outlet /></ChronicleShell>, children: shell })
pages.push({ path: "*", Component: NotFound })

export const router = createBrowserRouter([{
  Component: RootLayout,
  HydrateFallback: () => <div className="grid min-h-screen place-items-center"><Spinner /></div>,
  children: pages,
}], { basename: demo ? import.meta.env.BASE_URL : "/" })
