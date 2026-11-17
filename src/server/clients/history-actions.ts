"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import type { ClientHistoryInput, ClientPageInput } from "@/lib/clients/history";
import { readClientHistory, readClientHistoryMatters, readClientMatters } from "./history-service";

export async function getClientMatterPage(input: ClientPageInput) {
  const { user } = await requireSession("clients.read");
  return readClientMatters(prisma, user, input);
}
export async function getClientHistoryPage(input: ClientHistoryInput) {
  const { user } = await requireSession("clients.read");
  return readClientHistory(prisma, user, input);
}
export async function getClientHistoryMatterPage(input: ClientPageInput) {
  const { user } = await requireSession("clients.read");
  return readClientHistoryMatters(prisma, user, input);
}
