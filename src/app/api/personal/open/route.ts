import { NextResponse } from "next/server";
import { isPersonalMode } from "@/lib/runtime/mode";
import { PERSONAL_CHANNEL_COOKIE, personalChannelAllowed, personalRuntime, validPersonalToken } from "@/lib/runtime/personal-channel";

/** A launcher bootstrap for a private local channel, never a login or actor choice. */
export function GET(request: Request) {
  if (!isPersonalMode()) return new Response("Not found", { status: 404 });
  const runtime = personalRuntime();
  const url = new URL(request.url);
  if (!personalChannelAllowed(request.headers, { requireCookie: false, bootstrap: true })
    || url.searchParams.getAll("token").length !== 1 || !validPersonalToken(url.searchParams.get("token"), runtime)) {
    return new Response("本机工作区入口已失效，请重新打开", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const response = NextResponse.redirect(new URL("/", runtime.origin), 303);
  response.cookies.set(PERSONAL_CHANNEL_COOKIE, runtime.token, { httpOnly: true, sameSite: "strict", path: "/", secure: false });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
