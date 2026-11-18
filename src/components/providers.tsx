"use client";

import "@douyinfe/semi-ui/react19-adapter";
import { ConfigProvider } from "@douyinfe/semi-ui";
import zhCN from "@douyinfe/semi-ui/lib/es/locale/source/zh_CN";
import { WorkspaceActorProvider } from "@/components/workspace-actor-provider";
import type { WorkspaceActor } from "@/lib/runtime/actor";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppMotionProvider } from "@/components/patterns/app-motion-provider";
import { ConfirmHost } from "@/components/patterns/confirm-dialog";

export function Providers({ children, personalActor }: { children: React.ReactNode; personalActor?: WorkspaceActor | null }) {
  return (
    <WorkspaceActorProvider personalActor={personalActor}>
      <AppMotionProvider>
        <ConfigProvider locale={zhCN}>
          {/* 首次悬停延迟 300ms，相邻提示可在前一个关闭后 200ms 内立即打开。 */}
          <TooltipProvider delayDuration={300} skipDelayDuration={200}>
            {children}
          </TooltipProvider>
          <Toaster />
          <ConfirmHost />
        </ConfigProvider>
      </AppMotionProvider>
    </WorkspaceActorProvider>
  );
}
