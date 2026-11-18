"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Tabs } from "@douyinfe/semi-ui";

const SECTIONS = [
  { id: "models", label: "模型" },
  { id: "ocr", label: "OCR" },
  { id: "database", label: "法律数据库" },
  { id: "mcp", label: "MCP" },
  { id: "calls", label: "调用记录" }
] as const;
type Section = (typeof SECTIONS)[number]["id"];
const isSection = (value: string | null | undefined): value is Section => SECTIONS.some(section => section.id === value);

export function SettingsTabs({ initialTab, sections }: { initialTab?: string; sections: Record<Section, ReactNode> }) {
  const [tab, setTab] = useState<Section>(isSection(initialTab) ? initialTab : "models");

  useEffect(() => {
    const syncLocation = () => {
      const requested = new URL(window.location.href).searchParams.get("tab");
      setTab(isSection(requested) ? requested : "models");
    };
    syncLocation();
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, [initialTab]);

  function select(next: string) {
    if (!isSection(next)) return;
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    url.hash = "";
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <section aria-label="服务配置分区">
      <Tabs activeKey={tab} onChange={select} keepDOM tabPaneMotion={false} contentStyle={{ paddingTop: 16 }}>
        {SECTIONS.map(section => (
          <Tabs.TabPane key={section.id} itemKey={section.id} tab={section.label}>
            <div hidden={tab !== section.id} className="min-w-0">{sections[section.id]}</div>
          </Tabs.TabPane>
        ))}
      </Tabs>
    </section>
  );
}
