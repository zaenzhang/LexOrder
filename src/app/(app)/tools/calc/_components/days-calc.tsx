"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, RadioGroup } from "@douyinfe/semi-ui";
import { CalendarDays, ArrowRight, Calculator } from "lucide-react";
import { daysBetween, addDays } from "@/lib/legal-calc";
import { shDayKey, civilFromKey, civilKey } from "@/lib/ui/sh-time";

type Mode = "between" | "add";

export function useDaysCalculator(active = true) {
  const datesInitialized = useRef(false);
  const [mode, setMode] = useState<Mode>("between");

  // 模式 1：两日期之间（日历日一律用「上海日键 + 本地正午」载体，与浏览器时区无关）
  const [dateA, setDateA] = useState("");
  const [dateB, setDateB] = useState("");
  const [excludeWeekend, setExcludeWeekend] = useState(false);

  const [between, setBetween] = useState<number | null>(null);
  function computeBetween() {
    if (!dateA || !dateB) {
      setBetween(null);
      return;
    }
    setBetween(daysBetween(civilFromKey(dateA), civilFromKey(dateB), excludeWeekend));
  }

  // 模式 2：加减天数
  const [baseDate, setBaseDate] = useState("");
  const [offset, setOffset] = useState("15");
  const [targetDate, setTargetDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!active || datesInitialized.current) return;
    datesInitialized.current = true;
    // 工作台提前挂载工具草稿，默认日期要等本工具首次打开时再取。
    const todayKey = shDayKey(new Date());
    setDateA(todayKey);
    setDateB(todayKey);
    setBaseDate(todayKey);
  }, [active]);

  function computeTarget() {
    const n = parseInt(offset);
    if (!baseDate || isNaN(n)) {
      setTargetDate(null);
      return;
    }
    setTargetDate(addDays(civilFromKey(baseDate), n));
  }

  return { mode, setMode, dateA, setDateA, dateB, setDateB, excludeWeekend, setExcludeWeekend, between, computeBetween, baseDate, setBaseDate, offset, setOffset, targetDate, computeTarget };
}

export function DaysCalc({ calculator }: { calculator: ReturnType<typeof useDaysCalculator> }) {
  const { mode, setMode, dateA, setDateA, dateB, setDateB, excludeWeekend, setExcludeWeekend, between, computeBetween, baseDate, setBaseDate, offset, setOffset, targetDate, computeTarget } = calculator;

  return (
    <section className="ll-surface rounded-lg border border-border p-5">
      <header className="mb-4 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <h2 className="text-lg">天数计算</h2>
        <span className="ml-2 text-[10px] text-muted-foreground">
          举证期 / 上诉期 / 答辩期常用
        </span>
      </header>

      <RadioGroup
        aria-label="天数计算方式"
        type="button"
        buttonSize="small"
        options={[
          { value: "between", label: "两日期之间" },
          { value: "add", label: "加减天数" }
        ]}
        value={mode}
        onChange={(event) => setMode(event.target.value as Mode)}
      />

      {mode === "between" ? (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="days-start" className="text-sm">起始日</label>
              <Input
                id="days-start"
                type="date"
                value={dateA}
                onChange={setDateA}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="days-end" className="text-sm">截止日</label>
              <Input
                id="days-end"
                type="date"
                value={dateB}
                onChange={setDateB}
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Checkbox
              checked={excludeWeekend}
              onChange={(event) => setExcludeWeekend(event.target.checked === true)}
            >
              仅算工作日（排除周末，不含法定节假日）
            </Checkbox>
            <Button htmlType="button" theme="solid" onClick={computeBetween} icon={<Calculator size={16} aria-hidden />}>
              计算
            </Button>
          </div>

          {between !== null && (
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="text-[10px] tracking-wider text-muted-foreground">间隔天数</div>
              <div className="mt-1 font-mono text-[26px] font-medium tabular text-primary">
                {between >= 0 ? between : `-${Math.abs(between)}`} 天
              </div>
              {between < 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">截止日早于起始日</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="days-base" className="text-sm">基准日</label>
              <Input
                id="days-base"
                type="date"
                value={baseDate}
                onChange={setBaseDate}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="days-offset" className="text-sm">加减天数（可负）</label>
              <Input
                id="days-offset"
                type="number"
                value={offset}
                onChange={setOffset}
                className="mt-1 font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button htmlType="button" theme="solid" onClick={computeTarget} icon={<Calculator size={16} aria-hidden />}>
              计算
            </Button>
          </div>

          {targetDate && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-4">
              <div className="text-center">
                <div className="text-[10px] tracking-wider text-muted-foreground">基准日</div>
                <div className="mt-1 font-mono text-[14px] tabular text-foreground">
                  {baseDate}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <div className="text-center">
                <div className="text-[10px] tracking-wider text-muted-foreground">
                  目标日（{parseInt(offset) >= 0 ? "+" : ""}{offset} 天）
                </div>
                <div className="mt-1 font-mono text-[20px] font-medium tabular text-primary">
                  {civilKey(targetDate)}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {["日", "一", "二", "三", "四", "五", "六"][targetDate.getDay()]}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
