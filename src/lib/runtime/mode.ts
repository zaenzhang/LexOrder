export type RuntimeMode = "PERSONAL" | "SERVER";

/** Startup configuration only. A request never selects the application's mode. */
export function runtimeMode(): RuntimeMode {
  const mode = process.env.LEXORDER_RUNTIME_MODE ?? "SERVER";
  if (mode !== "SERVER" && mode !== "PERSONAL") throw new Error("INVALID_RUNTIME_MODE");
  return mode;
}

export function isPersonalMode(): boolean {
  return runtimeMode() === "PERSONAL";
}
