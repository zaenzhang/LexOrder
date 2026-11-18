"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import type { ClientActivityInput, ClientRelationshipView } from "@/lib/clients/relationship";
import type { ClientPageInput } from "@/lib/clients/history";
import { rescheduleClientFollowUpRecord, saveClientActivity } from "./relationship-service";
import { readClientRelationship, readClientCommunicationPage, readClientFollowUpPage, readPersonalFollowUpRescheduleHistory } from "./history-service";
import type { ClientFollowUpRescheduleInput, PersonalFollowUpHistoryQuery, PersonalFollowUpQuery, PersonalFollowUpTarget } from "@/lib/clients/follow-ups";
import { readPersonalFollowUp, readPersonalFollowUps } from "./follow-up-queue";

export async function getPersonalFollowUps(input: PersonalFollowUpQuery) {
  const { user } = await requireSession("clients.read");
  return readPersonalFollowUps(prisma, user.id, input);
}

export async function getPersonalFollowUp(input: PersonalFollowUpTarget) {
  const { user } = await requireSession("clients.read");
  return readPersonalFollowUp(prisma, user.id, input);
}

export async function getPersonalFollowUpRescheduleHistory(input: PersonalFollowUpHistoryQuery) {
  const { user } = await requireSession("clients.read");
  return readPersonalFollowUpRescheduleHistory(prisma, user, input);
}

export async function rescheduleClientFollowUp(input: ClientFollowUpRescheduleInput) {
  const { user } = await requireSession("clients.write");
  const result = await rescheduleClientFollowUpRecord(prisma, user, input);
  revalidatePath(`/clients/${input.clientId}`);
  revalidatePath("/clients");
  revalidatePath("/");
  revalidatePath("/clients/follow-ups");
  return result;
}

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
  revalidatePath("/");
  revalidatePath("/clients/follow-ups");
  return result;
}
