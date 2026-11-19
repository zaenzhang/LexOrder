"use client"

import { useQuery } from "@tanstack/react-query"
import { readPersonal } from "@/features/matters/personal-client"

const endpoint = "/api/personal-runtime/practice"

export function usePractice<T>(
  view: string,
  params: Record<string, string> = {},
  enabled = true
) {
  const query = new URLSearchParams({ view, ...params }).toString()
  return useQuery({
    queryKey: ["practice", query],
    queryFn: ({ signal }) =>
      readPersonal<T>(endpoint + "?" + query, { signal }),
    retry: false,
    enabled,
  })
}

export function writePractice<T = { ok: boolean }>(
  data: Record<string, unknown>
) {
  return readPersonal<T>(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
}

export const chinaDate = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
