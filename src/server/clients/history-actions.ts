"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import type { ClientPageInput } from "@/lib/clients/history";
import { readClientHistory, readClientMatters } from "./history-service";

export async function getClientMatterPage(input: ClientPageInput) {
  const { user } = await requireSession("clients.read");
  return readClientMatters(prisma, user, input);
}
export async function getClientHistoryPage(input: ClientPageInput) {
  const { user } = await requireSession("clients.read");
  return readClientHistory(prisma, user, input);
}
