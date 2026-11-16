type ProcedureState = { status: string; engagement: string; concludedAt: Date | string | null };

/** Informational rows historically defaulted to CONCLUDED without a recorded conclusion. */
export function procedureStateLabel(procedure: ProcedureState) {
  if (procedure.engagement === "INFORMATIONAL" && (procedure.status === "PENDING" || procedure.status === "CONCLUDED" && !procedure.concludedAt)) return "状态待核对";
  return ({ PENDING: "待开始", IN_PROGRESS: "办理中", CONCLUDED: "已终结" } as Record<string, string>)[procedure.status] ?? "状态未记录";
}
