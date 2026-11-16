"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { revalidateMatter } from "@/server/matters/route";
import { createClientBriefForActor } from "./brief";
import {
  findDeliveryByRequestForActor, findDeliveryEventByRequestForActor, getDeliveryDetailForActor,
  getDeliveryOptionsForActor, listDeliveryRecordsForActor, prepareDeliveryForActor, registerDeliveryEventForActor,
} from "./service";
import type { BriefInput, PrepareDeliveryInput, RegisterDeliveryEventInput } from "./contracts";

export async function listDeliveryRecords(matterId: string, beforeId?: string) {
  const { user } = await requireSession("documents.download");
  return listDeliveryRecordsForActor(user.id, matterId, beforeId);
}
export async function getDeliveryDetail(deliveryId: string) {
  const { user } = await requireSession("documents.download");
  return getDeliveryDetailForActor(user.id, deliveryId);
}
export async function getDeliveryOptions(matterId: string) {
  const { user } = await requireSession("documents.download");
  return getDeliveryOptionsForActor(user.id, matterId);
}
export async function prepareDelivery(input: PrepareDeliveryInput) {
  const { user } = await requireSession("matters.export");
  const result = await prepareDeliveryForActor(user.id, input);
  await revalidateMatter(input.matterId);
  if (input.recipientClientId) revalidatePath(`/clients/${input.recipientClientId}`);
  return result;
}
export async function findDeliveryByRequest(input: PrepareDeliveryInput) {
  const { user } = await requireSession("documents.download");
  return findDeliveryByRequestForActor(user.id, input);
}
export async function registerDeliveryEvent(input: RegisterDeliveryEventInput) {
  const { user } = await requireSession("matters.export");
  const result = await registerDeliveryEventForActor(user.id, input);
  const detail = await getDeliveryDetailForActor(user.id, result.deliveryId);
  await revalidateMatter(detail.matterId);
  if (detail.recipientClientId) revalidatePath(`/clients/${detail.recipientClientId}`);
  return result;
}
export async function findDeliveryEventByRequest(input: RegisterDeliveryEventInput) {
  const { user } = await requireSession("documents.download");
  return findDeliveryEventByRequestForActor(user.id, input);
}
export async function createClientBrief(input: BriefInput) {
  const { user } = await requireSession("documents.write");
  const result = await createClientBriefForActor(user.id, input);
  await revalidateMatter(input.matterId);
  return result;
}
