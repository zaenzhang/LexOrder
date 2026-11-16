import type { Metadata } from "next";
import "./globals.css";
import { PRODUCT_NAME, PRODUCT_DESCRIPTION } from "@/lib/product";
import { Providers } from "@/components/providers";
import { getSession } from "@/lib/auth/session";
import { isPersonalMode } from "@/lib/runtime/mode";

// The same build can run with either trusted mode; don't prerender a Server-only provider into it.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — 律师工作台`,
  description: PRODUCT_DESCRIPTION,
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.ico"
  }
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const personalActor = isPersonalMode() ? (await getSession())?.user ?? null : undefined;
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Providers personalActor={personalActor}>{children}</Providers>
      </body>
    </html>
  );
}
