import { z } from "zod";

export const taskReviewSourceLimit = 50;
export const taskReviewSourceIds = z.array(z.string().cuid()).min(1).max(taskReviewSourceLimit)
  .refine(ids => new Set(ids).size === ids.length);
const source = z.object({ documentId: z.string().cuid(), page: z.number().int().positive().max(10000).nullable() });
export const saveTaskMaterialReviewSchema = z.object({
  matterId: z.string().cuid(),
  taskId: z.string().cuid(),
  taskRevision: z.number().int().nonnegative(),
  requestKey: z.uuid(),
  content: z.string().trim().min(1).max(2000),
  sources: z.array(source).min(1).max(taskReviewSourceLimit)
    .refine(rows => new Set(rows.map(row => row.documentId)).size === rows.length),
});
export type SaveTaskMaterialReviewInput = z.infer<typeof saveTaskMaterialReviewSchema>;
export type TaskMaterialReviewContext = {
  id: string; title: string; description: string | null; stageId: string | null;
  state: "OPEN" | "DONE" | "CANCELLED" | null; reviewRevision: number | null; reviewSourceLimit: number;
};
export type TaskReviewOption = { id: string; name: string; version: number; pdfPages: number | null };
export type TaskReviewEntry = { id: string; createdAt: string; author: string; sourceCount: number };
export type TaskReviewHistory = { items: TaskReviewEntry[]; nextCursor: string | null };
export type TaskReviewDetail = { state: "UNAVAILABLE" } | {
  state: "AVAILABLE";
  content: string;
  createdAt: string;
  author: string;
  sources: {
    documentId: string; name: string; version: number; page: number | null;
    previewUrl: string | null; downloadUrl: string;
  }[];
};
