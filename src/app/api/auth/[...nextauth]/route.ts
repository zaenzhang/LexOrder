import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { isPersonalMode } from "@/lib/runtime/mode";

const authHandler = NextAuth(authOptions);
const handler = (...args: unknown[]) => isPersonalMode()
  ? new Response("Not found", { status: 404 }) : authHandler(...args);

export { handler as GET, handler as POST };
