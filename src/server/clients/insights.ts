"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { clientVisibilityFilter } from "@/lib/permissions";
import { decryptIdNumber } from "@/lib/clients/id-number-crypto";
import { ActionError } from "@/lib/action-error";
import { clientPageInputSchema } from "@/lib/clients/history";
import { clientHistoryAccess, clientMattersInTransaction } from "./history-service";

async function assertClientVisible(clientId: string) {
  const session = await requireSession("clients.read");
  clientPageInputSchema.parse({ clientId });
  await prisma.$transaction(tx => clientHistoryAccess(tx, session.user, clientId));
  return session;
}

/** All counts and duplicate suggestions use the current visible client/matter scope. */
export async function getClientInsights(clientId: string) {
  const session = await requireSession("clients.read");
  clientPageInputSchema.parse({ clientId });
  return prisma.$transaction(async tx => {
    const access = await clientHistoryAccess(tx, session.user, clientId);
    const { user, client } = access;
    const clients = { deletedAt: null, AND: [clientVisibilityFilter(user.id, user.role, user.rolePermissions)] };
    const [suspects, matterPage, sameSource, totalClients] = await Promise.all([
      hasCustomPermission(user, "clients.write") ? tx.client.findMany({ where: {
        ...clients, id: { not: client.id }, OR: [
          ...(client.idType && client.idNumberBlind ? [{ idType: client.idType, idNumberBlind: client.idNumberBlind }] : []),
          { name: client.name.trim() }
        ]
      }, take: 3, select: { id: true, name: true, internalCode: true, idType: true, idNumberBlind: true } }) : [],
      clientMattersInTransaction(tx, access),
      client.source ? tx.client.count({ where: { ...clients, source: client.source } }) : 0,
      client.source ? tx.client.count({ where: clients }) : 0
    ]);
    return {
      suspects: suspects.map(row => ({ id: row.id, name: row.name, internalCode: row.internalCode,
        reason: client.idNumberBlind && row.idNumberBlind === client.idNumberBlind && row.idType === client.idType ? "证件号码一致" : "名称一致" })),
      matterPage,
      source: client.source ? { name: client.source, sameSourceClients: sameSource, totalClients } : null
    };
  }, { timeout: 20_000 });
}

export async function revealClientIdNumber(clientId: string) {
  const session = await assertClientVisible(clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { idNumber: true } });
  const plain = decryptIdNumber(client?.idNumber);
  await audit({ userId: session.user.id, action: "CLIENT_ID_REVEAL", targetType: "Client", targetId: clientId });
  return plain;
}

export async function revealContactPhone(contactId: string) {
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { clientId: true, phone: true } });
  if (!contact) throw new ActionError("联系人不存在");
  const session = await assertClientVisible(contact.clientId);
  await audit({ userId: session.user.id, action: "CONTACT_PHONE_REVEAL", targetType: "Contact", targetId: contactId, detail: { clientId: contact.clientId } });
  return contact.phone ?? "";
}
