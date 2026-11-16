/** 本地传票提取：PDF 首页文本优先，扫描页/图片使用可选的 tesseract。 */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { getDocumentProxy, renderPageAsImage } from "unpdf";
import { promisify } from "node:util";
import type { ParsedSummons } from "./parse-summons";

const execFileAsync = promisify(execFile);
const IMAGE_EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "application/pdf": ".pdf"
};

export async function parseSummonsWithLocalOcr(file: File): Promise<ParsedSummons> {
  const original = Buffer.from(await file.arrayBuffer());
  const isPdf = isPdfBuffer(original);
  if (isPdf) {
    const pdf = await getDocumentProxy(new Uint8Array(original));
    try {
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
      const result = parseSummonsText(text);
      if (result.hearingDate || result.caseNumber) return { ...result, source: "local_text", pageLimit: 1 };
    } finally { await pdf.destroy(); }
  }
  const ext = isPdf ? ".pdf" : IMAGE_EXT_BY_TYPE[file.type];
  if (!ext) throw new Error("本地 OCR 仅支持 JPG/PNG/WebP/HEIC/PDF 文件");

  const dir = await mkdtemp(join(tmpdir(), "lawlink-summons-ocr-"));
  const inputPath = join(dir, `summons${ext}`);
  try {
    await writeFile(inputPath, original);
    const ocrInputPath = isPdf ? await renderPdfFirstPage(inputPath, dir) : inputPath;
    const { stdout } = await execFileAsync(
      process.env.SUMMONS_TESSERACT_BIN || "tesseract",
      [basename(ocrInputPath), "stdout", "-l", "chi_sim+eng", "--psm", "6"],
      { cwd: dirname(ocrInputPath), timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }
    );
    const result = parseSummonsText(stdout);
    if (!result.hearingDate && !result.caseNumber && !result.courtRoom) throw new Error("未提取到传票字段");
    return { ...result, source: "local_ocr", ...(isPdf ? { pageLimit: 1 } : {}) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function isPdfBuffer(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString("ascii") === "%PDF-";
}

async function renderPdfFirstPage(inputPath: string, dir: string): Promise<string> {
  const prefix = join(dir, "summons-page");
  await execFileAsync(
    process.env.SUMMONS_PDFTOPPM_BIN || "pdftoppm",
    ["-f", "1", "-l", "1", "-singlefile", "-r", "220", "-png", inputPath, prefix],
    { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }
  );
  return `${prefix}.png`;
}

export function parseSummonsText(text: string): ParsedSummons {
  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/[　 ]+/g, " ")
    .replace(/[：︰]/g, ":")
    .trim();

  // 必须来自开庭语境，避免把落款/制发日期回填为开庭日期。
  const explicit = normalized.match(/(?:开庭|庭审|应到|传唤)(?:日期|时间)\s*:?\s*([\s\S]{0,180})/);
  const scheduled = normalized.match(/定于([\s\S]{0,180}?)(?:开庭|审理|到庭|应讯)/);
  let hearing = (explicit?.[1] ?? scheduled?.[1] ?? "").split(/(?:制作|制发|签发|落款|送达|签收|收到|打印)日期/)[0];
  if (/待定|另行通知|另行确定/.test(hearing)) hearing = "";
  return {
    hearingDate: parseChineseDate(hearing),
    hearingTime: parseChineseTime(hearing),
    courtRoom: pickCourtRoom(normalized),
    caseNumber: pickCaseNumber(normalized),
    judge: pickJudge(normalized),
    parties: pickParties(normalized)
  };
}

function parseChineseDate(text: string): string | null {
  const arabic = text.match(/(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?/);
  if (arabic) return ymd(arabic[1], arabic[2], arabic[3]);

  const loose = text.match(/(20\d{2})\D{1,4}(\d{1,2})\D{1,4}(\d{1,2})(?=\D)/);
  if (loose) return ymd(loose[1], loose[2], loose[3]);

  const chinese = text.match(/([二〇零○ＯO0一两三四五六七八九十]{4})年([一二三四五六七八九十]{1,3})月([一二三四五六七八九十]{1,3})日/);
  if (!chinese) return null;
  const year = chinese[1]
    .replace(/[〇○ＯO]/g, "0")
    .replace(/零/g, "0")
    .replace(/一/g, "1")
    .replace(/二/g, "2")
    .replace(/三/g, "3")
    .replace(/四/g, "4")
    .replace(/五/g, "5")
    .replace(/六/g, "6")
    .replace(/七/g, "7")
    .replace(/八/g, "8")
    .replace(/九/g, "9");
  return ymd(year, String(cnNumber(chinese[2])), String(cnNumber(chinese[3])));
}

function parseChineseTime(text: string): string | null {
  const match = text.match(/(上午|下午|晚上|午后|中午|凌晨|早上)?\s*([零〇一二两三四五六七八九十\d]{1,3})[:时点](?:([零〇一二两三四五六七八九十\d]{1,3})分?|半|整)?/);
  if (!match) return null;
  let hour = cnNumber(match[2]);
  const minute = match[3] ? cnNumber(match[3]) : match[0].endsWith("半") ? 30 : 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (match[1] && hour > 12 && match[1] !== "下午" && match[1] !== "晚上") return null;
  if (["下午", "晚上", "午后", "中午"].includes(match[1]) && hour < 12) hour += 12;
  if (match[1] === "凌晨" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function pickCourtRoom(text: string): string | null {
  const patterns = [
    /(?:在|于|到)([^\n，,。；;]{2,40}(?:法庭|审判庭|仲裁庭|调解室|会议室))/,
    /(?:地点|开庭地点|庭审地点)[:\s]*([^\n，,。；;]{2,60})/,
    /([^\n，,。；;]{0,20}(?:第[一二三四五六七八九十\d]+)?法庭)/
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) return clean(m[1]);
  }
  return null;
}

function pickCaseNumber(text: string): string | null {
  const m = text.match(/[（(]\s*20\d{2}\s*[）)][^\n，,。；;]{2,40}?号/);
  return m ? clean(m[0]) : null;
}

function pickJudge(text: string): string | null {
  const m = text.match(/(?:审判员|承办法官|法官|仲裁员)[:\s]*([\u4e00-\u9fa5·]{2,6})/);
  return m?.[1] ? clean(m[1]) : null;
}

function pickParties(text: string): string[] | null {
  const parties: string[] = [];
  const patterns = [/(?:原告|申请人|上诉人)[:\s]*([^\n，,。；;]{2,40})/g, /(?:被告|被申请人|被上诉人)[:\s]*([^\n，,。；;]{2,40})/g];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const value = clean(m[1]);
      if (value && !parties.includes(value)) parties.push(value);
    }
  }
  return parties.length ? parties : null;
}

function ymd(y: string, m: string, d: string): string | null {
  const yyyy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  if (!Number.isInteger(yyyy) || yyyy < 1900 || yyyy > 2199 || mm < 1 || mm > 12 || dd < 1) return null;
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (date.getUTCFullYear() !== yyyy || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function cnNumber(input: string): number {
  const s = input.replace(/两/g, "二").replace(/〇/g, "零");
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === "十") return 10;
  if (s.startsWith("十")) return 10 + (digits[s[1]] ?? 0);
  if (s.includes("十")) {
    const [tens, ones] = s.split("十");
    return (digits[tens] ?? 1) * 10 + (digits[ones] ?? 0);
  }
  return digits[s] ?? Number(s);
}

function clean(value: string): string {
  return value.replace(/[\s　]+/g, " ").replace(/[。；;，,]+$/g, "").trim();
}

/** PDF 供视觉模型使用时先渲染首页，不把 PDF 冒充 image_url。 */
export async function summonsVisionImage(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!isPdfBuffer(bytes)) return `data:${file.type};base64,${bytes.toString("base64")}`;
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const png = await renderPageAsImage(pdf, 1, { canvasImport: () => import("@napi-rs/canvas"), scale: 1.5 });
    return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  } finally { await pdf.destroy(); }
}

/** 模型输出也走同样的日期/时刻检查，异常字段留空供人工填写。 */
export function normalizeSummonsFields(value: unknown): ParsedSummons {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const str = (key: string, max = 200) => typeof data[key] === "string" ? data[key].trim().slice(0, max) || null : null;
  const date = str("hearingDate");
  const time = str("hearingTime");
  return {
    hearingDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseChineseDate(date) : null,
    hearingTime: time && /^\d{2}:\d{2}$/.test(time) ? parseChineseTime(time) : null,
    courtRoom: str("courtRoom", 40), caseNumber: str("caseNumber", 80), judge: str("judge", 40),
    parties: Array.isArray(data.parties) ? data.parties.filter((item): item is string => typeof item === "string" && !!item.trim()).slice(0, 20).map(item => item.trim().slice(0, 200)) : null
  };
}
