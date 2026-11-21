import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isPersonalMode } from "@/lib/runtime/mode";
import { PERSONAL_SKILL_MCP_PATH, personalChannelAllowed, personalRuntime } from "@/lib/runtime/personal-channel";
import { isPersonalWorkspaceConfigurationPath } from "@/lib/runtime/workspace-navigation";

const serverAuth = withAuth({ pages: { signIn: "/login" } });
const staticPath = (pathname: string) => pathname.startsWith("/_next/") || pathname === "/favicon.ico"
  || /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/.test(pathname);

let desktopHtml: string | undefined;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const path = request.nextUrl.pathname;
  if (!isPersonalMode()) {
    if (path === "/login" || path.startsWith("/api/auth/") || path === "/api/auth"
      || path === "/api/health" || path.startsWith("/api/calendar/") || staticPath(path)) return NextResponse.next();
    return serverAuth(request as NextRequestWithAuth, event);
  }

  const desktop = process.env.LEXORDER_DESKTOP_WEB === "1";
  const isPage = !path.startsWith("/api/") && path !== "/api";
  if (desktop && isPage && (request.method === "GET" || request.method === "HEAD")
    && personalChannelAllowed(request.headers, { method: request.method, requireCookie: false })) {
    if (path.startsWith("/_chronicle/") || path === "/favicon.ico") return NextResponse.next();
    desktopHtml ??= readFileSync(join(process.cwd(), "public/_chronicle/index.html"), "utf8");
    return new NextResponse(request.method === "HEAD" ? null : desktopHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // Host/origin boundaries also apply to bootstrap and independently tokenized routes.
  const bootstrap = path === "/api/personal/open";
  const skillHostRoute = path === PERSONAL_SKILL_MCP_PATH;
  const tokenRoute = request.method === "GET" && (path.startsWith("/api/calendar/") || path === "/api/desktop/file");
  if (!personalChannelAllowed(request.headers, {
    method: request.method,
    requireCookie: !(bootstrap || tokenRoute || skillHostRoute || staticPath(path)),
    allowMissingOrigin: skillHostRoute,
    bootstrap,
  })) return new NextResponse("请通过本机工作区入口打开应用", { status: 403, headers: { "Cache-Control": "no-store", ...(desktop ? { "X-Lexorder-Channel": "required" } : {}) } });
  if (desktop && request.method === "POST"
    && request.headers.get("content-type")?.startsWith("multipart/form-data;")) {
    const limit = path === "/api/personal/practice-resources" ? 51
      : ["/api/personal/matter-workspace", "/api/personal/court-inbox", "/api/personal/archive", "/api/personal/document-review", "/api/personal/material-uploads"].includes(path) ? 21 : 0;
    if (limit && Number(request.headers.get("content-length")) > limit * 1024 * 1024) {
      return NextResponse.json({ error: `文件大小不能超过 ${limit - 1} MB。` }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
  }
  if (path === "/api/auth" || path.startsWith("/api/auth/")
    || ((path === "/admin" || path.startsWith("/admin/")) && !isPersonalWorkspaceConfigurationPath(path))) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (path === "/login") return NextResponse.redirect(new URL("/", personalRuntime().origin));
  return NextResponse.next();
}

export const config = { matcher: ["/:path*"] };
