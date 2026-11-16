import { Document as WordDocument, Packer, Paragraph, HeadingLevel } from "docx";
import PizZip from "pizzip";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action-error";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { ingestMaterial } from "@/server/documents/material-ingest";
import { briefSchema, type BriefInput } from "./contracts";

export async function renderClientBriefBytes(data: { title: string; content: string }) {
  const document = new WordDocument({ sections: [{ children: [
    new Paragraph({ text: data.title, heading: HeadingLevel.TITLE }),
    ...data.content.split(/\r?\n/).map(text => new Paragraph({ text })),
  ] }] });
  // Packer adds wall-clock metadata. It must not turn a retry of the same saved draft into different input bytes.
  const zip = new PizZip(await Packer.toBuffer(document));
  const properties = zip.file("docProps/core.xml");
  if (properties) zip.file("docProps/core.xml", properties.asText().replace(/<dcterms:(created|modified)\b[^>]*>[\s\S]*?<\/dcterms:\1>/g, ""));
  for (const file of Object.values(zip.files)) file.date = new Date("1980-01-01T00:00:00Z");
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/** A manual client brief is an ordinary versioned draft; it acquires no approval or sending fact here. */
export async function createClientBriefForActor(userId: string, input: BriefInput) {
  const data = briefSchema.parse(input);
  if (data.priorDocumentId) {
    const prior = await prisma.document.findUnique({ where: { id: data.priorDocumentId },
      select: { matterId: true, sourceOrigin: true, tags: true, deletedAt: true } });
    if (!prior || prior.deletedAt || prior.matterId !== data.matterId || prior.sourceOrigin !== "TEAM_PRODUCED" || !prior.tags.includes("客户简报")) {
      throw new ActionError("请从本案的客户简报另存新稿，不能替换其他材料");
    }
  }
  const bytes = await renderClientBriefBytes(data);
  const encrypted = encryptBuffer(bytes);
  return ingestMaterial({ userId, requestKey: data.requestKey, priorDocumentId: data.priorDocumentId ?? undefined,
    bytes: encrypted.ciphertext,
    document: {
      matterId: data.matterId, intakeId: null, procedureId: null, stageId: null, folderId: null,
      name: `${data.title}.docx`, category: "OTHER", sourceOrigin: "TEAM_PRODUCED", tags: ["客户简报"],
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: bytes.length, sha256: sha256(bytes), encrypted: true, algorithm: encrypted.algorithm,
      iv: encrypted.iv.toString("base64"), authTag: encrypted.authTag.toString("base64"), uploadedById: userId,
    },
  });
}
