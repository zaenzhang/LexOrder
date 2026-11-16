import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action-error";
import { approvalTransaction } from "@/lib/approvals/service";
import { storage } from "@/lib/storage";
import { decryptBuffer, sha256 } from "@/lib/storage/crypto";
import { formatDateTime } from "@/lib/utils";
import { auditTx } from "@/server/audit";
import { assertDeliveryDocuments, loadDeliveryRecord } from "./service";
import { exportDeliverySchema } from "./contracts";

const MAX_EXPORT_BYTES = 100 * 1024 * 1024;
function safeName(value: string) {
  return value.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_").replace(/^\.+/, "_").slice(0, 220) || "材料";
}

/** Build only the previously frozen list. A later family version never substitutes for a missing item. */
export async function exportDeliveryForActor(userId: string, deliveryId: string, input: { requestKey: string }) {
  const { requestKey } = exportDeliverySchema.parse(input);
  const record = await loadDeliveryRecord(prisma, userId, deliveryId, true);
  await assertDeliveryDocuments(prisma, userId, record, true);
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ deliveryId, kind: "EXPORTED" })).digest("hex");
  const zip = new PizZip();
  let totalBytes = 0;
  const names: string[] = [];
  for (const item of record.items) {
    let bytes: Buffer;
    try {
      const document = item.document;
      if (document.size != null && totalBytes + document.size > MAX_EXPORT_BYTES) throw new ActionError("交付文件合计超过 100 MB，请另建较小的清单");
      const stored = await storage.readFile(document.path);
      if (document.encrypted) {
        if (!document.iv || !document.authTag) throw new ActionError("材料的加密信息不完整，请核对原件");
        bytes = decryptBuffer(stored, document.iv, document.authTag);
      } else bytes = stored;
    } catch (error) {
      if (error instanceof ActionError) throw error;
      throw new ActionError("清单中有原件无法读取，本次未导出；请回材料区核对后重试");
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_EXPORT_BYTES) throw new ActionError("交付文件合计超过 100 MB，请另建较小的清单");
    if (sha256(bytes) !== item.documentSha256 || (item.size != null && bytes.length !== item.size)) {
      throw new ActionError("清单中的原件与固定版本不一致，本次未导出；请核对原件");
    }
    const fileName = `${String(item.position).padStart(2, "0")}_${safeName(item.documentName)}`;
    names.push(`${item.position}. ${item.documentName}（第 ${item.documentVersion} 版）`);
    zip.file(`材料/${fileName}`, bytes);
  }
  zip.file("交付清单.txt", [
    record.purpose, `接收对象：${record.recipientName}`, `联系方式或交接地点：${record.recipientContact}`,
    `披露范围：${record.disclosureScope}`, `准备时间：${formatDateTime(record.createdAt)}`,
    "", ...names, "", `未决事项：${record.unresolvedItems || "未填写"}`,
    "", "本文件为固定材料清单。导出记录不代表已经发送或客户确认。",
  ].join("\r\n"));
  const buffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  // Files may take time to read. Recheck current authority and source withdrawal immediately before release.
  const event = await approvalTransaction(async db => {
    const current = await loadDeliveryRecord(db, userId, deliveryId, true);
    await assertDeliveryDocuments(db, userId, current, true);
    const existing = await db.deliveryEvent.findUnique({ where: { actorId_requestKey: { actorId: userId, requestKey } } });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new ActionError("导出标识已用于其他操作，请重新导出");
      return existing;
    }
    const created = await db.deliveryEvent.create({ data: {
      deliveryId, actorId: userId, kind: "EXPORTED", requestKey, requestFingerprint, occurredAt: new Date(),
    } });
    await auditTx(db, { userId, action: "DELIVERY_EXPORT", targetType: "DeliveryRecord", targetId: deliveryId,
      detail: { matterId: record.matterId, eventId: created.id, itemCount: record.items.length, size: buffer.length } });
    return created;
  });
  return { buffer, eventId: event.id, fileName: `${safeName(record.purpose)}_交付材料.zip` };
}
