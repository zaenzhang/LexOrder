"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { revalidateMatter } from "@/server/matters/route";
import { createReviewIssueSchema, respondReviewIssueSchema, checkReviewIssueSchema, reviewSourcePageSchema } from "./contracts";
import { readDocumentReview, readDocumentReviewSourcePage, createDocumentReviewIssue, respondDocumentReviewIssue, checkDocumentReviewIssue } from "./service";

async function refresh(documentId: string) {
  const document = await prisma.document.findUnique({ where: { id: documentId }, select: { matterId: true } });
  if (document?.matterId) await revalidateMatter(document.matterId);
  revalidatePath("/approvals");
}
export async function getDocumentReview(documentId: string) {
  const session = await requireSession("approval");
  return readDocumentReview(session.user.id, z.string().cuid().parse(documentId));
}
export async function getDocumentReviewSourcePage(input: z.input<typeof reviewSourcePageSchema>) {
  const session = await requireSession("approval");
  return readDocumentReviewSourcePage(session.user.id, input);
}
export async function createReviewIssue(input: z.input<typeof createReviewIssueSchema>) {
  const session = await requireSession("approval");
  const result = await createDocumentReviewIssue(session.user.id, input);
  await refresh(result.documentId); return result;
}
export async function respondReviewIssue(input: z.input<typeof respondReviewIssueSchema>) {
  const session = await requireSession("approval");
  const result = await respondDocumentReviewIssue(session.user.id, input);
  await refresh(result.documentId); return result;
}
export async function checkReviewIssue(input: z.input<typeof checkReviewIssueSchema>) {
  const session = await requireSession("approval");
  const result = await checkDocumentReviewIssue(session.user.id, input);
  await refresh(result.documentId); return result;
}
