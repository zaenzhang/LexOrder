import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig, type ServerOptions } from "vite"

const devHost = "127.0.0.1"
const devPort = 5173
const devAuthority = `${devHost}:${devPort}`
const devOrigin = `http://${devAuthority}`

function workbenchServer(target: string): ServerOptions {
  const runtime = new URL(target)
  if (runtime.protocol !== "http:" || runtime.hostname !== devHost || !runtime.port
    || runtime.origin !== target || target === devOrigin) {
    throw new Error("LEXORDER_DEV_RUNTIME_ORIGIN must be a separate HTTP origin on 127.0.0.1")
  }
  return {
    host: devHost,
    port: devPort,
    strictPort: true,
    cors: false,
    proxy: {
      "^/api(?:/|[?]|$)": {
        target,
        changeOrigin: true,
        bypass(request) {
          const { host, origin } = request.headers
          const fetchSite = request.headers["sec-fetch-site"]
          if (host !== devAuthority || (origin && origin !== devOrigin)
            || fetchSite === "cross-site" || fetchSite === "same-site") return false
        },
        configure(proxy) {
          proxy.on("proxyReq", (upstream, request) => {
            if (request.headers.origin === devOrigin) upstream.setHeader("origin", target)
          })
        },
      },
    },
  }
}

export default defineConfig(({ command, isPreview, mode }) => {
  const dev = command === "serve" && !isPreview
  const target = process.env.LEXORDER_DEV_RUNTIME_ORIGIN
  return {
    base: mode === "demo" ? "/chronicle/" : command === "build" ? "/_chronicle/" : "/",
    plugins: dev ? [react()] : [],
    server: dev && target ? workbenchServer(target) : undefined,
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
  }
})
