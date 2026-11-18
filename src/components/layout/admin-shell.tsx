"use client";

import Link from "next/link";
import { Avatar, Button, Nav, Tag } from "@douyinfe/semi-ui";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Archive,
  Bot,
  Building2,
  ChevronRight,
  Clock3,
  FileUp,
  KeyRound,
  Layers,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Package,
  ScrollText,
  ShieldCheck,
  Users,
  UsersRound,
  FileText
} from "lucide-react";

import { BrandMark } from "@/components/layout/sidebar";
import { cn } from "@/lib/utils";
import type { RuntimeMode } from "@/lib/runtime/mode";
import { isPersonalWorkspaceConfigurationPath } from "@/lib/runtime/workspace-navigation";

type AdminNavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
};

export const adminNavigation: Array<{ label: string; items: AdminNavItem[] }> = [
  {
    label: "概览",
    items: [{ href: "/admin", label: "管理概览", icon: LayoutDashboard }]
  },
  {
    label: "组织与人员",
    items: [
      { href: "/admin/users", label: "用户与岗位", icon: Users, adminOnly: true },
      { href: "/admin/teams", label: "律师团队", icon: UsersRound, adminOnly: true },
      { href: "/admin/roles", label: "岗位角色", icon: KeyRound, adminOnly: true },
      { href: "/admin/approval-permissions", label: "审批权限", icon: ShieldCheck, adminOnly: true },
      { href: "/admin/firm-profile", label: "律所信息", icon: Building2, adminOnly: true }
    ]
  },
  {
    label: "业务规则",
    items: [
      { href: "/admin/reminders", label: "期限规则库", icon: Clock3 },
      { href: "/admin/archive-policy", label: "归档制度", icon: Archive, adminOnly: true },
      { href: "/admin/document-templates", label: "文书模板", icon: FileText, adminOnly: true },
      { href: "/admin/templates", label: "阶段模板", icon: Layers, adminOnly: true },
      { href: "/admin/custom-fields", label: "自定义字段", icon: ListChecks, adminOnly: true }
    ]
  },
  {
    label: "系统接入",
    items: [
      { href: "/admin/ai", label: "AI 与外部服务", icon: Bot, adminOnly: true },
      { href: "/admin/express", label: "快递接入", icon: Package, adminOnly: true },
      { href: "/admin/import", label: "批量导入", icon: FileUp }
    ]
  },
  {
    label: "安全与审计",
    items: [{ href: "/admin/audit", label: "审计日志", icon: ScrollText, adminOnly: true }]
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

  return (
    // 墨案 12 效果图：管理壳沿用业务侧栏形态 + 顶部深墨「系统管理模式」横幅
    <div className="mo-rules min-h-screen bg-[var(--bg-canvas)]">
      <aside className="sidebar fixed left-0 top-0 z-30 hidden w-[228px] md:flex" aria-label="管理后台导航">
        <div className="flex h-full w-full flex-col">
          <Link href="/admin" className="brand no-underline hover:bg-[var(--bg-hover)]">
            <BrandMark name={firmName} />
            <div className="min-w-0">
              <div className="brand-name truncate text-[var(--t-primary)]">{personal ? "工作区设置" : "律序管理后台"}</div>
              <div className="brand-sub truncate">{personal ? firmName : `${firmName} · 组织 · 规则 · 接入 · 安全`}</div>
            </div>
          </Link>
          <Nav defaultOpenKeys={visibleNavigation.map(group => group.label)} aria-label="管理项目" style={{ width: "100%", flex: 1, minHeight: 0, overflowY: "auto" }} selectedKeys={visibleNavigation.flatMap(group => group.items).filter(item => isActive(pathname, item.href)).map(item => item.href)}>
            {visibleNavigation.map(group => <Nav.Sub key={group.label} itemKey={group.label} text={group.label}>
              {group.items.map(item => <Nav.Item key={item.href} itemKey={item.href} link={item.href} tabIndex={-1}
                linkOptions={{ tabIndex: 0, onKeyPress: event => event.stopPropagation(), "aria-current": isActive(pathname, item.href) ? "page" : undefined,
                  onClick: event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); router.push(item.href); } }
                }} icon={<item.icon size={18} />} text={personal && item.href === "/admin" ? "设置概览" : item.label} />)}
            </Nav.Sub>)}
          </Nav>
          <div className="nav-bottom">
            <div className="user-card">
              <Avatar size="extra-extra-small" src={user.avatar || undefined} alt={user.name}>{initial}</Avatar>
              <div className="user-meta">
                <div className="user-name truncate">{user.name}</div>
                <div className="user-role truncate">{personal ? "个人工作区" : `${isSystemAdmin ? "超级管理员" : user.roleName} · 系统管理模式`}</div>
              </div>
              {!personal && <Button htmlType="button" onClick={() => void signOut({ callbackUrl: "/login" })} theme="borderless" type="tertiary" size="small" aria-label="退出登录" title="退出登录" icon={<LogOut size={16} />} />}
            </div>
          </div>
        </div>
      </aside>

      <div className="md:pl-[228px]">
        <div className="admin-strip sticky top-0 z-20">
          <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <Tag>{personal ? "工作区设置" : "系统管理模式"}</Tag>
          {!personal && <span className="hidden truncate sm:inline" style={{ color: "rgba(255,255,255,0.55)" }}>当前修改影响全所规则，保存将记录审计</span>}
          <Link href="/" className="back no-underline">
            返回业务系统
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-[var(--bd-hair)] bg-card px-3 py-2 md:hidden" aria-label="移动端管理后台导航">
          {visibleNavigation.flatMap((group) => group.items).map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("nav-item h-8 shrink-0 no-underline", active && "active")}>
                <item.icon className="ic" />
                {personal && item.href === "/admin" ? "设置概览" : item.label}
              </Link>
            );
          })}
        </nav>

        <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
