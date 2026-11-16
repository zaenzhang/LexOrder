/**
 * v0.49 法定期限计算（PRD §二十）。
 *
 * 期间计算依据《中华人民共和国民事诉讼法（2023修正）》第八十五条（已核验）：
 * - 期间以时、日、月、年计算；期间开始的时和日不计算在期间内
 *   → 按日的期限：到期日 = 触发日 + N 日（即从次日起算第 N 日）
 * - 期间届满的最后一日是法定休假日的，以其后第一日为届满日
 *   → 系统不内置节假日表（每年国务院调整），由 UI 提示人工核对顺延
 * 按月/年的期间取到期月对应日；到期月无对应日的取该月最后一日。
 */
import type { DeadlinePeriodUnit } from "@prisma/client";
import { ActionError } from "@/lib/action-error";
import { shDateFromKey, shDayKey } from "@/lib/ui/sh-time";

export const HOLIDAY_NOTE = "如届满日为法定休假日，以其后第一个工作日为届满日；已配置放假安排时系统提供顺延建议并在依据标注，请核对";

/** Calendar arithmetic uses UTC fields only; inputs and results are Shanghai instants. */
export function computeDeadlineDate(triggerDate: Date, periodValue: number, periodUnit: DeadlinePeriodUnit): Date {
  if (!Number.isInteger(periodValue) || periodValue <= 0) throw new ActionError("期限数值必须为正整数");
  if (!Number.isFinite(triggerDate.getTime())) throw new ActionError("请填写有效起算日期");
  const [year, month, day] = shDayKey(triggerDate).split("-").map(Number);
  let result: Date;
  if (periodUnit === "DAYS") result = new Date(Date.UTC(year, month - 1, day + periodValue));
  else {
    const months = periodUnit === "MONTHS" ? periodValue : periodValue * 12;
    const first = new Date(Date.UTC(year, month - 1 + months, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    result = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last)));
  }
  if (!Number.isFinite(result.getTime())) throw new ActionError("期限日期超出可计算范围");
  return shDateFromKey(result.toISOString().slice(0, 10));
}

export function periodLabel(periodValue: number, periodUnit: DeadlinePeriodUnit): string {
  const unit = periodUnit === "DAYS" ? "日" : periodUnit === "MONTHS" ? "个月" : "年";
  return `${periodValue} ${unit}`;
}

/** 生成 Deadline.basis 文本：法条 + 计算过程 + 顺延提示 */
export function buildDeadlineBasis(input: {
  legalBasis: string;
  triggerLabel: string;
  triggerDate: Date;
  periodValue: number;
  periodUnit: DeadlinePeriodUnit;
}): string {
  return [
    input.legalBasis,
    `自${input.triggerLabel}（${shDayKey(input.triggerDate)}）起 ${periodLabel(input.periodValue, input.periodUnit)}`,
    HOLIDAY_NOTE
  ].join("；");
}
