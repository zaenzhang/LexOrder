"use client";

/**
 * 工作区顶栏：⌘K 搜索框 / 通知 / 按页主操作 / 用户胶囊。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button, Layout } from "@douyinfe/semi-ui";
import { useWorkspaceActor } from "@/components/workspace-actor-provider";
import { IconChevronDown, IconMenu, IconPlus, IconScan, IconSearch } from "@douyinfe/semi-icons";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import { NotificationPopover } from "@/components/layout/notification-popover";
import { SmsPopover } from "@/components/layout/sms-popover";
import { SearchDialog } from "@/components/layout/search-dialog";
import { useTopbarActionValue } from "./topbar-action";
import { hasCustomPermission } from "@/lib/roles/catalog";

export function Topbar({ onMobileMenuToggle, userAvatar }: { onMobileMenuToggle?: () => void; userAvatar?: string | null }) {
  const user = useWorkspaceActor();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const pageAction = useTopbarActionValue();
  const personal = user?.runtimeMode === "PERSONAL";
  const displayName = user?.name || (personal ? "本机操作者" : "");

  const canCreateIntake = user ? hasCustomPermission(user as Parameters<typeof hasCustomPermission>[0], "intakes.create") : false;
  const canReadMatters = user ? hasCustomPermission(user as Parameters<typeof hasCustomPermission>[0], "matters.write") : false;
  const action = pageAction === "none" ? null : pageAction ?? (canCreateIntake ? { label: "新建收案", onClick: () => router.push("/matters?tab=intake&new=1") } : null);

  return (
    <Layout.Header className="sticky top-0 z-20 flex h-[56px] min-w-0 items-center gap-1 border-b border-[var(--semi-color-border)] bg-[var(--semi-color-bg-0)] px-2 sm:gap-2.5 sm:px-5">
      {onMobileMenuToggle ? (
        <span className="md:hidden">
          <Button htmlType="button" onClick={onMobileMenuToggle} theme="borderless" type="tertiary" aria-label="打开菜单" icon={<IconMenu aria-hidden />} />
        </span>
      ) : null}

      <Button htmlType="button" onClick={() => setSearchOpen(true)} theme="light" type="tertiary"
        className="min-w-0" aria-label="全局搜索（⌘K）" icon={<IconSearch aria-hidden />}>
        <span className="hidden truncate sm:inline">搜索案件、客户、材料</span>
        <kbd className="ml-3 hidden sm:inline">⌘K</kbd>
      </Button>

      <div className="min-w-0 flex-1" />

      <NotificationPopover />
      {canReadMatters ? <SmsPopover /> : null}

      {/* 收案动线：先预检再建案——预检为次级按钮，与主操作同高、同圆角，靠拢成一组 */}
      {canCreateIntake || action ? (
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          {canCreateIntake ? (
            <Button htmlType="button" onClick={() => router.push("/conflicts")} theme="light" type="tertiary" title="收案前查一查本所有没有相关记录" aria-label="冲突预检" icon={<IconScan aria-hidden />}><span className="hidden lg:inline">冲突预检</span></Button>
          ) : null}
          {action ? (
            <Button id="workspace-top-action" htmlType="button" onClick={action.onClick} disabled={action.disabled} theme="solid" aria-label={action.label} icon={<IconPlus aria-hidden />}><span className="hidden sm:inline">{action.label}</span></Button>
          ) : null}
        </div>
      ) : null}

      <WorkspaceAccountMenu position="bottomRight">
        <Button htmlType="button" theme="borderless" type="tertiary" className="shrink-0" aria-label="账户菜单" icon={
          <Avatar size="extra-extra-small" src={userAvatar || undefined} alt={displayName}>{displayName.charAt(0) || "?"}</Avatar>
        }>
          <span className="hidden lg:inline">{displayName || "…"}</span><IconChevronDown size="small" className="ml-2 hidden lg:block" aria-hidden />
        </Button>
      </WorkspaceAccountMenu>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </Layout.Header>
  );
}
