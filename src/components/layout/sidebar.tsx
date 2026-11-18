"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, Button, Dropdown, Layout, Nav, Tag } from "@douyinfe/semi-ui";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspaceActor } from "@/components/workspace-actor-provider";
import { PRODUCT_SHORT_NAME } from "@/lib/product";
import { IconApps, IconChevronUpDown } from "@douyinfe/semi-icons";
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
    <Layout.Sider className="workspace-sider hidden md:block" aria-label="工作区导航">
      <NavContent firm={firm} onOpenTools={onOpenTools} />
    </Layout.Sider>
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
export function NavContent({ firm, onOpenTools, onNavigate }: { firm: FirmBrand; onOpenTools?: () => void; onNavigate?: () => void }) {
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
  function followLink(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate?.();
    router.push(href);
  }

  return (
    <Nav className="workspace-nav" aria-label="业务导航"
      selectedKeys={navList.filter(item => isActive(pathname, item.href)).map(item => item.href)}>
      <Nav.Header link="/" linkOptions={{ "aria-label": "返回工作台", onClick: event => followLink(event, "/") }}
        logo={<BrandMark logoDataUrl={firm.logoDataUrl} name={firm.name} />}
        text={<span className="block min-w-0">
          <span className="block truncate" title={firm.name}>{firm.name}</span>
          <span className="block truncate text-xs font-normal text-[var(--semi-color-text-2)]">{firm.subtitle || PRODUCT_SHORT_NAME}</span>
        </span>}
      />
      {navList.map(item => {
        const count = countOf(item);
        return <Nav.Item key={item.href} itemKey={item.href} link={item.href} tabIndex={-1}
          linkOptions={{
            tabIndex: 0,
            onKeyPress: event => event.stopPropagation(),
            "aria-current": isActive(pathname, item.href) ? "page" : undefined,
            onClick: event => followLink(event, item.href),
          }} icon={<item.icon size="large" aria-hidden />} text={
            <span className="flex w-full items-center justify-between gap-2"><span>{item.label}</span>
              {count ? <Tag size="small" color={count.alert ? "red" : "grey"}>{count.n > 99 ? "99+" : count.n}</Tag> : null}
            </span>
          } />;
      })}
      <Nav.Footer>
        <div className="grid w-full min-w-0 gap-2">
          <div ref={moreTrigger}>
            <Dropdown trigger="click" position={onNavigate ? "topLeft" : "rightBottom"} visible={moreOpen} onVisibleChange={setMoreOpen} onEscKeyDown={() => setMoreOpen(false)} motion={false} render={
              <Dropdown.Menu>
                {APP_ITEMS.map(item => <Dropdown.Item key={item.label} active={item.kind === "link" && Boolean(item.href && isActive(pathname, item.href))} icon={<item.icon aria-hidden />} onClick={() => {
                  setMoreOpen(false);
                  onNavigate?.();
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
                type="tertiary" style={{ justifyContent: "flex-start" }} icon={<IconApps aria-hidden />}>更多应用</Button>
            </Dropdown>
          </div>
          <WorkspaceAccountMenu position="topLeft">
            <Button htmlType="button" block theme="borderless" type="tertiary" aria-label="侧栏账户菜单" style={{ height: "auto", padding: 8, justifyContent: "flex-start" }}
              icon={<Avatar size="extra-extra-small">{displayName.charAt(0) || "?"}</Avatar>}>
              <span className="flex min-w-0 flex-col items-start px-2">
                <span className="max-w-[120px] truncate">{displayName || "…"}</span>
                <span className="max-w-[120px] truncate text-xs text-[var(--semi-color-text-2)]">{[roleLabel, systemLabel].filter(Boolean).join(" · ")}</span>
              </span>
              <IconChevronUpDown size="small" aria-hidden />
            </Button>
          </WorkspaceAccountMenu>
        </div>
      </Nav.Footer>
    </Nav>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
