"use client";

/**
 * 墨案顶栏（docs/mockup/v4 .topbar）：⌘K 搜索框 / 通知 / 按页主操作 / 用户胶囊。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button } from "@douyinfe/semi-ui";
import { useWorkspaceActor } from "@/components/workspace-actor-provider";
import { Search, ChevronDown, Plus, Menu, ScanSearch } from "lucide-react";
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
    <header className="topbar ll-material">
      {onMobileMenuToggle ? (
        <Button htmlType="button" onClick={onMobileMenuToggle} theme="borderless" type="tertiary" className="md:hidden" aria-label="打开菜单" icon={<Menu size={18} />} />
      ) : null}

      <Button htmlType="button" onClick={() => setSearchOpen(true)} theme="light" type="tertiary"
        className="min-w-0" aria-label="全局搜索（⌘K）" icon={<Search size={16} />}>
        <span className="truncate">搜索案件、客户、材料正文…</span>
        <kbd className="ml-3 hidden sm:inline">⌘K</kbd>
      </Button>

      <div className="hidden flex-1 sm:block" />

      <NotificationPopover />
      {canReadMatters ? <SmsPopover /> : null}

      {/* 收案动线：先预检再建案——预检为次级按钮，与主操作同高、同圆角，靠拢成一组 */}
      {canCreateIntake || action ? (
        <div className="tb-actions">
          {canCreateIntake ? (
            <Button htmlType="button" onClick={() => router.push("/conflicts")} theme="light" type="tertiary" title="收案前查一查本所有没有相关记录" aria-label="冲突预检" icon={<ScanSearch size={18} />}><span className="hidden lg:inline">冲突预检</span></Button>
          ) : null}
          {action ? (
            <Button htmlType="button" onClick={action.onClick} disabled={action.disabled} theme="solid" aria-label={action.label} icon={<Plus size={18} />}><span className="hidden sm:inline">{action.label}</span></Button>
          ) : null}
        </div>
      ) : null}

      <WorkspaceAccountMenu position="bottomRight">
        <Button htmlType="button" theme="borderless" type="tertiary" className="ml-1 hidden sm:inline-flex" aria-label="账户菜单" icon={
          <Avatar size="extra-extra-small" src={userAvatar || undefined} alt={displayName}>{displayName.charAt(0) || "?"}</Avatar>
        }>
          {displayName || "…"}<ChevronDown size={12} className="ml-2" />
        </Button>
      </WorkspaceAccountMenu>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
