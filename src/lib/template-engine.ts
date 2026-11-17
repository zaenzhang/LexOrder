/**
 * v0.8 文档模板引擎
 *
 * 流程：
 *   1. buildContext(matterId, userId, overrides?) 从 DB 拼装变量上下文
 *   2. renderDocxBuffer(templateBuffer, context) 用 docxtemplater 渲染
 *   3. inspectTemplateFields 沿真实编译/求值作用域准备本稿字段
 *
 * 模板变量使用双大括号语法：{{firm.name}} / {{client.idNumber}}。
 */
import PizZip from "pizzip";
import Docxtemplater, { type DXT } from "docxtemplater";
import InspectModule from "docxtemplater/js/inspect-module";
import { shParts, shDayKey } from "@/lib/ui/sh-time";
import { prisma } from "./prisma";
import { ActionError } from "@/lib/action-error";
import type { Prisma, TemplateCategory } from "@prisma/client";
import { type TemplateField, type TemplateSelection, type TemplateSubjects, type TemplateSubjectKey } from "./template-render-fields";
import { procedureTypeLabel } from "./enums";
import { decryptIdNumber } from "./clients/id-number-crypto";

const FIRM_NAME_KEY = "firmName";
const FIRM_ADDRESS_KEY = "firmAddress";
const FIRM_PHONE_KEY = "firmPhone";

export interface PartySnapshot {
  name: string;
  idNumber: string;
  phone: string;
  address: string;
  legalRep: string;
}

export interface RenderContext {
  firm: { name: string; address: string; phone: string };
  today: string; // YYYY-MM-DD
  todayCN: string; // 二〇二六年五月二十三日
  lawyer: { name: string; phone: string };
  matter: {
    code: string;
    title: string;
    category: string;
    causeText: string;
    intakeDate: string;
    claimAmount: string; // 中文金额 / "—"
    ourStanding: string;
  };
  client: PartySnapshot;
  opposing: PartySnapshot; // 本次明确选中的对方
  third: PartySnapshot; // 本次明确选中的第三人
  proceeding: { type: string; caseNo: string; court: string };
  execution: { basis: string; basisNo: string; basisDate: string };
  // 数组循环用
  plaintiffs: PartySnapshot[];
  defendants: PartySnapshot[];
  thirds: PartySnapshot[];
  [extra: string]: unknown;
}

const EMPTY_PARTY: PartySnapshot = {
  name: "",
  idNumber: "",
  phone: "",
  address: "",
  legalRep: ""
};

const STANDING_CN: Record<string, string> = {
  PLAINTIFF: "原告",
  JOINT_PLAINTIFF: "共同原告",
  DEFENDANT: "被告",
  JOINT_DEFENDANT: "共同被告",
  THIRD_PARTY: "第三人",
  APPELLANT: "上诉人",
  APPELLEE: "被上诉人",
  RETRIAL_APPLICANT: "再审申请人",
  RETRIAL_RESPONDENT: "再审被申请人",
  ENFORCEMENT_APPLICANT: "申请执行人",
  EXECUTED_PERSON: "被执行人",
  COUNTERCLAIM_PLAINTIFF: "反诉原告",
  COUNTERCLAIM_DEFENDANT: "反诉被告",
  CRIMINAL_DEFENDANT: "被告人",
  CRIMINAL_VICTIM: "被害人",
  PRIVATE_PROSECUTOR: "自诉人",
  CRIMINAL_INCIDENTAL_PLAINTIFF: "附带民事诉讼原告人",
  ARBITRATION_CLAIMANT: "仲裁申请人",
  ARBITRATION_RESPONDENT: "仲裁被申请人",
  ADMIN_PLAINTIFF: "行政诉讼原告",
  ADMIN_DEFENDANT: "行政诉讼被告",
  ADMIN_RECONSIDERATION_APPLICANT: "行政复议申请人",
  ADMIN_RECONSIDERATION_RESPONDENT: "行政复议被申请人",
  NON_LITIGATION_PARTY: "项目当事人"
};

const CATEGORY_CN: Record<string, string> = {
  CIVIL_COMMERCIAL: "民商事",
  CRIMINAL: "刑事",
  ADMINISTRATIVE: "行政",
  NON_LITIGATION: "非诉",
  LEGAL_COUNSEL: "法律顾问",
  SPECIAL_PROJECT: "专项法律服务"
};

function toCNDate(d: Date): string {
  const cnDigits = "〇一二三四五六七八九";
  // 入参为瞬间（当前时刻），年月日按上海日历日取（容器为 UTC 时本地取日会差一天）
  const { y: yNum, m, d: day } = shParts(d);
  const y = String(yNum).split("").map((c) => cnDigits[+c]).join("");
  const cnNum = (n: number) => {
    if (n <= 10) return ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][n];
    if (n < 20) return "十" + cnDigits[n - 10];
    if (n < 30) return "二十" + (n === 20 ? "" : cnDigits[n - 20]);
    return "三十" + (n === 30 ? "" : cnDigits[n - 30]);
  };
  return `${y}年${cnNum(m)}月${cnNum(day)}日`;
}

function partyToSnapshot(p: {
  name: string;
  idNumber: string | null;
  phone: string | null;
  address: string | null;
  legalRep: string | null;
}): PartySnapshot {
  return {
    name: p.name,
    idNumber: p.idNumber ?? "",
    phone: p.phone ?? "",
    address: p.address ?? "",
    legalRep: p.legalRep ?? ""
  };
}

async function getFirmInfo(db: Prisma.TransactionClient): Promise<{ name: string; address: string; phone: string }> {
  const rows = await db.systemSetting.findMany({
    where: { key: { in: [FIRM_NAME_KEY, FIRM_ADDRESS_KEY, FIRM_PHONE_KEY] } }
  });
  const dict = new Map(rows.map((r) => [r.key, (r.value as { value?: string })?.value ?? ""]));
  return {
    name: dict.get(FIRM_NAME_KEY) || "【请配置律所名称】",
    address: dict.get(FIRM_ADDRESS_KEY) || "",
    phone: dict.get(FIRM_PHONE_KEY) || ""
  };
}

/** Reads the exact parties and procedures offered by the current matter. */
export async function templateMatterInputs(matterId: string, templateCategory?: TemplateCategory, db: Prisma.TransactionClient = prisma) {
  const matter = await db.matter.findUnique({
    where: { id: matterId, deletedAt: null },
    include: {
      cause: { select: { name: true } },
      primaryClient: true,
      clientLinks: { include: { client: true }, orderBy: { addedAt: "asc" } },
      parties: { orderBy: [{ role: "asc" }, { ordinal: "asc" }, { id: "asc" }] },
      procedures: { orderBy: { order: "asc" }, where: {
        engagement: "ENGAGED",
        ...(templateCategory === "EXECUTION" ? { type: { in: ["ENFORCEMENT", "ENFORCEMENT_OBJECTION"] as ("ENFORCEMENT" | "ENFORCEMENT_OBJECTION")[] } } : {}),
      } },
    },
  });
  if (!matter) throw new ActionError("案件不存在");
  const clients = [...new Map([
    ...(matter.primaryClient ? [[matter.primaryClient.id, matter.primaryClient] as const] : []),
    ...matter.clientLinks.map(link => [link.client.id, link.client] as const),
  ]).values()].filter(client => !client.deletedAt);
  const opposing = matter.parties.filter(party => party.role === "OPPOSING_PARTY");
  const thirds = matter.parties.filter(party => party.role === "THIRD_PARTY");
  const choices = {
    clients: clients.map(client => ({ id: client.id, label: client.name })),
    opposing: opposing.map(party => ({ id: party.id, label: party.name })),
    thirds: thirds.map(party => ({ id: party.id, label: party.name })),
    procedures: matter.procedures.map(procedure => ({ id: procedure.id, label: [procedure.customLabel || procedureTypeLabel[procedure.type], procedure.caseNumber].filter(Boolean).join(" · ") })),
  };
  // A unique choice can be presented as the initial selection. Ambiguous targets stay unselected.
  const selection: TemplateSelection = {
    clientId: clients.find(client => client.id === matter.primaryClient?.id)?.id ?? (clients.length === 1 ? clients[0].id : null),
    opposingPartyId: opposing.length === 1 ? opposing[0].id : null,
    thirdPartyId: thirds.length === 1 ? thirds[0].id : null,
    procedureId: matter.procedures.length === 1 ? matter.procedures[0].id : null,
  };
  return { matter, clients, opposing, thirds, choices, selection };
}

/** Only assembles this document's values; preparation and rendering never edit master data. */
export async function buildContext(opts: {
  matterId?: string;
  userId: string;
  selection?: TemplateSelection;
  overrides?: Record<string, string>;
  variables?: string[];
  templateCategory?: TemplateCategory;
  db?: Prisma.TransactionClient;
  matterInputs?: Awaited<ReturnType<typeof templateMatterInputs>>;
}): Promise<RenderContext> {
  const db = opts.db ?? prisma;
  const today = new Date();
  const firm = await getFirmInfo(db);
  const user = await db.user.findUnique({ where: { id: opts.userId }, select: { name: true, phone: true } });
  const context: RenderContext = {
    firm, today: shDayKey(today), todayCN: toCNDate(today),
    lawyer: { name: user?.name ?? "", phone: user?.phone ?? "" },
    matter: { code: "", title: "", category: "", causeText: "", intakeDate: "", claimAmount: "—", ourStanding: "" },
    client: { ...EMPTY_PARTY }, opposing: { ...EMPTY_PARTY }, third: { ...EMPTY_PARTY },
    proceeding: { type: "", caseNo: "", court: "" }, execution: { basis: "", basisNo: "", basisDate: "" },
    plaintiffs: [], defendants: [], thirds: [],
  };
  if (opts.matterId) {
    const inputs = opts.matterInputs ?? await templateMatterInputs(opts.matterId, opts.templateCategory, db);
    const { matter, clients, opposing, thirds } = inputs;
    const selection = opts.selection ?? inputs.selection;
    function selected<T extends { id: string }>(list: T[], id: string | null, label: string): T | undefined {
      if (!id) return undefined;
      const item = list.find(value => value.id === id);
      if (!item) throw new ActionError(`${label}已不属于当前案件或不适用于此模板，请重新选择`);
      return item;
    }
    const client = selected(clients, selection.clientId, "委托人");
    const opponent = selected(opposing, selection.opposingPartyId, "对方当事人");
    const third = selected(thirds, selection.thirdPartyId, "第三人");
    const procedure = selected(matter.procedures, selection.procedureId, "程序");
    context.matter = {
      code: matter.internalCode, title: matter.title,
      category: CATEGORY_CN[matter.category] ?? matter.category,
      causeText: matter.cause?.name ?? matter.causeFreeText ?? "",
      intakeDate: matter.intakeDate ? shDayKey(matter.intakeDate) : "",
      claimAmount: matter.claimAmount ? `${matter.claimAmount} 元` : "—",
      ourStanding: matter.ourStanding ? STANDING_CN[matter.ourStanding] ?? matter.ourStanding : "",
    };
    if (client) context.client = partyToSnapshot({ ...client, idNumber: decryptIdNumber(client.idNumber) });
    if (opponent) context.opposing = partyToSnapshot(opponent);
    if (third) context.third = partyToSnapshot(third);
    context.proceeding = { type: procedure?.type ?? "", caseNo: procedure?.caseNumber ?? "", court: procedure?.handlingAgency ?? "" };
    context.plaintiffs = matter.parties.filter(party => party.role === "CLIENT_PARTY").map(partyToSnapshot);
    if (!context.plaintiffs.length && client) context.plaintiffs = [{ ...context.client }];
    context.defendants = opposing.map(partyToSnapshot);
    context.thirds = thirds.map(partyToSnapshot);
  }
  return applyTemplateValues(context, opts.overrides ?? {}, opts.variables, opts.templateCategory);
}

/** Apply the actual scalar template fields to this in-memory context. */
export function applyTemplateValues(context: RenderContext, overrides: Record<string, string>, variables?: string[], templateCategory?: TemplateCategory): RenderContext {
  for (const [path, value] of Object.entries(overrides)) {
    if (variables && !variables.includes(path)) throw new ActionError("补填字段不属于当前模板，请重新核对");
    if (path.startsWith("execution.") && templateCategory !== "EXECUTION") throw new ActionError("当前模板不接受执行依据字段");
    const parts = path.split(".");
    if (!safeTemplatePath(path)) throw new ActionError("模板字段路径无效");
    const existing = readTemplatePath(context, path);
    if (existing !== null && typeof existing === "object") throw new ActionError("当事人列表须从实际案件主体选择，不能作为文本替换");
    let target: Record<string, unknown> = context;
    for (const part of parts.slice(0, -1)) {
      if (Array.isArray(target) && (!/^(0|[1-9]\d*)$/.test(part) || !Object.hasOwn(target, part))) throw new ActionError("只能补填当前实际成员的字段");
      const node = target[part];
      if (node === undefined && !/^\d+$/.test(part)) target[part] = {};
      else if (!node || typeof node !== "object") throw new ActionError("模板字段路径与现值不匹配");
      target = target[part] as Record<string, unknown>;
    }
    if (Array.isArray(target) && (!/^(0|[1-9]\d*)$/.test(parts.at(-1)!) || !Object.hasOwn(target, parts.at(-1)!))) throw new ActionError("只能补填当前实际成员的字段");
    target[parts.at(-1)!] = value.trim();
  }
  return context;
}

/**
 * docxtemplater 错误结构（Errors[].properties.explanation 含具体 tag）。
 * 用类型断言读取，避免引入额外依赖。
 */
interface DocxTagError {
  message?: string;
  properties?: {
    id?: string;
    explanation?: string;
    xtag?: string;
    file?: string;
  };
}

interface DocxMultiError extends Error {
  properties?: {
    errors?: DocxTagError[];
    id?: string;
    explanation?: string;
  };
}

function formatDocxError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as DocxMultiError;
  const items = e.properties?.errors ?? [e as unknown as DocxTagError];
  const lines: string[] = [];
  for (const it of items) {
    const tag = it.properties?.xtag ?? it.properties?.id ?? "?";
    const reason = it.properties?.explanation ?? it.message ?? "未知";
    lines.push(`[${tag}] ${reason}`);
  }
  return lines.join("\n");
}

/**
 * 渲染 docx：传入模板 Buffer + 上下文 → 返回填充后的 Buffer。
 * 模板用 {{var}} 语法（双大括号），避免与 docx 内嵌 "{" 冲突。
 *
 * 出错时抛出含具体 tag / 原因的中文异常，方便律师定位是哪个模板字段坏了。
 */
function compileDocx(templateBuffer: Buffer, options: DXT.ConstructorOptions = {}): Docxtemplater<PizZip> {
  let zip: PizZip;
  try {
    zip = new PizZip(templateBuffer);
  } catch (err) {
    throw new ActionError(`模板文件损坏，无法解压：${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    return new Docxtemplater(zip, {
      paragraphLoop: true, linebreaks: true, errorLogging: false,
      delimiters: { start: "{{", end: "}}" },
      // Ordinary paths only; the library's ScopeManager supplies loop and parent semantics.
      parser: tag => ({ get: scope => readTemplatePath(scope, tag.trim()) }),
      nullGetter: () => "", ...options,
    });
  } catch (err) {
    throw new ActionError(`模板格式有误：\n${formatDocxError(err)}`);
  }
}

function renderDocx(doc: Docxtemplater<PizZip>, context: RenderContext) {
  try { doc.render(context); }
  catch (error) { throw new ActionError(`模板渲染失败：\n${formatDocxError(error)}`); }
}

/** Pure rendering also serves archive catalogs, whose optional cells may be empty. */
export function renderDocxBuffer(templateBuffer: Buffer, context: RenderContext): Buffer {
  const doc = compileDocx(templateBuffer);
  renderDocx(doc, context);
  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
}

function safeTemplatePath(path: string): boolean {
  return path.split(".").every((part, index) => (index > 0 && /^(0|[1-9]\d*)$/.test(part) || /^[A-Za-z_$][\w$]*$/.test(part))
    && !["__proto__", "constructor", "prototype"].includes(part));
}

function templateTags(inspector: InspectModule): string[] {
  const found = new Set<string>();
  function collect(parts: DXT.Part[]) {
    for (const part of parts) {
      const path = part.value.trim();
      if (path !== "." && !safeTemplatePath(path)) throw new ActionError(`模板字段路径无效：${path}`);
      found.add(path);
      if (part.subparsed) collect(part.subparsed);
    }
  }
  collect(inspector.getAllStructuredTags());
  return [...found].sort();
}

/** Values used for concurrency checks; collection members are identified separately. */
function originalFieldValue(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify({ type: "array", length: value.length });
  if (value !== null && typeof value === "object") return JSON.stringify({ type: "object" });
  return JSON.stringify({ type: typeof value, value });
}

/**
 * Observe the installed compiler's actual evaluation, including its own ScopeManager.
 * Each pass receives a complete immutable input, so a later root placeholder's value
 * also participates in earlier loops/fallbacks. There is no second loop interpreter.
 * Hidden drafts are discarded from the final context; only the final pass can be saved.
 */
export function inspectTemplateFields(templateBuffer: Buffer, base: RenderContext,
  overrides: Record<string, string> = {}, templateCategory?: TemplateCategory) {
  function observe(context: RenderContext) {
    const paths = new WeakMap<object, string>();
    function index(value: unknown, path = "") {
      if (!value || typeof value !== "object") return;
      paths.set(value, path);
      for (const [key, child] of Object.entries(value)) index(child, path ? `${path}.${key}` : key);
    }
    index(context);
    const fields = new Map<string, TemplateField>();
    const inspector = new InspectModule();
    const doc = compileDocx(templateBuffer, { modules: [inspector], parser: tag => ({ get(scope: unknown, evaluation: DXT.ParserContext) {
    const tagPath = tag.trim();
    const value = readTemplatePath(scope, tagPath);
    // Let ScopeManager finish its real parent lookup before selecting the storage path.
    if (value == null && evaluation.num > 0) return value;
    let owner = scope;
    if (value == null) {
      // A completely missing local scalar is filled on the real innermost object,
      // unless an existing parent owns its first segment (e.g. client.phone).
      const scopes = [...evaluation.scopeList].reverse().filter(item => item && typeof item === "object");
      owner = scopes.find(item => Object.hasOwn(item, tagPath.split(".")[0])) ?? scopes[0] ?? context;
    }
    const prefix = owner && typeof owner === "object" ? paths.get(owner) : undefined;
    if (prefix === undefined) throw new ActionError("模板字段没有可核对的实际主体");
    const path = tagPath === "." ? prefix : prefix ? `${prefix}.${tagPath}` : tagPath;
    const editable = !!path && safeTemplatePath(path) && (value == null || typeof value !== "object");
    const controlsScope = evaluation.meta.part.module === "loop";
    const prior = fields.get(path);
    fields.set(path, { path, value: "", editable, required: editable && (!controlsScope || !!prior?.required),
      missing: false, controlsScope: controlsScope || !!prior?.controlsScope });
    return value;
    } }) });
    templateTags(inspector); // Current and already-installed templates use the same compiled nodes.
    renderDocx(doc, context);
    const absentControls = [...fields.values()].filter(field => field.controlsScope && readTemplatePath(base, field.path) == null);
    for (const field of fields.values()) {
      const value = readTemplatePath(context, field.path);
      field.value = value == null ? "" : Array.isArray(value) ? `${value.length} 项` : typeof value === "object" ? "已关联对象" : String(value);
      field.missing = field.required && !field.value.trim();
      // Filling a previously absent object's child can activate its surrounding block.
      field.controlsScope ||= absentControls.some(control => !!control.path && field.path.startsWith(`${control.path}.`));
    }
    return { fields, doc };
  }
  let context = applyTemplateValues(structuredClone(base), overrides, undefined, templateCategory);
  let observed = observe(context);
  const appliedOverrides = Object.fromEntries(Object.entries(overrides)
    .filter(([path]) => observed.fields.get(path)?.editable).map(([path, value]) => [path, value.trim()]));
  if (Object.keys(appliedOverrides).length !== Object.keys(overrides).length) {
    context = applyTemplateValues(structuredClone(base), appliedOverrides, undefined, templateCategory);
    observed = observe(context);
    if (Object.keys(overrides).some(path => !!observed.fields.get(path)?.editable !== Object.hasOwn(appliedOverrides, path))) {
      throw new ActionError("补填内容与模板条件相互影响，请调整模板条件后重新核对字段");
    }
  }
  return { context, fields: [...observed.fields.values()], appliedOverrides,
    expectedValues: Object.fromEntries([...observed.fields.keys()].map(path => [path, originalFieldValue(readTemplatePath(base, path))])),
    render: () => observed.doc.getZip().generate({ type: "nodebuffer" }) as Buffer };
}

/** Exact identities from the very same query/order used by buildContext, not display names. */
export function templateSubjects(inputs: Awaited<ReturnType<typeof templateMatterInputs>>, selection: TemplateSelection,
  paths: string[]): TemplateSubjects {
  const plaintiffs = inputs.matter.parties.filter(party => party.role === "CLIENT_PARTY");
  const all: Required<TemplateSubjects> = {
    client: selection.clientId ? [`Client:${selection.clientId}`] : [],
    opposing: selection.opposingPartyId ? [`Party:${selection.opposingPartyId}`] : [],
    third: selection.thirdPartyId ? [`Party:${selection.thirdPartyId}`] : [],
    proceeding: selection.procedureId ? [`MatterProcedure:${selection.procedureId}`] : [],
    plaintiffs: plaintiffs.length ? plaintiffs.map(party => `Party:${party.id}`) : selection.clientId ? [`Client:${selection.clientId}`] : [],
    defendants: inputs.opposing.map(party => `Party:${party.id}`), thirds: inputs.thirds.map(party => `Party:${party.id}`),
  };
  return Object.fromEntries([...new Set(paths.map(path => path.split(".")[0]))]
    .filter((key): key is TemplateSubjectKey => Object.hasOwn(all, key)).map(key => [key, all[key]]));
}

export function readTemplatePath(obj: unknown, path: string): unknown {
  if (path === ".") return obj;
  const parts = path.split(".");
  if (parts.some(p => !p || ["__proto__", "constructor", "prototype"].includes(p))) return undefined;
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && Object.prototype.hasOwnProperty.call(cur, p)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Compile actual DOCX nodes (including split runs, headers and footers).
 * This index is metadata; required fields come from inspectTemplateFields, never this flat list.
 */
export function extractDocxVariables(buffer: Buffer): string[] {
  const inspector = new InspectModule();
  compileDocx(buffer, { modules: [inspector] });
  return templateTags(inspector);
}
