"use client";

import { Layout } from "@douyinfe/semi-ui";
import { useState } from "react";
import { Sidebar, type FirmBrand } from "./sidebar";
import { Topbar } from "./topbar";
import { MobileNav } from "./mobile-nav";
import { ToolsDialog } from "./tools-dialog";
import { TopbarActionProvider } from "./topbar-action";

export function AppShell({
  children,
  banner,
  firm,
  userAvatar
}: {
  children: React.ReactNode;
  /** v0.27: 顶部公告 banner（服务端渲染好后注入） */
  banner?: React.ReactNode;
  /** v0.42 项1: 侧栏品牌（律所名 / 副标题 / Logo） */
  firm: FirmBrand;
  /** v0.43: 当前用户头像（服务端读最新，供顶栏显示） */
  userAvatar?: string | null;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <TopbarActionProvider>
      <Layout className="min-h-screen bg-[var(--workspace-background,var(--semi-color-bg-0))]">
        <Topbar onMobileMenuToggle={() => setMobileNavOpen(true)} userAvatar={userAvatar ?? null} />
        <Layout hasSider>
          <Sidebar firm={firm} onOpenTools={() => setToolsOpen(true)} />
          <Layout.Content className="min-w-0" style={{ overflow: "visible" }}>
            {banner}
            <div className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-6 sm:px-8">{children}</div>
          </Layout.Content>
        </Layout>
        <MobileNav open={mobileNavOpen} onOpenChange={setMobileNavOpen} firm={firm} onOpenTools={() => setToolsOpen(true)} />
        <ToolsDialog open={toolsOpen} onOpenChange={setToolsOpen} />
      </Layout>
    </TopbarActionProvider>
  );
}
