import type { ZipFile } from "yauzl";
import { openBoundedDocx, readDocxPart } from "@/server/documents/docx-package";

const corePath = "docProps/core.xml";
const maxCoreBytes = 64 * 1024;
const saveCounter = /(<cp:revision>)\d+(<\/cp:revision>)/g;
const saveTime = /(<dcterms:modified xsi:type="dcterms:W3CDTF">)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z(<\/dcterms:modified>)/g;

function coreWithoutSaveStamp(xml: string) {
  // Match the plain XML written by the observed editor. Leave unusual XML,
  // entity declarations and nested/escaped metadata to normal versioning.
  if (xml.includes("<!") || !xml.includes('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"')
    || !xml.includes('xmlns:dcterms="http://purl.org/dc/terms/"')) return;
  return xml.replace(saveCounter, "$1$2").replace(saveTime, "$1$2");
}

export async function differsOnlyInDocxSaveStamp(before: Buffer, after: Buffer) {
  let oldZip: ZipFile | undefined;
  let newZip: ZipFile | undefined;
  try {
    const oldPackage = await openBoundedDocx(before);
    oldZip = oldPackage.zip;
    const newPackage = await openBoundedDocx(after);
    newZip = newPackage.zip;
    const previous = oldPackage.parts;
    const current = newPackage.parts;
    if (previous.size !== current.size) return false;
    const oldCore = previous.get(corePath);
    const newCore = current.get(corePath);
    if (!oldCore || !newCore || oldCore.uncompressedSize > maxCoreBytes || newCore.uncompressedSize > maxCoreBytes) return false;
    const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const oldXml = utf8.decode(await readDocxPart(oldZip, oldCore));
    const newXml = utf8.decode(await readDocxPart(newZip, newCore));
    const oldProperties = coreWithoutSaveStamp(oldXml);
    if (!oldProperties || oldXml === newXml || oldProperties !== coreWithoutSaveStamp(newXml)) return false;
    for (const [name, entry] of previous) {
      if (name === corePath) continue;
      const next = current.get(name);
      if (!next || entry.uncompressedSize !== next.uncompressedSize || entry.crc32 !== next.crc32) return false;
      if (!(await readDocxPart(oldZip, entry)).equals(await readDocxPart(newZip, next))) return false;
    }
    return true;
  } catch {
    // An unrecognized package cannot establish equivalence.
    return false;
  } finally {
    oldZip?.close();
    newZip?.close();
  }
}
