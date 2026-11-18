"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@douyinfe/semi-ui";
import { IconCoinMoney as Coins, IconInfoCircle as Info, IconPercentage as Calculator } from "@douyinfe/semi-icons";
import { calcLateInterest, numberToChinese } from "@/lib/legal-calc";
import { shDayKey, civilKey, civilFromKey } from "@/lib/ui/sh-time";

export function useLateInterestCalculator(active = true) {
  const datesInitialized = useRef(false);
  const [principal, setPrincipal] = useState("100000");
  const [dueDate, setDueDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [lprPercent, setLprPercent] = useState("3.45");
  const [extraPercent, setExtraPercent] = useState("5");

  const [result, setResult] = useState<ReturnType<typeof calcLateInterest> | null>(null);

  useEffect(() => {
    if (!active || datesInitialized.current) return;
    datesInitialized.current = true;
    // 首次打开时取上海当天；日历月计算仍使用本地正午载体。
    const todayKey = shDayKey(new Date());
    const halfYearAgo = civilFromKey(todayKey);
    halfYearAgo.setMonth(halfYearAgo.getMonth() - 6);
    setDueDate(civilKey(halfYearAgo));
    setPaidDate(todayKey);
  }, [active]);

  function compute() {
    const p = parseFloat(principal) || 0;
    if (!dueDate || !paidDate || p <= 0) {
      setResult(null);
      return;
    }
    setResult(
      calcLateInterest({
        principal: p,
        dueDate: civilFromKey(dueDate),
        paidDate: civilFromKey(paidDate),
        lprPercent: parseFloat(lprPercent) || 0,
        extraPercent: parseFloat(extraPercent) || 0
      })
    );
  }

  return { principal, setPrincipal, dueDate, setDueDate, paidDate, setPaidDate, lprPercent, setLprPercent, extraPercent, setExtraPercent, result, compute };
}

export function LateInterestCalc({ calculator }: { calculator: ReturnType<typeof useLateInterestCalculator> }) {
  const { principal, setPrincipal, dueDate, setDueDate, paidDate, setPaidDate, lprPercent, setLprPercent, extraPercent, setExtraPercent, result, compute } = calculator;

  return (
    <section className="ll-surface rounded-lg border border-border p-5">
      <header className="mb-4 flex items-center gap-2">
        <Coins aria-hidden size="default" className="text-primary" />
        <h2 className="text-lg">迟延履行金计算</h2>
        <span className="ml-2 text-xs text-muted-foreground">
          民诉法第 260 条 + 民诉法解释第 463 条
        </span>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="late-principal" className="text-sm">判决金额（元）</label>
          <Input
            type="number"
            id="late-principal"
            value={principal}
            onChange={setPrincipal}
            className="mt-1 font-mono text-[14px]"
          />
        </div>
        <div>
          <label htmlFor="late-due" className="text-sm">应履行日期</label>
          <Input
            type="date"
            id="late-due"
            value={dueDate}
            onChange={setDueDate}
            className="mt-1"
          />
        </div>
        <div>
          <label htmlFor="late-paid" className="text-sm">实际履行日期（或截至日）</label>
          <Input
            type="date"
            id="late-paid"
            value={paidDate}
            onChange={setPaidDate}
            className="mt-1"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label htmlFor="late-lpr" className="text-sm">一年期 LPR（%）</label>
            <Input
              type="number"
              step="0.01"
              id="late-lpr"
              value={lprPercent}
              onChange={setLprPercent}
              className="mt-1 font-mono"
            />
          </div>
          <div>
            <label htmlFor="late-extra" className="text-sm">加成（%）</label>
            <Input
              type="number"
              step="0.5"
              id="late-extra"
              value={extraPercent}
              onChange={setExtraPercent}
              className="mt-1 font-mono"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button htmlType="button" theme="solid" onClick={compute} icon={<Calculator size="default" aria-hidden />}>
          计算
        </Button>
      </div>

      {result && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <ResultCard label="迟延天数" value={`${result.daysLate} 天`} accent="var(--semi-color-text-1)" />
            <ResultCard
              label="年利率"
              value={`${(result.yearlyRate * 100).toFixed(2)}%`}
              accent="var(--semi-color-warning)"
            />
            <ResultCard
              label="加倍利息（推荐采用）"
              value={`¥${result.interest.toLocaleString()}`}
              accent="var(--semi-color-danger)"
            />
          </div>
          <div className="mt-3 rounded-md border border-border bg-muted/20 p-3 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">本金 + 加倍利息合计</span>
              <span className="font-mono text-[16px] font-medium tabular text-foreground">
                ¥{result.totalToPay.toLocaleString()}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              大写：{numberToChinese(result.totalToPay)}
            </p>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info aria-hidden size="small" className="mt-0.5 shrink-0" />
            算法：判决金额 × (一年期 LPR + {extraPercent}%) × 迟延天数 / 365。LPR 以中国人民银行公布为准，建议办案时确认当前值。
          </p>
        </>
      )}
    </section>
  );
}

function ResultCard({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="text-xs tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-[20px] font-medium tabular" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}
