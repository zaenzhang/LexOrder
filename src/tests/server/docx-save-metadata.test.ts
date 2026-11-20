import PizZip from "pizzip";
import { expect, it } from "vitest";
import { differsOnlyInDocxSaveStamp } from "@/server/desktop/docx-save-metadata";

function document({ counter, date, text = "试验原文", author = "律师", signature = false }: {
  counter: number; date: number; text?: string; author?: string; signature?: boolean;
}) {
  const zip = new PizZip();
  zip.file("docProps/core.xml", `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${author}</dc:creator><cp:revision>${counter}</cp:revision><dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-20T12:01:${date}Z</dcterms:modified></cp:coreProperties>`);
  zip.file("word/document.xml", text);
  if (signature) zip.file("_xmlsignatures/sig1.xml", "合成签名占位");
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

it("仅识别工作副本的自动修订号和修改时间，保留内容、作者、签名和无法辨认的差异", async () => {
  const before = document({ counter: 6, date: 10 });
  expect(await differsOnlyInDocxSaveStamp(before, document({ counter: 7, date: 12 }))).toBe(true);
  expect(await differsOnlyInDocxSaveStamp(before, before)).toBe(false);
  expect(await differsOnlyInDocxSaveStamp(before, document({ counter: 8, date: 14, text: "新写内容" }))).toBe(false);
  expect(await differsOnlyInDocxSaveStamp(before, document({ counter: 8, date: 14, author: "另一位律师" }))).toBe(false);
  expect(await differsOnlyInDocxSaveStamp(document({ counter: 6, date: 10, signature: true }), document({ counter: 7, date: 12, signature: true }))).toBe(false);
  expect(await differsOnlyInDocxSaveStamp(before, Buffer.from("unrecognized"))).toBe(false);
});
