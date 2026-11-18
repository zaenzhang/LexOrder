"use client";

import "@douyinfe/semi-ui/react19-adapter";
import { ConfigProvider } from "@douyinfe/semi-ui";
import zhCN from "@douyinfe/semi-ui/lib/es/locale/source/zh_CN";
import { WorkspaceActorProvider } from "@/components/workspace-actor-provider";
import type { WorkspaceActor } from "@/lib/runtime/actor";
import { AppMotionProvider } from "@/components/patterns/app-motion-provider";
import { ConfirmHost } from "@/components/patterns/confirm-dialog";

export function Providers({ children, personalActor }: { children: React.ReactNode; personalActor?: WorkspaceActor | null }) {
  return (
    <WorkspaceActorProvider personalActor={personalActor}>
      <AppMotionProvider>
        <ConfigProvider locale={zhCN}>
          {children}
          <ConfirmHost />
        </ConfigProvider>
      </AppMotionProvider>
    </WorkspaceActorProvider>
  );
}
