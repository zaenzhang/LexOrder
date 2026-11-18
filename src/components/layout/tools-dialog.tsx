"use client";

import { DialogContent, DialogHeader, DialogTitle, WorkspaceDialog } from "@/components/patterns/workspace-dialog";

import { useState } from "react";
import { Tabs } from "@douyinfe/semi-ui";
import { IconPercentage as Calculator, IconVerify as Scale, IconCoinMoney as Coins, IconCalendar as CalendarDays } from "@douyinfe/semi-icons";
import { CourtFeeCalc, useCourtFeeCalculator } from "@/app/(app)/tools/calc/_components/court-fee-calc";
import { LateInterestCalc, useLateInterestCalculator } from "@/app/(app)/tools/calc/_components/late-interest-calc";
import { DaysCalc, useDaysCalculator } from "@/app/(app)/tools/calc/_components/days-calc";

export function ToolsDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState("courtFee");
  // Calculator drafts outlive their tab and modal; hidden panels need no focusable DOM.
  const courtFee = useCourtFeeCalculator();
  const lateInterest = useLateInterestCalculator(open && tab === "lateInterest");
  const days = useDaysCalculator(open && tab === "days");

  return (
    <WorkspaceDialog open={open} dismissOnBackdrop onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[580px]">
        <DialogHeader><DialogTitle className="inline-flex items-center gap-2"><Calculator size="default" aria-hidden />实务工具</DialogTitle></DialogHeader>
        <Tabs activeKey={tab} onChange={setTab} keepDOM={false} tabPaneMotion={false}>
          <Tabs.TabPane itemKey="courtFee" tab="诉讼费" icon={<Scale size="default" aria-hidden />}>
            <CourtFeeCalc calculator={courtFee} />
          </Tabs.TabPane>
          <Tabs.TabPane itemKey="lateInterest" tab="迟延履行金" icon={<Coins size="default" aria-hidden />}>
            <LateInterestCalc calculator={lateInterest} />
          </Tabs.TabPane>
          <Tabs.TabPane itemKey="days" tab="天数计算" icon={<CalendarDays size="default" aria-hidden />}>
            <DaysCalc calculator={days} />
          </Tabs.TabPane>
        </Tabs>
      </DialogContent>
    </WorkspaceDialog>
  );
}
