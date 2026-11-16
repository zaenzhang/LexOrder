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
import { SettingsTabs } from "./_components/settings-tabs";

function SettingsFailure({ name }: { name: string }) {
  return <section role="alert" className="ll-surface rounded-lg border border-border p-5"><h2 className="text-sm font-semibold">{name}</h2><p className="mt-2 text-sm text-destructive">此项配置暂时无法读取，请刷新后重试；其他服务可继续单独配置。</p></section>;
}

export default async function AiSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  // Authorize before isolating failures, so redirects/denials cannot become a public settings page.
  await requireWorkspaceConfiguration();
  const query = await searchParams;
  const [ai, yuandian, callStats, ocr, mcp] = await Promise.allSettled([
    getAiSettingsPublic(),
    getYuandianSettingsPublic(),
    getExternalCallStats(),
    getOcrSettingsPublic(),
    getLegalMcpSettingsPublic()
  ]);
  return (
    <div className="space-y-5">
      <AdminPageHeader title="AI 与外部服务" sub="按需配置；未配置或连接失败，不影响普通业务。" />
      <SettingsTabs initialTab={typeof query.tab === "string" ? query.tab : undefined} sections={{
        models: ai.status === "fulfilled" ? <AiSettingsForm key={JSON.stringify(ai.value)} initial={ai.value} defaults={AI_DEFAULTS} /> : <SettingsFailure name="AI 接入" />,
        ocr: ocr.status === "fulfilled" ? <OcrSettingsForm key={JSON.stringify(ocr.value)} initial={ocr.value} /> : <SettingsFailure name="OCR 网关" />,
        database: yuandian.status === "fulfilled" ? <YuandianSettingsForm key={JSON.stringify(yuandian.value)} initial={yuandian.value} defaults={YUANDIAN_DEFAULTS} /> : <SettingsFailure name="元典案例库 API" />,
        mcp: mcp.status === "fulfilled" ? <LegalMcpSettingsForm initial={mcp.value} /> : <SettingsFailure name="法律 MCP" />,
        calls: callStats.status === "fulfilled" ? <ExternalCallStatsCard stats={callStats.value} /> : <SettingsFailure name="外部调用统计" />
      }} />
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">RAGFlow</summary><p className="mt-2">本页暂不支持配置 RAGFlow。内置材料处理与检索可正常使用。</p></details>
    </div>
  );
}
