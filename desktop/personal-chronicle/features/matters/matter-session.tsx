"use client"

import { createContext, useContext, useRef, type ReactNode, type RefObject } from "react"

import { WorkingCopyProvider } from "./working-copies"

const PinnedSourcesContext = createContext<RefObject<Map<string, string[]>> | null>(null)

export function MatterSessionProvider({ children }: { children: ReactNode }) {
  const pinnedSources = useRef(new Map<string, string[]>())
  return <PinnedSourcesContext.Provider value={pinnedSources}><WorkingCopyProvider>{children}</WorkingCopyProvider></PinnedSourcesContext.Provider>
}

export function usePinnedSources() {
  const pinnedSources = useContext(PinnedSourcesContext)
  if (!pinnedSources) throw new Error("Evidence review requires a matter session")
  return pinnedSources
}
