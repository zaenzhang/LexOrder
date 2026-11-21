import { invoke, isTauri } from "@tauri-apps/api/core"

export const commissionItemLabels = { QUANTITY: "签收数量", APPEARANCE: "外观核对", PERFORMANCE: "性能验收" }
export type CommissionKind = keyof typeof commissionItemLabels
export type CommissionFollowUp = { priorId: string; kind: CommissionKind }
export type CommissionIssue = { kind: "CURRENT"; issueId: string; revision: number; confirmedAt: string | null }

export type Matter = { id: string; title: string; internalCode: string }

export const evidenceEndpoint = "/api/personal/evidence-review"

let renewingChannel: Promise<void> | undefined

export function connectPersonalChannel() {
  if (!isTauri()) return Promise.resolve()
  renewingChannel ??= invoke<void>("renew_personal_channel").finally(() => { renewingChannel = undefined })
  return renewingChannel
}

export async function personalFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  if (response.headers.get("X-Lexorder-Channel") !== "required" || !isTauri() || init?.signal?.aborted) return response
  await connectPersonalChannel()
  return fetch(url, init)
}

export async function readPersonal<T>(url: string, init?: RequestInit): Promise<T> {
  const readTimeout = !init?.method || init.method === "GET" ? AbortSignal.timeout(20_000) : undefined
  const signal = readTimeout && init?.signal ? AbortSignal.any([init.signal, readTimeout]) : readTimeout ?? init?.signal
  try {
    const response = await personalFetch(url, { ...init, signal })
    if (!response.ok) {
      const result = await response.json().catch(() => null)
      throw new Error(result?.error || (response.status === 403 ? "当前没有权限访问此工作区内容。" : "无法读取个人工作区，请稍后重试。"))
    }
    return await response.json() as T
  } catch (error) {
    if (readTimeout?.aborted && !init?.signal?.aborted) throw new Error("读取工作区超时，请重试。")
    throw error
  }
}

export const workspaceEndpoint = "/api/personal/matter-workspace"
