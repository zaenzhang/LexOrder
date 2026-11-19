import type { NextRequest } from "next/server"

type Context = { params: Promise<{ endpoint: string[] }> }
const headers = { "Cache-Control": "no-store" }

function loopbackUrl(value?: string) {
  if (!value) return
  const url = URL.parse(value)
  return url?.protocol === "http:" && url.hostname === "127.0.0.1" && url.port && url.href === url.origin + "/" ? url : undefined
}

async function forward(request: NextRequest, context: Context) {
  const client = loopbackUrl(process.env.LEXORDER_CHRONICLE_ORIGIN)
  const runtime = loopbackUrl(process.env.LEXORDER_PERSONAL_ORIGIN)
  if (!client || !runtime) return new Response("个人运行时尚未连接。", { status: 503, headers })
  const origin = request.headers.get("origin")
  if (request.headers.get("host") !== client.host || request.headers.get("sec-fetch-site") === "cross-site"
    || (origin && origin !== client.origin) || (request.method === "POST" && origin !== client.origin)) {
    return new Response(null, { status: 403, headers })
  }
  const token = request.cookies.get("lexorder_local_channel")?.value
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return new Response("请从个人桌面预览打开工作区。", { status: 403, headers })
  }
  const path = (await context.params).endpoint.join("/")
  const isCaseAction = path === "evidence-review" || path === "matter-workspace"
  const isDocument = /^documents\/c[a-z0-9]{24,}\/(preview|download)$/.test(path)
  if (!isCaseAction && !(isDocument && request.method === "GET")) return new Response(null, { status: 404, headers })
  const contentType = request.headers.get("content-type") ?? ""
  const multipart = request.method === "POST" && path === "matter-workspace" && contentType.startsWith("multipart/form-data;")
  if (multipart && Number(request.headers.get("content-length")) > 21 * 1024 * 1024) {
    return Response.json({ error: "材料大小不能超过 20 MB。" }, { status: 413, headers })
  }
  const url = new URL(isCaseAction ? "/api/personal/" + path : "/api/" + path, runtime)
  url.search = request.nextUrl.search
  try {
    const upstream = await fetch(url, {
      method: request.method,
      redirect: "manual",
      cache: "no-store",
      signal: request.signal,
      headers: {
        Cookie: "lexorder_local_channel=" + token,
        ...(request.method === "POST" ? { Origin: runtime.origin, "Content-Type": multipart ? contentType : "application/json" } : {}),
        ...(request.headers.get("range") ? { Range: request.headers.get("range")! } : {}),
      },
      body: request.method === "POST" ? multipart ? await request.arrayBuffer() : await request.text() : undefined,
    })
    if (upstream.status >= 300 && upstream.status < 400) return new Response(null, { status: 502, headers })
    const resultHeaders = new Headers(headers)
    for (const name of ["content-type", "content-disposition", "content-range", "accept-ranges", "content-security-policy", "x-content-type-options", "x-frame-options"]) {
      const value = upstream.headers.get(name)
      if (value) resultHeaders.set(name, value)
    }
    return new Response(upstream.body, { status: upstream.status, headers: resultHeaders })
  } catch {
    return new Response("个人运行时暂不可用。", { status: 502, headers })
  }
}

export { forward as GET, forward as POST }
