import { ActionError } from "@/lib/action-error";
import { shDayKey } from "@/lib/ui/sh-time";

/** A conclusion records an event that already happened, using Shanghai calendar days. */
export function assertActualProcedureConclusion(concludedAt: Date, acceptedAt: Date | null | undefined) {
  const concludedDay = shDayKey(concludedAt);
  if (concludedDay > shDayKey(new Date())) throw new ActionError("实际终结日期不能晚于今天");
  if (acceptedAt && concludedDay < shDayKey(acceptedAt)) throw new ActionError("实际终结日期不能早于立案／受理日期，请核对日期");
}
