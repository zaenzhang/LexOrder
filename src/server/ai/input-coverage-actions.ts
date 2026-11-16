"use server";

import { requireSession } from "@/lib/auth/session";
import type { MatterInputCoverageInput, MatterInputCoverageView } from "@/lib/ai/input-coverage";
import { readMatterInputCoverage } from "./input-coverage-service";

export async function getMatterInputCoverage(input: MatterInputCoverageInput): Promise<MatterInputCoverageView> {
  const session = await requireSession("documents.read");
  return readMatterInputCoverage(session.user.id, input);
}
