"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Tabs } from "@douyinfe/semi-ui";
import { useTopbarAction } from "@/components/layout/topbar-action";

const SECTIONS = [
  { id: "followups", label: "沟通跟进" },
  { id: "matters", label: "关联案件" },
  { id: "history", label: "客户动态" },
  { id: "profile", label: "客户资料" }
] as const;
type Section = (typeof SECTIONS)[number]["id"];
const HASH_SECTIONS = new Map<string, Section>([
  ["client-relationship-title", "followups"],
  ["client-matters-title", "matters"],
  ["client-history-title", "history"],
  ["client-profile-title", "profile"],
  ["client-contacts", "profile"]
]);
const isSection = (value: string | null | undefined): value is Section => SECTIONS.some(section => section.id === value);

export function ClientDetailTabs({
  initialTab,
  defaultTab = "followups",
  sections
}: {
  initialTab?: string;
  defaultTab?: Section;
  sections: Record<Section, ReactNode>;
}) {
  const [tab, setTab] = useState<Section>(isSection(initialTab) ? initialTab : defaultTab);
  const [anchor, setAnchor] = useState<string | null>(null);
  useTopbarAction("none", []);

  useEffect(() => {
    const syncLocation = () => {
      const url = new URL(window.location.href);
      const hash = url.hash.slice(1);
      const requested = url.searchParams.get("tab");
      setTab(HASH_SECTIONS.get(hash) ?? (isSection(requested) ? requested : defaultTab));
      setAnchor(HASH_SECTIONS.has(hash) ? hash : null);
    };
    syncLocation();
    window.addEventListener("popstate", syncLocation);
    window.addEventListener("hashchange", syncLocation);
    return () => {
      window.removeEventListener("popstate", syncLocation);
      window.removeEventListener("hashchange", syncLocation);
    };
  }, [initialTab, defaultTab]);

  useEffect(() => {
    if (!anchor || HASH_SECTIONS.get(anchor) !== tab) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(anchor);
      if (!target) return;
      target.style.scrollMarginTop = "6rem";
      target.scrollIntoView({ block: "start" });
      if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [anchor, tab]);

  function select(next: string) {
    if (!isSection(next)) return;
    setTab(next);
    setAnchor(null);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    url.hash = "";
    window.history.replaceState(null, "", url.toString());
  }

  function followSource(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin || destination.pathname !== window.location.pathname) return;
    const hash = destination.hash.slice(1);
    const section = HASH_SECTIONS.get(hash);
    if (!section) return;
    event.preventDefault();
    const url = new URL(window.location.href);
    url.searchParams.set("tab", section);
    url.hash = destination.hash;
    window.history.pushState(null, "", url.toString());
    setTab(section);
    setAnchor(hash);
  }

  return (
    <div onClickCapture={followSource}>
      <Tabs activeKey={tab} onChange={select} keepDOM lazyRender={false} tabPaneMotion={false} aria-label="客户详情分区">
        {SECTIONS.map(section => (
          <Tabs.TabPane key={section.id} itemKey={section.id} tab={section.label}>
            <div hidden={tab !== section.id} className="min-w-0">{sections[section.id]}</div>
          </Tabs.TabPane>
        ))}
      </Tabs>
    </div>
  );
}
