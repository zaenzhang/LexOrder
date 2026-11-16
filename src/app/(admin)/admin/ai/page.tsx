import { getAiSettingsPublic } from "@/server/settings/ai-actions";
import { getOcrSettingsPublic } from "@/server/settings/ocr-actions";
import { OcrSettingsForm } from "./_components/ocr-settings-form";
import { getYuandianSettingsPublic } from "@/server/settings/yuandian-actions";
import { AI_DEFAULTS } from "@/lib/ai/settings";
import { YUANDIAN_DEFAULTS } from "@/lib/yuandian/settings";
import { AiSettingsForm } from "./_components/ai-settings-form";
import { YuandianSettingsForm } from "./_components/yuandian-settings-form";
import { getExternalCallStats } from "@/server/settings/external-call-stats";
import { ExternalCallStatsCard } from "./_components/external-call-stats-card";
import { AdminPageHeader } from "@/components/layout/admin-page-header";
import { requireWorkspaceConfiguration } from "@/lib/auth/session";
import { getLegalMcpSettingsPublic } from "@/server/legal/mcp-actions";
import { LegalMcpSettingsForm } from "./_components/legal-mcp-settings-form";

function SettingsFailure({ name }: { name: string }) {
  return <section role="alert" className="ll-surface rounded-lg border border-border p-5"><h2 className="text-sm font-semibold">{name}</h2><p className="mt-2 text-sm text-destructive">此项配置暂时无法读取，请刷新后重试；其他服务可继续单独配置。</p></section>;
}

export default async function AiSettingsPage() {
  // Authorize before isolating failures, so redirects/denials cannot become a public settings page.
  await requireWorkspaceConfiguration();
  const [ai, yuandian, callStats, ocr, mcp] = await Promise.allSettled([
    getAiSettingsPublic(),
    getYuandianSettingsPublic(),
    getExternalCallStats(),
    getOcrSettingsPublic(),
    getLegalMcpSettingsPublic()
  ]);
  return (
    <div className="space-y-5">
      <AdminPageHeader title="AI 与外部服务" sub="各服务按需配置；未配置或暂时不可用，不影响登录、材料保存和普通业务。" />
      {ai.status === "fulfilled" ? <AiSettingsForm key={JSON.stringify(ai.value)} initial={ai.value} defaults={AI_DEFAULTS} /> : <SettingsFailure name="AI 接入" />}
      {ocr.status === "fulfilled" ? <OcrSettingsForm key={JSON.stringify(ocr.value)} initial={ocr.value} /> : <SettingsFailure name="OCR 网关" />}
      {mcp.status === "fulfilled" ? <LegalMcpSettingsForm initial={mcp.value} /> : <SettingsFailure name="法律 MCP" />}
      {yuandian.status === "fulfilled" ? <YuandianSettingsForm key={JSON.stringify(yuandian.value)} initial={yuandian.value} defaults={YUANDIAN_DEFAULTS} /> : <SettingsFailure name="元典案例库 API" />}
      <section className="ll-surface rounded-lg border border-border p-5"><div className="flex flex-wrap items-center gap-3"><h2 className="text-sm font-semibold">RAGFlow（可选）</h2><span className="text-xs text-muted-foreground">工作台配置接入待完成 · 未验证</span></div><p className="mt-2 text-xs text-muted-foreground">当前使用内置材料处理与 PostgreSQL 正文检索。RAGFlow 适配器尚未连接本页的持久配置，不是系统启动或本阶段业务验收的前置条件。</p></section>
      {callStats.status === "fulfilled" ? <ExternalCallStatsCard stats={callStats.value} /> : <SettingsFailure name="外部调用统计" />}
    </div>
  );
}
