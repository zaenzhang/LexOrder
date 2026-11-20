import PizZip from "pizzip";
import { expect, test } from "vitest";
import { listDraftParagraphs, writeDraftParagraph } from "@/server/documents/docx-paragraphs";

const part = "word/document.xml";
const styled = '<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>A &amp; B</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>旧</w:t></w:r></w:p>';
const hyperlink = '<w:p><w:hyperlink r:id="rId9"><w:r><w:t>保留链接</w:t></w:r></w:hyperlink></w:p>';
const table = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格保留</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
const footer = '<w:p><w:r><w:t>末段保留</w:t></w:r></w:p>';
function docx(main = styled + hyperlink + table + footer, signed = false) {
  const zip = new PizZip();
  zip.file(part, '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + main + '<w:sectPr/></w:body></w:document>');
  zip.file("word/styles.xml", '<Styles>unchanged &amp; exact</Styles>');
  if (signed) zip.file("_xmlsignatures/sig1.xml", "<signed/>");
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

test("replaces exactly one eligible body paragraph and leaves neighboring markup and package parts intact", async () => {
  const input = docx();
  const text = "接受 <A> & B\n保留\t例外";
  expect(await listDraftParagraphs(input)).toEqual([
    { position: 1, text: "A & B旧", canReplace: true },
    { position: 2, text: "保留链接", canReplace: false },
    { position: 3, text: "末段保留", canReplace: true },
  ]);
  const result = await writeDraftParagraph(input, 1, "REPLACE", text);
  expect(await writeDraftParagraph(input, 1, "REPLACE", text)).toEqual(result);
  const zip = new PizZip(result);
  expect(zip.file(part)?.asText()).toContain(hyperlink + table + footer);
  expect(zip.file(part)?.asText()).toContain('<w:pStyle w:val="BodyText"/>');
  expect(zip.file(part)?.asText()).toContain("<w:rPr><w:b/></w:rPr>");
  expect(zip.file("word/styles.xml")?.asText()).toBe(new PizZip(input).file("word/styles.xml")?.asText());
  expect((await listDraftParagraphs(result))[0].text).toBe(text);
});

test("inserts after a complex paragraph while retaining that paragraph and the following table", async () => {
  const result = await writeDraftParagraph(docx(), 2, "AFTER", "新段落");
  const content = new PizZip(result).file(part)!.asText();
  expect(content.indexOf("新段落")).toBeGreaterThan(content.indexOf(hyperlink));
  expect(content.indexOf("新段落")).toBeLessThan(content.indexOf(table));
  expect((await listDraftParagraphs(result)).map(row => row.text)).toEqual(["A & B旧", "保留链接", "新段落", "末段保留"]);
});

test("refuses unsupported replacements, invalid targets, blank and unchanged text, signed and malformed inputs", async () => {
  const input = docx();
  await expect(writeDraftParagraph(input, 2, "REPLACE", "替换")).rejects.toThrow("复杂格式");
  await expect(writeDraftParagraph(input, 4, "AFTER", "插入")).rejects.toThrow("没有此正文段落");
  await expect(writeDraftParagraph(input, 1, "AFTER", "\r\n")).rejects.toThrow("研究结论为空");
  await expect(writeDraftParagraph(input, 1, "AFTER", "\u0001a")).rejects.toThrow("无法使用的字符");
  await expect(writeDraftParagraph(input, 1, "REPLACE", "A & B旧")).rejects.toThrow("相同");
  await expect(listDraftParagraphs(docx(styled, true))).rejects.toThrow("无法安全编辑");
  await expect(listDraftParagraphs(docx("<w:p><w:r>"))).rejects.toThrow("无法安全编辑");
  await expect(listDraftParagraphs(Buffer.from("old Word .doc"))).rejects.toThrow("无法安全编辑");
});
