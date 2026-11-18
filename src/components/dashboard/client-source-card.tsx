import Link from "next/link";
import { Card, Empty, Progress } from "@/components/patterns/semi-surfaces";

export function ClientSourceCard({ rows }: { rows: { source: string; count: number }[] }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <Card title="客户来源渠道分布" headerExtraContent={<span className="text-xs text-[var(--semi-color-text-2)]">近 12 个月 · 新收 {total}</span>}>
      {total === 0 ? (
        <Empty description="暂无新建客户" title="客户来源" />
      ) : (
        <div className="grid gap-3">
          {rows.slice(0, 5).map((row) => {
            const percent = (row.count / total) * 100;
            return (
              <div key={row.source} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-3 text-xs">
                <span className="truncate" title={row.source}>{row.source}</span>
                <Progress percent={percent} aria-label={row.source} />
                <span className="tabular-nums text-[var(--semi-color-text-2)]">{row.count} · {Math.round(percent)}%</span>
              </div>
            );
          })}
          <Link href="/reports" className="text-xs text-[var(--semi-color-primary)]">查看所级来源报表</Link>
        </div>
      )}
    </Card>
  );
}
