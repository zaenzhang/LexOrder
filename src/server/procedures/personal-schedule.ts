import type { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";

/** Lock the same procedure row as updateProcedure before scheduling new work. */
export async function assertPersonalProcedureOpen(db: Prisma.TransactionClient, matterId: string, procedureId: string) {
  const [row] = await db.$queryRaw<{ status: string; engagement: string; concludedAt: Date | null }[]>
    `SELECT status, engagement, "concludedAt" FROM "MatterProcedure"
     WHERE id = ${procedureId} AND "matterId" = ${matterId} FOR SHARE`;
  if (!row) throw new ActionError("程序不存在或不属于本案");
  if (row.status === "CONCLUDED") {
    if (row.engagement === "INFORMATIONAL" && !row.concludedAt) throw new ActionError("程序状态待核对，请先核对后再安排");
    throw new ActionError("程序已终结，请先恢复程序再安排");
  }
}
