"use client";

import Link from "next/link";
import { Avatar, Button, Layout, Nav, Tag, Typography } from "@douyinfe/semi-ui";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { PRODUCT_SHORT_NAME } from "@/lib/product";
import {
  IconArchive, IconArticle, IconBox, IconBriefcaseStroked, IconCalendarClockStroked,
  IconChecklistStroked, IconChevronRight, IconExit, IconFile, IconGridStroked,
  IconLayers, IconLockStroked, IconSettingStroked, IconShieldStroked, IconUpload,
  IconUserGroup, IconUserStroked,
} from "@douyinfe/semi-icons";

import { BrandMark } from "@/components/layout/sidebar";
import type { RuntimeMode } from "@/lib/runtime/mode";
import { isPersonalWorkspaceConfigurationPath } from "@/lib/runtime/workspace-navigation";

type AdminNavItem = {
  href: string;
  label: string;
  icon: typeof IconGridStroked;
  adminOnly?: boolean;
};

export const adminNavigation: Array<{ label: string; items: AdminNavItem[] }> = [
  {
    label: "概览",
    items: [{ href: "/admin", label: "管理概览", icon: IconGridStroked }]
  },
  {
    label: "组织与人员",
    items: [
      { href: "/admin/users", label: "用户与岗位", icon: IconUserStroked, adminOnly: true },
      { href: "/admin/teams", label: "律师团队", icon: IconUserGroup, adminOnly: true },
      { href: "/admin/roles", label: "岗位角色", icon: IconLockStroked, adminOnly: true },
      { href: "/admin/approval-permissions", label: "审批权限", icon: IconShieldStroked, adminOnly: true },
      { href: "/admin/firm-profile", label: "律所信息", icon: IconBriefcaseStroked, adminOnly: true }
    ]
  },
  {
    label: "业务规则",
    items: [
      { href: "/admin/reminders", label: "期限规则库", icon: IconCalendarClockStroked },
      { href: "/admin/archive-policy", label: "归档制度", icon: IconArchive, adminOnly: true },
      { href: "/admin/document-templates", label: "文书模板", icon: IconFile, adminOnly: true },
      { href: "/admin/templates", label: "阶段模板", icon: IconLayers, adminOnly: true },
      { href: "/admin/custom-fields", label: "自定义字段", icon: IconChecklistStroked, adminOnly: true }
    ]
  },
  {
    label: "系统接入",
    items: [
      { href: "/admin/ai", label: "AI 与外部服务", icon: IconSettingStroked, adminOnly: true },
      { href: "/admin/express", label: "快递接入", icon: IconBox, adminOnly: true },
      { href: "/admin/import", label: "批量导入", icon: IconUpload }
    ]
  },
  {
    label: "安全与审计",
    items: [{ href: "/admin/audit", label: "审计日志", icon: IconArticle, adminOnly: true }]
  }
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === href : pathname.startsWith(`${href}/`) || pathname === href;
}

export function AdminShell({
  children,
  firmName,
  user,
  isSystemAdmin,
  runtimeMode = "SERVER"
}: {
  children: React.ReactNode;
  firmName: string;
  user: { name: string; roleName: string; avatar?: string | null };
  isSystemAdmin: boolean;
  runtimeMode?: RuntimeMode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const personal = runtimeMode === "PERSONAL";
  const visibleNavigation = adminNavigation
    .map((group) => ({
      ...group,
      label: personal && group.label === "组织与人员" ? "执业资料" : group.label,
      items: group.items.filter((item) => personal ? isPersonalWorkspaceConfigurationPath(item.href) : isSystemAdmin || !item.adminOnly)
    }))
    .filter((group) => group.items.length > 0);
  const initial = user.name.charAt(0) || "?";

  const items = visibleNavigation.flatMap(group => group.items);
  const selectedKeys = items.filter(item => isActive(pathname, item.href)).map(item => item.href);
  const renderItem = (item: AdminNavItem) => (
    <Nav.Item key={item.href} itemKey={item.href} link={item.href} tabIndex={-1}
      linkOptions={{
        tabIndex: 0,
        onKeyPress: event => event.stopPropagation(),
        "aria-current": isActive(pathname, item.href) ? "page" : undefined,
        onClick: event => {
          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            router.push(item.href);
          }
        },
      }}
      icon={<item.icon size="large" aria-hidden />}
      text={personal && item.href === "/admin" ? "设置概览" : item.label}
    />
  );

  return (
    <Layout className="mo-rules min-h-screen bg-[var(--semi-color-bg-0)]">
      <Layout.Header className="sticky top-0 z-20 flex h-[56px] items-center gap-3 border-b border-[var(--semi-color-border)] bg-[var(--semi-color-bg-0)] px-6">
        <IconShieldStroked aria-hidden />
        <Tag color="blue">{personal ? "工作区设置" : "系统管理模式"}</Tag>
        {!personal && <Typography.Text type="secondary" className="hidden sm:inline">当前修改影响全所规则，保存将记录审计</Typography.Text>}
        <Link href="/" className="ml-auto inline-flex items-center gap-1 text-sm text-[var(--semi-color-link)]">
          返回业务系统
          <IconChevronRight size="small" aria-hidden />
        </Link>
      </Layout.Header>

      <Layout hasSider>
        <Layout.Sider className="workspace-sider hidden md:block" aria-label="管理后台导航">
          <Nav className="workspace-nav" defaultOpenKeys={visibleNavigation.map(group => group.label)} aria-label="管理项目" selectedKeys={selectedKeys}>
            <Nav.Header link="/admin"
              logo={<BrandMark name={firmName} />}
              text={<span className="block min-w-0">
                <span className="block truncate">{personal ? "工作区设置" : `${PRODUCT_SHORT_NAME}管理后台`}</span>
                <span className="block truncate text-xs font-normal text-[var(--semi-color-text-2)]" title={firmName}>{firmName}</span>
              </span>}
            />
            {visibleNavigation.map(group => group.items.length === 1 && group.items[0].href === "/admin"
              ? renderItem(group.items[0])
              : <Nav.Sub key={group.label} itemKey={group.label} text={group.label}>
                  {group.items.map(renderItem)}
                </Nav.Sub>)}
            <Nav.Footer>
              <div className="flex w-full min-w-0 items-center gap-2">
                <Avatar size="extra-extra-small" src={user.avatar || undefined} alt={user.name}>{initial}</Avatar>
                <div className="min-w-0 flex-1">
                  <Typography.Text ellipsis={{ showTooltip: true }}>{user.name}</Typography.Text>
                  <Typography.Text type="secondary" size="small" className="block">{personal ? "个人工作区" : isSystemAdmin ? "超级管理员" : user.roleName}</Typography.Text>
                </div>
                {!personal && <Button onClick={() => void signOut({ callbackUrl: "/login" })} theme="borderless" type="tertiary" size="small" aria-label="退出登录" title="退出登录" icon={<IconExit aria-hidden />} />}
              </div>
            </Nav.Footer>
          </Nav>
        </Layout.Sider>

        <Layout.Content className="min-w-0" style={{ overflow: "visible" }}>
          <div className="overflow-x-auto border-b border-[var(--semi-color-border)] md:hidden">
            <Nav mode="horizontal" aria-label="移动端管理后台导航" selectedKeys={selectedKeys}>{items.map(renderItem)}</Nav>
          </div>
          <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-6 sm:px-6">{children}</main>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
