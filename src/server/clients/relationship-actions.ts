"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import type { ClientActivityInput, ClientRelationshipView } from "@/lib/clients/relationship";
import type { ClientPageInput } from "@/lib/clients/history";
import { saveClientActivity } from "./relationship-service";
import { readClientRelationship, readClientCommunicationPage, readClientFollowUpPage } from "./history-service";

export async function getClientRelationship(clientId: string): Promise<ClientRelationshipView | null> {
  const { user } = await requireSession("clients.read");
  return readClientRelationship(prisma, user, clientId);
}

export async function getClientCommunicationPage(input: ClientPageInput) {
  const { user } = await requireSession("clients.read");
  return readClientCommunicationPage(prisma, user, input);
}

export async function getClientFollowUpPage(input: ClientPageInput) {
  const { user } = await requireSession("clients.read");
  return readClientFollowUpPage(prisma, user, input);
}

export async function recordClientActivity(input: ClientActivityInput) {
  const { user } = await requireSession("clients.write");
  const result = await saveClientActivity(prisma, user, input);
  revalidatePath(`/clients/${input.clientId}`);
  revalidatePath("/clients");
  return result;
}
