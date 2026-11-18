"use client";

/**
 * 管理后台页头（墨案 12 效果图 page-head）：面包屑「设置 › 分组 › 页面」+ 标题 + 说明 + 右侧操作。
 * 分组按标题在 adminNavigation 中反查（页面标题与导航名称保持一致），页面无需各自维护面包屑。
 */
import { Breadcrumb } from "@douyinfe/semi-ui";
import { adminNavigation } from "@/components/layout/admin-shell";
import { PageHeader } from "@/components/patterns/workspace-surfaces";
import { useWorkspaceActor } from "@/components/workspace-actor-provider";

export function AdminPageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  const group = adminNavigation.find((g) => g.label !== "概览" && g.items.some((i) => i.label === title));
  const personal = useWorkspaceActor()?.runtimeMode === "PERSONAL";
  const groupLabel = personal && group?.label === "组织与人员" ? "执业资料" : group?.label;
  return (
    <PageHeader
      className="!mb-0"
      breadcrumb={<Breadcrumb routes={["设置", ...(groupLabel ? [groupLabel] : []), title]} />}
      title={title}
      sub={sub}
      actions={actions}
    />
  );
}
