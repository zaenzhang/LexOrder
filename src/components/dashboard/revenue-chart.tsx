"use client";

import { Card, Empty } from "@douyinfe/semi-ui";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { IconActivity as LineChartIcon } from "@douyinfe/semi-icons";

export function RevenueChart({ data, height = 196 }: { data: { month: string; received: number; receivable: number }[]; height?: number }) {
  const empty = data.every((d) => !d.received && !d.receivable);
  return (
    <Card
      title={<h2 className="flex items-center gap-2"><LineChartIcon size="default" aria-hidden />近 6 个月实收与应收</h2>}
      headerExtraContent={!empty ? <span className="whitespace-nowrap text-xs text-[var(--semi-color-text-2)]">实收 / 应收</span> : undefined}
      className="h-full min-w-0"
    >
      <div style={{ minHeight: height }}>
        {empty ? (
          <Empty title="近 6 个月暂无收付记录" description="登记应收与到账后，这里显示实收与应收趋势。" />
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="mo-fill-teal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--semi-color-primary)" stopOpacity={0.16} />
                  <stop offset="100%" stopColor="var(--semi-color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--semi-color-border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "var(--semi-color-text-2)", fontSize: 10.5, fontFamily: "SF Mono, ui-monospace, monospace" }} axisLine={false} tickLine={false} dy={6} />
              <YAxis tick={{ fill: "var(--semi-color-text-2)", fontSize: 10.5, fontFamily: "SF Mono, ui-monospace, monospace" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 1000)}K` : String(v))} />
              <Tooltip
                contentStyle={{ background: "var(--semi-color-bg-2)", border: "1px solid var(--semi-color-border)", borderRadius: 10, fontSize: 12, boxShadow: "0 12px 32px -8px rgba(12,25,39,0.16)" }}
                formatter={(v) => `¥${Number(v).toLocaleString("zh-CN")}`}
              />
              <Area type="linear" dataKey="receivable" name="应收" stroke="var(--semi-color-text-2)" strokeWidth={1.4} strokeDasharray="4 4" fill="none" />
              <Area type="linear" dataKey="received" name="实收" stroke="var(--semi-color-primary)" strokeWidth={2.2} fill="url(#mo-fill-teal)" dot={false} activeDot={{ r: 4, fill: "var(--semi-color-primary)" }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
