"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { usePractice } from "@/features/practice/data"
import { readPersonal, workspaceEndpoint } from "./personal-client"
import { matterSections, type MatterSection } from "./sections"

type Visit = { id: string; section: MatterSection }

export function readRecentMatters(workspace: string): Visit[] {
  try {
    const records: unknown = JSON.parse(
      localStorage.getItem("lexorder.recent." + workspace) ?? "[]"
    )
    if (!Array.isArray(records)) return []
    return records
      .filter(
        (row): row is Visit =>
          typeof row?.id === "string" &&
          /^c[a-z0-9]{24,}$/.test(row.id) &&
          matterSections.some(([key]) => key === row.section)
      )
      .slice(0, 40)
  } catch {
    return []
  }
}

export function useRecentMatter(id?: string, section?: MatterSection) {
  const { data } = usePractice<{ id: string }>("workspace", {}, !!id)
  useEffect(() => {
    if (!data || !id || !section) return
    const records = [
      { id, section },
      ...readRecentMatters(data.id).filter((row) => row.id !== id),
    ].slice(0, 40)
    try {
      localStorage.setItem(
        "lexorder.recent." + data.id,
        JSON.stringify(records)
      )
    } catch {
      // A read-only WebView can still switch cases in the current window.
    }
  }, [data, id, section])
}

export function ResumeMatter() {
  const { data } = usePractice<{ id: string }>("workspace")
  const [link, setLink] = useState<{
    workspace: string
    visit: Visit
    title: string
  }>()
  useEffect(() => {
    if (!data) return
    const [visit] = readRecentMatters(data.id)
    if (!visit) return
    const controller = new AbortController()
    const query = new URLSearchParams({ matter: visit.id, section: "overview" })
    readPersonal<{ title: string }>(workspaceEndpoint + "?" + query, {
      signal: controller.signal,
    })
      .then((row) => {
        if (!controller.signal.aborted)
          setLink({ workspace: data.id, visit, title: row.title })
      })
      .catch(() => {
        /* An inaccessible case has no resume link. */
      })
    return () => controller.abort()
  }, [data])
  if (!link || data?.id !== link.workspace) return null
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={<Link href={`/matters/${link.visit.id}/${link.visit.section}`} />}
    >
      继续上次案件 · {link.title}
    </Button>
  )
}
