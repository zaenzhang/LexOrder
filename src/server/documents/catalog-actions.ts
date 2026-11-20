import { DocumentCategory } from "@prisma/client";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { canReadDocument } from "@/lib/approvals/documents";
import { materialCategoryBatchLimit } from "@/lib/documents/catalog";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { auditTx } from "@/server/audit";
import { lockWritableMatters } from "@/server/matters/write-access";
import { revalidateMatter } from "@/server/matters/route";

export const changeMaterialCategorySchema = z.object({
  action: z.literal("change-material-category"),
  matterId: z.cuid(),
  documentIds: z.array(z.cuid()).min(1).max(materialCategoryBatchLimit).refine(ids => new Set(ids).size === ids.length),
  category: z.enum(DocumentCategory),
});

export async function changeMaterialCategory(input: z.infer<typeof changeMaterialCategorySchema>) {
  const { matterId, documentIds, category } = changeMaterialCategorySchema.parse(input);
  const { user } = await requireSession("documents.write");
  const changed = await prisma.$transaction(async tx => {
    await lockWritableMatters(tx, user, "documents.write", [matterId], true);
    const eligible = { matterId, deletedAt: null, isLatest: true, status: "DRAFT" } as const;
    const documents = await tx.document.findMany({
      where: { id: { in: documentIds }, ...eligible },
      select: { id: true, matterId: true, intakeId: true, uploadedById: true, category: true },
    });
    if (documents.length !== documentIds.length) {
      throw new ActionError("只能归类本案当前可编辑版本，请移除历史、审核中、已批准、已入卷、已撤回或非本案材料。");
    }
    for (const document of documents) {
      if (!await canReadDocument(user.id, document, tx)) throw new ActionError("部分选材不可读，请刷新后重新选择。");
    }
    const changes = documents.filter(document => document.category !== category)
      .map(document => ({ id: document.id, previousCategory: document.category }));
    if (!changes.length) return 0;

    const updated = await tx.document.updateMany({
      where: { id: { in: changes.map(document => document.id) }, ...eligible },
      data: { category },
    });
    if (updated.count !== changes.length) throw new ActionError("部分材料状态已变化，请刷新后重新选择。");
    await auditTx(tx, {
      userId: user.id, action: "DOCUMENT_BATCH_CATEGORY", targetType: "Matter", targetId: matterId,
      detail: { category, changes },
    });
    return updated.count;
  });
  if (changed) await revalidateMatter(matterId);
  return { changed };
}
