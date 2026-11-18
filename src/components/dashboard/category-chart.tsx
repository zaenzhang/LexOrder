import { Card, Empty } from "@/components/patterns/semi-surfaces";
type CategoryItem = { name: string; value: number; code: string; color: string };

const PALETTE = ["#007B7F", "#1E56C8", "#8A6B3E", "#96650B", "#6C3FC5", "#4A5560", "#1A7F45", "#B4BFB9"];

export function CategoryChart({ data }: { data: CategoryItem[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const C = 2 * Math.PI * 44;
  const segments = data.map((d, i) => {
    const len = total ? (d.value / total) * C : 0;
    const start = data.slice(0, i).reduce((s, x) => s + (total ? (x.value / total) * C : 0), 0);
    return { ...d, len, start };
  });
  return (
    <Card title="案件类型分布" headerExtraContent={<span className="text-xs text-[var(--semi-color-text-2)]">在办 {total} 件</span>}>
      {total === 0 ? (
        <Empty description="暂无在办案件" />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="92" height="92" viewBox="0 0 120 120" style={{ flexShrink: 0 }} role="img" aria-label={`在办 ${total} 件`}>
            <circle cx="60" cy="60" r="44" fill="none" stroke="var(--semi-color-fill-0)" strokeWidth="13" />
            {segments.map((d, i) => (
              <circle key={d.code} cx="60" cy="60" r="44" fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="13" strokeDasharray={`${Math.max(0, d.len - 1)} ${C}`} strokeDashoffset={-d.start} transform="rotate(-90 60 60)" />
            ))}
            <text x="60" y="58" textAnchor="middle" fontFamily="SF Mono, ui-monospace, monospace" fontSize="21" fontWeight="600" fill="var(--semi-color-text-0)">{total}</text>
            <text x="60" y="73" textAnchor="middle" fontSize="9" fill="var(--semi-color-text-2)">在办</text>
          </svg>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            {data.map((d, i) => (
              <div key={d.code} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="text-sm truncate" style={{ flex: 1 }}>{d.name}</span>
                <span className="text-xs tabular-nums text-[var(--semi-color-text-2)]">{d.value} · {Math.round((d.value / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
