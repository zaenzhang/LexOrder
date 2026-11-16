"use client";

import { createContext, useContext, useMemo } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import type { WorkspaceActor } from "@/lib/runtime/actor";

const WorkspaceActorContext = createContext<WorkspaceActor | null>(null);

/** Server keeps NextAuth's refresh lifecycle; Personal receives its local actor directly. */
function ServerActorProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const actor = useMemo<WorkspaceActor | null>(
    () => session?.user ? { ...session.user, runtimeMode: "SERVER" } : null,
    [session]
  );
  return <WorkspaceActorContext.Provider value={actor}>{children}</WorkspaceActorContext.Provider>;
}

export function WorkspaceActorProvider({ children, personalActor }: {
  children: React.ReactNode;
  /** undefined selects Server; null means a Personal request has no valid local actor. */
  personalActor?: WorkspaceActor | null;
}) {
  if (personalActor !== undefined) {
    return <WorkspaceActorContext.Provider value={personalActor}>{children}</WorkspaceActorContext.Provider>;
  }
  return <SessionProvider><ServerActorProvider>{children}</ServerActorProvider></SessionProvider>;
}

export function useWorkspaceActor() {
  return useContext(WorkspaceActorContext);
}
