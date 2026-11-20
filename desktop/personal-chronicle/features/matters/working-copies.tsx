"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

import { readPersonal } from "./personal-client"

type Copy = { sessionId: string; matterId: string; id: string; version: number; message?: string }
type Action = { action: "sync" } | { action: "open"; matterId: string; documentId: string }
  | { action: "reopen"; matterId: string; sessionId: string }
  | { action: "finish"; matterId: string; sessionId: string; keepLocal: boolean }

function request<T>(input: Action) {
  return readPersonal<T>("/api/personal/working-copies", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
}

const Context = createContext<{ copies: Copy[]; offline: boolean; act: (input: Exclude<Action, { action: "sync" }>) => Promise<void> } | null>(null)

export function WorkingCopyProvider({ children }: { children: ReactNode }) {
  const [copies, setCopies] = useState<Copy[]>([])
  const [offline, setOffline] = useState(false)
  const pending = useRef<Promise<void> | null>(null)
  const sync = useCallback(() => {
    if (!pending.current) pending.current = request<Copy[]>({ action: "sync" })
      .then(rows => { setCopies(rows); setOffline(false) })
      .catch(() => { setOffline(true) })
      .finally(() => { pending.current = null })
    return pending.current
  }, [])

  useEffect(() => {
    void sync()
    window.addEventListener("focus", sync)
    window.addEventListener("online", sync)
    return () => { window.removeEventListener("focus", sync); window.removeEventListener("online", sync) }
  }, [sync])
  useEffect(() => {
    if (!copies.length && !offline) return
    const timer = window.setInterval(sync, offline ? 10000 : 2000)
    return () => window.clearInterval(timer)
  }, [copies.length, offline, sync])

  async function act(input: Exclude<Action, { action: "sync" }>) {
    await pending.current
    try { await request(input) } finally { await sync() }
  }
  return <Context.Provider value={{ copies, offline, act }}>{children}</Context.Provider>
}

export function useWorkingCopies() {
  const value = useContext(Context)
  if (!value) throw new Error("Working copies require a personal workspace")
  return value
}
