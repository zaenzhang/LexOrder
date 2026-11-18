"use client";

import { useState } from "react";
import { Modal, Tabs } from "@douyinfe/semi-ui";
import { Calculator, Scale, Coins, CalendarDays } from "lucide-react";
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
    <Modal
      title={<span className="inline-flex items-center gap-2"><Calculator size={18} aria-hidden />实务工具</span>}
      visible={open}
      onCancel={() => onOpenChange(false)}
      footer={null}
      width={580}
      centered
      bodyStyle={{ maxHeight: "calc(88vh - 100px)", overflowY: "auto" }}
    >
      <Tabs activeKey={tab} onChange={setTab} keepDOM={false} tabPaneMotion={false}>
        <Tabs.TabPane itemKey="courtFee" tab="诉讼费" icon={<Scale size={16} aria-hidden />}>
          <CourtFeeCalc calculator={courtFee} />
        </Tabs.TabPane>
        <Tabs.TabPane itemKey="lateInterest" tab="迟延履行金" icon={<Coins size={16} aria-hidden />}>
          <LateInterestCalc calculator={lateInterest} />
        </Tabs.TabPane>
        <Tabs.TabPane itemKey="days" tab="天数计算" icon={<CalendarDays size={16} aria-hidden />}>
          <DaysCalc calculator={days} />
        </Tabs.TabPane>
      </Tabs>
    </Modal>
  );
}
