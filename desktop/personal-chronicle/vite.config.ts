import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

export default defineConfig(({ command, mode }) => ({
  base: mode === "demo" ? "/chronicle/" : command === "build" ? "/_chronicle/" : "/",
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  build: {
    target: ["chrome107", "firefox104", "safari16"],
    rolldownOptions: {
      onLog(level, log, handler) {
        // React server-component markers in upstream UI packages have no role in this SPA.
        if (!(log.code === "MODULE_LEVEL_DIRECTIVE" && log.message.includes('"use client"'))) handler(level, log)
      },
    },
  },
}))
