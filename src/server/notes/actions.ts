"use server";
import { roleMutation } from "@/lib/roles/service";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit, auditTx } from "@/server/audit";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanReadMatter, assertCanModifyMatter } from "@/lib/permissions";
import { revalidateMatter } from "@/server/matters/route";
import { ActionError } from "@/lib/action-error";
import { lockWritableMatters } from "@/server/matters/write-access";

const noteChannelSchema = z.enum(["PHONE", "WECHAT", "EMAIL", "MEETING", "COURT", "OTHER"]);

const noteCreateSchema = z.object({
  matterId: z.string().cuid(),
  channel: noteChannelSchema.default("OTHER"),
  withWhom: z.string().max(80).optional().or(z.literal("")),
  occurredAt: z.coerce.date().default(() => new Date()),
  content: z.string().min(1, "内容不能为空").max(5000),
  tags: z.array(z.string().max(20)).default([])
});

const noteUpdateSchema = noteCreateSchema.extend({
  id: z.string().cuid(),
  expectedUpdatedAt: z.coerce.date()
});

export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;

export async function createNote(input: NoteCreateInput) {
  const session = await requireSession("schedule.write");
  const data = noteCreateSchema.parse(input);
  const created = await prisma.$transaction(async tx => {
    await lockWritableMatters(tx, session.user, "schedule.write", [data.matterId]);
    const note = await tx.note.create({ data: {
      matterId: data.matterId, authorId: session.user.id, channel: data.channel,
      withWhom: data.withWhom || null, occurredAt: data.occurredAt, content: data.content, tags: data.tags
    } });
    await auditTx(tx, { userId: session.user.id, action: "NOTE_CREATE", targetType: "Note", targetId: note.id,
      detail: { matterId: data.matterId, channel: data.channel } });
    return note;
  });

  await revalidateMatter(data.matterId);
  return { ok: true, id: created.id };
}

export async function updateNote(input: NoteUpdateInput) {
  const session = await requireSession("schedule.write");
  const data = noteUpdateSchema.parse(input);

  await prisma.$transaction(async tx => {
    await lockWritableMatters(tx, session.user, "schedule.write", [data.matterId]);
    await tx.$queryRaw`SELECT id FROM "Note" WHERE id = ${data.id} FOR UPDATE`;
    const existing = await tx.note.findUnique({ where: { id: data.id } });
    if (!existing || existing.deletedAt || existing.matterId !== data.matterId) throw new ActionError("记录不存在或不属于当前案件");
    if (existing.authorId !== session.user.id) throw new ActionError("只能编辑自己的办案记录");
    if (existing.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) throw new ActionError("记录已变化，请重新打开核对后保存");
    const updatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1));
    const updated = await tx.note.updateMany({
      where: { id: data.id, matterId: data.matterId, authorId: session.user.id, deletedAt: null, updatedAt: data.expectedUpdatedAt },
      data: { channel: data.channel, withWhom: data.withWhom || null, occurredAt: data.occurredAt,
        content: data.content, tags: data.tags, updatedAt }
    });
    if (updated.count !== 1) throw new ActionError("记录已变化，请重新打开核对后保存");
    await auditTx(tx, { userId: session.user.id, action: "NOTE_UPDATE", targetType: "Note", targetId: data.id,
      detail: { matterId: data.matterId, previousUpdatedAt: existing.updatedAt.toISOString(), updatedAt: updatedAt.toISOString() } });
  });

  await revalidateMatter(data.matterId);
  return { ok: true };
}

export async function deleteNote(id: string) {
  const session = await requireSession("schedule.write");
  const existing = await prisma.note.findUnique({ where: { id } });
  if (!existing) return { ok: false };
  if (existing.authorId !== session.user.id) {
    throw new ActionError("只能删除自己的沟通记录");
  }
  await assertCanModifyMatter(session.user.id, session.user.role, existing.matterId);
  await assertMatterWritable(existing.matterId);

  await roleMutation(session.user, "schedule.write", async roleDb => roleDb.note.update({
    where: { id },
    data: { deletedAt: new Date() }
  }));

  await audit({
    userId: session.user.id,
    action: "NOTE_DELETE",
    targetType: "Note",
    targetId: id
  });

  await revalidateMatter(existing.matterId);
  return { ok: true };
}

export async function listNotes(matterId: string) {
  const session = await requireSession("schedule.read");
  await assertCanReadMatter(session.user.id, session.user.role, matterId, session.user.rolePermissions);
  return prisma.note.findMany({
    where: { matterId, deletedAt: null },
    orderBy: { occurredAt: "desc" },
    include: { author: { select: { id: true, name: true } } }
  });
}
