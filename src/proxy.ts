import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed, personalRuntime } from "@/lib/runtime/personal-channel";
import { isPersonalWorkspaceConfigurationPath } from "@/lib/runtime/workspace-navigation";

const serverAuth = withAuth({ pages: { signIn: "/login" } });
const staticPath = (pathname: string) => pathname.startsWith("/_next/") || pathname === "/favicon.ico"
  || /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/.test(pathname);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const path = request.nextUrl.pathname;
  if (!isPersonalMode()) {
    if (path === "/login" || path.startsWith("/api/auth/") || path === "/api/auth"
      || path === "/api/health" || path.startsWith("/api/calendar/") || staticPath(path)) return NextResponse.next();
    return serverAuth(request as NextRequestWithAuth, event);
  }

  // Host/origin boundaries also apply to bootstrap and independently tokenized routes.
  const bootstrap = path === "/api/personal/open";
  const tokenRoute = request.method === "GET" && (path.startsWith("/api/calendar/") || path === "/api/desktop/file");
  if (!personalChannelAllowed(request.headers, {
    method: request.method,
    requireCookie: !(bootstrap || tokenRoute || staticPath(path)),
    bootstrap,
  })) return new NextResponse("请通过本机工作区入口打开应用", { status: 403, headers: { "Cache-Control": "no-store" } });
  if (path === "/api/auth" || path.startsWith("/api/auth/")
    || ((path === "/admin" || path.startsWith("/admin/")) && !isPersonalWorkspaceConfigurationPath(path))) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (path === "/login") return NextResponse.redirect(new URL("/", personalRuntime().origin));
  return NextResponse.next();
}

export const config = { matcher: ["/:path*"] };
