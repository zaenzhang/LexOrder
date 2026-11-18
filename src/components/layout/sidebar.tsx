"use client";

/**
 * 墨案侧栏（docs/mockup/v4 02–10 页 .sidebar）：
 * 品牌（律所名 + LexOrder）/ 工作区·业务·知识·资料 四段导航（带计数）/ 底部用户卡。
 * 计数经 getNavCounts 按当前账号权限异步获取，失败不显示；路由切换后刷新。
 */
import { useEffect, useRef, useState } from "react";
import { Avatar, Button, Dropdown, Nav, Tag } from "@douyinfe/semi-ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspaceActor } from "@/components/workspace-actor-provider";
import { ChevronsUpDown, LayoutGrid } from "lucide-react";
import { customOrLegacy, hasCustomPermission, roleDisplayName, type PermissionKey } from "@/lib/roles/catalog";
import { getNavCounts, type NavCounts } from "@/server/layout/nav-counts";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import { primaryNav, APP_ITEMS, type NavItem } from "./nav-config";

/** v0.42 项1: 侧栏品牌（可在管理后台 → 律所信息配置） */
export type FirmBrand = {
  name: string;
  subtitle: string;
  logoDataUrl: string | null;
};

const PERMISSION_BY_HREF: Record<string, PermissionKey> = {
  "/matters": "matters.read",
  "/intakes": "matters.read",
  "/clients": "clients.read",
  "/finance": "finance.read",
  "/archive": "archive.read",
  "/reports": "reports.read",
  "/inbox": "matters.read"
};

/** 桌面侧边栏（md 以上显示） */
export function Sidebar({ firm, onOpenTools }: { firm: FirmBrand; onOpenTools?: () => void }) {
  return (
    <aside className="sidebar fixed left-0 top-0 z-30 hidden w-[228px] md:flex">
      <NavContent firm={firm} onOpenTools={onOpenTools} />
    </aside>
  );
}

export function BrandMark({ logoDataUrl, name, size = 30 }: { logoDataUrl?: string | null; name: string; size?: number }) {
  if (logoDataUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoDataUrl} alt={name} className="shrink-0 rounded-lg object-contain" style={{ width: size, height: size }} />;
  }
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.53} height={size * 0.53} viewBox="0 0 16 16" fill="none">
        <rect x="3" y="2.6" width="2.7" height="10.8" rx="1.1" fill="#fff" />
        <rect x="8.4" y="2.6" width="2.7" height="10.8" rx="1.1" fill="#fff" />
        <rect x="3" y="6.8" width="8.1" height="2.4" rx="1.1" fill="#00A6A6" />
      </svg>
    </span>
  );
}

/** 导航内容 — 桌面侧边栏和移动 Sheet 共用 */
export function NavContent({ firm, onOpenTools }: { firm: FirmBrand; onOpenTools?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const moreTrigger = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const user = useWorkspaceActor();
  const personal = user?.runtimeMode === "PERSONAL";
  const [counts, setCounts] = useState<NavCounts | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    getNavCounts()
      .then((c) => alive && setCounts(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user, pathname]);

  const visible = (item: NavItem) => {
    if (!PERMISSION_BY_HREF[item.href]) return true;
    if (!user) return false;
    // 报表页按页面同口径判定（内置岗位仅主任律师可进入），避免入口可见但点进去被重定向回工作台
    if (item.href === "/reports") return personal || customOrLegacy(user, "reports.read", user.role === "PRINCIPAL_LAWYER" || user.managerAuthorized === true);
    return hasCustomPermission(user, PERMISSION_BY_HREF[item.href]);
  };
  const countOf = (item: NavItem): { n: number; alert?: boolean } | null => {
    if (!counts || !item.countKey) return null;
    const n = counts[item.countKey];
    if (n === null || n === undefined || n === 0) return null;
    return { n, alert: item.countKey === "approvals" };
  };

  const displayName = user?.name || (personal ? "本机操作者" : "");
  const roleLabel = personal ? "个人工作区" : user?.role ? roleDisplayName(user) : "";
  const systemLabel = !personal && user?.systemRole === "SUPER_ADMIN" ? "超级管理员" : "";

  const navList = primaryNav.filter(visible);

  return (
    <div className="flex h-full w-full flex-col">
      <Link href="/" className="brand no-underline hover:bg-[var(--bg-hover)]" aria-label="返回工作台">
        <BrandMark logoDataUrl={firm.logoDataUrl} name={firm.name} />
        <div className="min-w-0">
          <div className="brand-name truncate text-[var(--t-primary)]">{firm.name}</div>
          <div className="brand-sub truncate">{firm.subtitle || "律序律师工作台"}</div>
        </div>
      </Link>

      <Nav aria-label="业务导航" style={{ width: "100%", flex: 1, minHeight: 0, overflowY: "auto" }}
        selectedKeys={navList.filter(item => isActive(pathname, item.href)).map(item => item.href)}>
        {navList.map(item => {
          const count = countOf(item);
          return <Nav.Item key={item.href} itemKey={item.href} link={item.href} tabIndex={-1}
            linkOptions={{
              tabIndex: 0,
              onKeyPress: event => event.stopPropagation(),
              "aria-current": isActive(pathname, item.href) ? "page" : undefined,
              onClick: event => {
                if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                  event.preventDefault(); router.push(item.href);
                }
              }
            }} icon={<item.icon size={18} />} text={
              <span className="flex w-full items-center justify-between gap-2"><span>{item.label}</span>
                {count ? <Tag size="small" color={count.alert ? "red" : "grey"}>{count.n > 99 ? "99+" : count.n}</Tag> : null}
              </span>
            } />;
        })}
      </Nav>
      <div className="p-3" ref={moreTrigger}>
        <Dropdown trigger="click" position="rightBottom" visible={moreOpen} onVisibleChange={setMoreOpen} onEscKeyDown={() => setMoreOpen(false)} motion={false} render={
          <Dropdown.Menu>
            {APP_ITEMS.map(item => <Dropdown.Item key={item.label} active={item.kind === "link" && Boolean(item.href && isActive(pathname, item.href))} icon={<item.icon size={16} />} onClick={() => {
              setMoreOpen(false);
              if (item.kind === "tools") {
                moreTrigger.current?.querySelector("button")?.focus();
                onOpenTools?.();
              } else if (item.kind === "external") {
                window.open(item.href, "_blank", "noopener,noreferrer");
              } else if (item.href) router.push(item.href);
            }}>{item.label}</Dropdown.Item>)}
          </Dropdown.Menu>
        }>
          <Button htmlType="button" block theme={APP_ITEMS.some(item => item.kind === "link" && item.href && isActive(pathname, item.href)) ? "light" : "borderless"}
            type="tertiary" icon={<LayoutGrid size={18} />}>更多应用</Button>
        </Dropdown>
      </div>

      <div className="p-3 pt-0">
        <WorkspaceAccountMenu position="topLeft">
          <Button htmlType="button" block theme="borderless" type="tertiary" aria-label="侧栏账户菜单" style={{ height: "auto", padding: 8 }}
            icon={<Avatar size="extra-extra-small">{displayName.charAt(0) || "?"}</Avatar>}>
            <span className="flex min-w-0 flex-col items-start px-2">
              <span className="max-w-[120px] truncate">{displayName || "…"}</span>
              <span className="max-w-[120px] truncate text-xs text-[var(--semi-color-text-2)]">{[roleLabel, systemLabel].filter(Boolean).join(" · ")}</span>
            </span>
            <ChevronsUpDown size={14} />
          </Button>
        </WorkspaceAccountMenu>
      </div>
    </div>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
