/**
 * 外部调用台账卡片（服务端组件）：近 30 天调用量 / 失败率 / 平均耗时 + 最近失败。
 */
import { Table } from "@/components/patterns/semi-surfaces";
import { IconAlertTriangle as AlertTriangle } from "@douyinfe/semi-icons";
import type { ExternalCallStats } from "@/server/settings/external-call-stats";
import { formatDateTime } from "@/lib/utils";

const SERVICE_CN: Record<string, string> = {
  "ai-chat": "AI 对话（审查/草拟/解析/案由）",
  "ai-vision": "AI 视觉识别",
  yuandian: "元典开放平台",
  "sms-ai": "短信 AI 解析"
};

export function ExternalCallStatsCard({ stats }: { stats: ExternalCallStats }) {
  const failureRate = stats.totalCalls > 0 ? ((stats.totalFailures / stats.totalCalls) * 100).toFixed(1) : "0";
  return (
    <div className="card p-4">
      <div className="text-sm font-medium">外部调用台账（近 30 天）</div>
      <p className="mt-1 text-xs text-muted-foreground">
        AI 与外部服务每次调用的成败与耗时汇总（不记录请求正文）。按次计费服务的消耗可据此估算。
      </p>

      {stats.totalCalls === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">暂无调用记录——使用 AI 审查、识别或元典检索后这里会出现统计。</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-muted/40 p-2">
              <div className="font-mono text-lg tabular">{stats.totalCalls}</div>
              <div className="text-xs text-muted-foreground">总调用</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-2">
              <div className={`font-mono text-lg tabular ${stats.totalFailures > 0 ? "text-destructive" : ""}`}>{stats.totalFailures}</div>
              <div className="text-xs text-muted-foreground">失败（{failureRate}%）</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-2">
              <div className="font-mono text-lg tabular">{stats.services.length}</div>
              <div className="text-xs text-muted-foreground">服务数</div>
            </div>
          </div>

          <Table
            className="mt-3"
            pagination={false}
            rowKey="service"
            columns={[
              { title: "服务", dataIndex: "label" },
              { title: "调用", dataIndex: "calls", align: "right" },
              { title: "失败", dataIndex: "failures", align: "right" },
              { title: "平均耗时", dataIndex: "duration", align: "right" },
            ]}
            dataSource={stats.services.map(service => ({
              service: service.service,
              label: SERVICE_CN[service.service] ?? service.service,
              calls: service.calls,
              failures: <span className={service.failures > 0 ? "text-destructive" : undefined}>{service.failures}</span>,
              duration: (service.avgDurationMs / 1000).toFixed(1) + "s",
            }))}
          />

          {stats.recentFailures.length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <AlertTriangle aria-hidden size="small" className="text-destructive" />
                最近失败
              </div>
              {stats.recentFailures.map(f => (
                <div key={f.id} className="truncate text-xs text-muted-foreground">
                  <span className="font-mono">{formatDateTime(new Date(f.createdAt))}</span>
                  {" · "}{SERVICE_CN[f.service] ?? f.service}{f.action ? ` · ${f.action}` : ""} · {f.error?.slice(0, 80) ?? "未知错误"}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
