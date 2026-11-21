import { fromBufferPromise, type Entry, type ZipFile } from "yauzl";

export async function openBoundedDocx(bytes: Buffer) {
  const zip = await fromBufferPromise(bytes, {
    lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true,
  });
  try {
    if (zip.entryCount > 1024) throw new Error("Too many DOCX parts");
    const parts = new Map<string, Entry>();
    let expandedBytes = 0;
    for await (const entry of zip.eachEntry()) {
      expandedBytes += entry.uncompressedSize;
      if (parts.has(entry.fileName) || entry.fileName.toLowerCase().startsWith("_xmlsignatures/")
        || entry.isEncrypted() || expandedBytes > 32 * 1024 * 1024) throw new Error("Unsupported DOCX package");
      parts.set(entry.fileName, entry);
    }
    if (!parts.has("word/document.xml")) throw new Error("Missing DOCX body");
    return { zip, parts };
  } catch (error) {
    zip.close();
    throw error;
  }
}

export async function readDocxPart(zip: ZipFile, entry: Entry) {
  const chunks: Buffer[] = [];
  for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
  return Buffer.concat(chunks);
}
