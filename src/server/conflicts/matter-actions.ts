'use server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { approvalTransaction } from '@/lib/approvals/service';
import { revalidateMatter } from '@/server/matters/route';
import { runMatterReviewTx, decideMatterReviewTx } from './matter-review';

export async function runMatterReview(matterId: string) {
 const session = await requireSession('matters.write');
 const id = z.string().cuid().parse(matterId);
 await approvalTransaction(db => runMatterReviewTx(db, session.user, id), Prisma.TransactionIsolationLevel.ReadCommitted);
 await revalidateMatter(id);
 return { ok: true };
}

const decisionSchema = z.object({
 matterId: z.string().cuid(), checkId: z.string().cuid(), expectedDecidedAt: z.coerce.date().nullable(),
 conclusion: z.enum(['DIFFERENT', 'SAME_SUBJECT', 'NEED_INFO']), note: z.string().trim().min(1).max(2000)
});
export async function decideMatterReview(input: z.infer<typeof decisionSchema>) {
 const session = await requireSession('matters.write');
 const data = decisionSchema.parse(input);
 await approvalTransaction(db => decideMatterReviewTx(db, session.user, data.matterId, data.checkId, data.expectedDecidedAt, data.conclusion, data.note), Prisma.TransactionIsolationLevel.ReadCommitted);
 await revalidateMatter(data.matterId);
 return { ok: true };
}
