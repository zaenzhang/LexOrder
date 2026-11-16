"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { contextCursorSchema, type ContextRecordInput, type ContextConfirmInput, type ContextSourcePageInput } from "@/lib/matters/context";
import { revalidateMatter } from "./route";
import {
  saveMatterContext, confirmMatterContext, readMatterContext, readContextHistory, readContextSource, readContextSourceOptions
} from "./context-service";
import { readMatterBrief } from "./brief";

const id = z.string().cuid("记录或事项标识无效");

export async function getMatterContext(matterId: string, cursor?: string) {
  const { user } = await requireSession("matters.read");
  return readMatterContext(prisma, user, id.parse(matterId), contextCursorSchema.optional().parse(cursor));
}
export async function getMatterBrief(matterId: string) {
  const { user } = await requireSession("matters.read");
  return readMatterBrief(prisma, user, id.parse(matterId));
}
export async function recordMatterContext(input: ContextRecordInput) {
  const { user } = await requireSession("matters.write");
  const result = await saveMatterContext(prisma, user, input);
  await revalidateMatter(input.matterId);
  return result;
}
export async function confirmMatterContextRecord(input: ContextConfirmInput) {
  const { user } = await requireSession("matters.write");
  const result = await confirmMatterContext(prisma, user, input);
  await revalidateMatter(input.matterId);
  return result;
}
export async function getMatterContextHistory(matterId: string, recordId: string, beforeVersion?: number) {
  const { user } = await requireSession("matters.read");
  return readContextHistory(prisma, user, id.parse(matterId), id.parse(recordId), z.number().int().positive().optional().parse(beforeVersion));
}
export async function getMatterContextSource(matterId: string, recordId: string) {
  const { user } = await requireSession("matters.read");
  return readContextSource(prisma, user, id.parse(matterId), id.parse(recordId));
}
export async function getMatterContextSourceOptions(matterId: string, page?: ContextSourcePageInput) {
  const { user } = await requireSession("matters.write");
  return readContextSourceOptions(prisma, user, id.parse(matterId), page);
}
