import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { ActionError } from "@/lib/action-error";
import { openBoundedDocx, readDocxPart } from "./docx-package";

const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const xmlSpace = "http://www.w3.org/XML/1998/namespace";
const mainPart = "word/document.xml";
const serializer = new XMLSerializer();
const unsupported = () => new ActionError("无法安全编辑此 DOCX，请在本机编辑器中修改并保存新版本");

function children(element: Element) {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1);
}

function isWord(element: Element, name: string) {
  return element.namespaceURI === word && element.localName === name;
}

function plainRuns(paragraph: Element) {
  const content = children(paragraph).filter(child => !isWord(child, "pPr"));
  const runs = content.filter(child => isWord(child, "r"));
  if (!runs.length || runs.length !== content.length) return [];
  let style: string | undefined;
  for (const run of runs) {
    const parts = children(run);
    if (!parts.some(part => isWord(part, "t")) ||
      parts.some(part => !["rPr", "t", "br", "tab"].some(name => isWord(part, name)) ||
        (isWord(part, "br") && part.attributes.length !== 0))) return [];
    const properties = parts.find(part => isWord(part, "rPr"));
    const signature = properties ? serializer.serializeToString(properties) : "";
    if (style !== undefined && style !== signature) return [];
    style = signature;
  }
  return runs;
}

function displayText(paragraph: Element) {
  const pieces: string[] = [];
  for (const node of Array.from(paragraph.getElementsByTagNameNS(word, "*"))) {
    if (isWord(node, "t")) pieces.push(node.textContent ?? "");
    else if (isWord(node, "br") || isWord(node, "cr")) pieces.push("\n");
    else if (isWord(node, "tab")) pieces.push("\t");
  }
  return pieces.join("");
}

async function readBody(bytes: Buffer) {
  try {
    const { zip, parts } = await openBoundedDocx(bytes);
    try {
      const entry = parts.get(mainPart)!;
      if (entry.uncompressedSize > 4 * 1024 * 1024 ||
        [...parts.keys()].some(path => /^word\/vba/i.test(path))) throw unsupported();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await readDocxPart(zip, entry));
      if (/<!DOCTYPE|<!ENTITY/.test(text)) throw unsupported();
      const xml = new DOMParser({ onError: (_level, message) => { throw new Error(message); } })
        .parseFromString(text, "application/xml");
      const root = xml.documentElement;
      if (!root || !isWord(root, "document")) throw unsupported();
      const body = children(root).find(child => isWord(child, "body"));
      if (!body) throw unsupported();
      return { xml, body, paragraphs: children(body).filter(child => isWord(child, "p")) };
    } finally {
      zip.close();
    }
  } catch {
    throw unsupported();
  }
}

export async function listDraftParagraphs(bytes: Buffer) {
  const { paragraphs } = await readBody(bytes);
  return paragraphs.map((paragraph, index) => ({
    position: index + 1, text: displayText(paragraph), canReplace: plainRuns(paragraph).length > 0,
  }));
}

function writeText(xml: Document, run: Element, text: string) {
  for (const token of text.split(/(\n|\t)/)) {
    if (!token) continue;
    const element = xml.createElementNS(word, token === "\n" ? "w:br" : token === "\t" ? "w:tab" : "w:t");
    if (token !== "\n" && token !== "\t") {
      element.setAttributeNS(xmlSpace, "xml:space", "preserve");
      element.appendChild(xml.createTextNode(token));
    }
    run.appendChild(element);
  }
}

export async function writeDraftParagraph(bytes: Buffer, position: number, mode: "AFTER" | "REPLACE", text: string) {
  const { xml, body, paragraphs } = await readBody(bytes);
  const anchor = paragraphs[position - 1];
  if (!anchor) throw new ActionError("文书中没有此正文段落，请刷新预览");
  const value = text.replace(/\r\n?/g, "\n");
  if (!value.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|\p{Surrogate}/u.test(value)) {
    throw new ActionError("研究结论为空或含 DOCX 无法使用的字符");
  }
  if (mode === "REPLACE") {
    const runs = plainRuns(anchor);
    if (!runs.length) throw new ActionError("该段落包含复杂格式，请选择在段后插入");
    if (displayText(anchor) === value) throw new ActionError("新段落与原段落相同");
    const [first, ...rest] = runs;
    for (const child of children(first)) if (!isWord(child, "rPr")) first.removeChild(child);
    for (const run of rest) anchor.removeChild(run);
    writeText(xml, first, value);
  } else {
    const paragraph = xml.createElementNS(word, "w:p");
    const run = xml.createElementNS(word, "w:r");
    writeText(xml, run, value);
    paragraph.appendChild(run);
    body.insertBefore(paragraph, anchor.nextSibling);
  }
  try {
    const zip = new PizZip(bytes);
    // PizZip gives replaced entries the current timestamp by default. Preserve the original
    // value to make the same citation produce identical bytes after a lost response.
    const date = zip.file(mainPart)!.date;
    zip.file(mainPart, serializer.serializeToString(xml), { date });
    return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  } catch {
    throw unsupported();
  }
}
