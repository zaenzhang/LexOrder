import type { Metadata } from "next";
import "./globals.css";
import { PRODUCT_NAME, PRODUCT_DESCRIPTION } from "@/lib/product";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — 律师工作台`,
  description: PRODUCT_DESCRIPTION,
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.ico"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
