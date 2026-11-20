import { z } from "zod";

export const folderCreateSchema = z.object({
  matterId: z.string().cuid(),
  name: z.string().min(1, "卷宗名必填").max(40, "卷宗名最长 40 字")
});

export const folderRenameSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(40)
});

export const folderDeleteSchema = z.object({
  id: z.string().cuid()
});

const folderOrder = z.array(z.cuid()).min(1).refine(ids => new Set(ids).size === ids.length);

export const folderReorderSchema = z.object({
  matterId: z.cuid(),
  orderedIds: folderOrder,
  expectedOrder: folderOrder,
}).refine(({ orderedIds, expectedOrder }) => {
  const original = new Set(expectedOrder);
  return orderedIds.length === original.size && orderedIds.every(id => original.has(id));
});

export const moveDocumentToFolderSchema = z.object({
  documentId: z.string().cuid(),
  folderId: z.string().cuid().nullable()
});
