"use client";

import { useState } from "react";
import { Button, Input, RadioGroup } from "@douyinfe/semi-ui";
import { IconVerify as Scale, IconPercentage as Calculator } from "@douyinfe/semi-icons";
import { calcCourtFee, numberToChinese, type CourtFeeCaseType } from "@/lib/legal-calc";

const CASE_TYPES: { value: CourtFeeCaseType; label: string }[] = [
  { value: "PROPERTY", label: "财产案件" },
  { value: "DIVORCE", label: "离婚" },
  { value: "LABOR", label: "劳动争议" },
  { value: "IP", label: "知识产权" },
  { value: "OTHER", label: "其他非财产" }
];

export function useCourtFeeCalculator() {
  const [caseType, setCaseType] = useState<CourtFeeCaseType>("PROPERTY");
  const [amountInput, setAmountInput] = useState("100000");
  const [result, setResult] = useState<ReturnType<typeof calcCourtFee> | null>(null);
  const showAmount = caseType === "PROPERTY" || caseType === "DIVORCE";
  const amount = parseFloat(amountInput) || 0;

  function compute() {
    setResult(calcCourtFee({ caseType, amount: showAmount ? amount : undefined }));
  }

  return { caseType, setCaseType, amountInput, setAmountInput, result, showAmount, amount, compute };
}

export function CourtFeeCalc({ calculator }: { calculator: ReturnType<typeof useCourtFeeCalculator> }) {
  const { caseType, setCaseType, amountInput, setAmountInput, result, showAmount, amount, compute } = calculator;

  return (
    <section className="ll-surface rounded-lg border border-border p-5">
      <header className="mb-4 flex items-center gap-2">
        <Scale aria-hidden size="default" className="text-primary" />
        <h2 className="text-lg">诉讼费计算</h2>
        <span className="ml-2 text-xs text-muted-foreground">
          《诉讼费用交纳办法》全国统一标准
        </span>
      </header>

      <div className="space-y-3">
        <div>
          <div className="text-sm">案件类型</div>
          <RadioGroup
            aria-label="案件类型"
            type="button"
            buttonSize="small"
            className="mt-2"
            options={CASE_TYPES}
            value={caseType}
            onChange={(event) => setCaseType(event.target.value as CourtFeeCaseType)}
          />
        </div>

        {showAmount && (
          <div>
            <label htmlFor="court-fee-amount" className="text-sm">
              {caseType === "DIVORCE" ? "财产分割金额（元，可填 0）" : "诉讼标的金额（元）"}
            </label>
            <Input
              id="court-fee-amount"
              type="number"
              value={amountInput}
              onChange={setAmountInput}
              className="mt-1 font-mono text-[14px]"
              placeholder="如 100000"
            />
            {amount > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                大写：{numberToChinese(amount)}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <Button htmlType="button" theme="solid" onClick={compute} icon={<Calculator size="default" aria-hidden />}>
          计算
        </Button>
      </div>

      {result && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <ResultCard label="普通程序" value={result.fee} accent="var(--semi-color-primary)" />
            <ResultCard label="简易程序（减半）" value={result.feeSimplified} accent="var(--semi-color-success)" />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{result.note}</p>
        </>
      )}
    </section>
  );
}

function ResultCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="text-xs tracking-wider text-muted-foreground">{label}</div>
      <div
        className="mt-1 font-mono text-[26px] font-medium tabular"
        style={{ color: accent }}
      >
        ¥{value.toLocaleString()}
      </div>
    </div>
  );
}
