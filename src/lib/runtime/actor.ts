import type { Session } from "next-auth";
import type { RuntimeMode } from "./mode";

export type WorkspaceActor = Session["user"] & { runtimeMode: RuntimeMode };

/** Personal has an operator, not an invented account session or expiration. */
export type WorkspaceSession = { user: WorkspaceActor; expires?: string };
