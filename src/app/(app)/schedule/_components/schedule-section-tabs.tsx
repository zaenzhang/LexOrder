"use client";

import { useRouter } from "next/navigation";
import { WorkspaceTabs } from "@/components/patterns/workspace-surfaces";

export function ScheduleSectionTabs({ section }: { section: "calendar" | "responsibilities" }) {
  const router = useRouter();
  return <WorkspaceTabs
    className="mb-4"
    items={[
      { key: "calendar", label: "日历与期限" },
      { key: "responsibilities", label: "事项责任与交接" }
    ]}
    value={section}
    onChange={next => router.push(next === "responsibilities" ? "/schedule?section=responsibilities" : "/schedule")}
  />;
}
