import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fragmentLines, inspectAiObservationResult } from "../../../src/server/evidence/ai-observation-contract";
import {
  observationExtractionSchema, unpackObservationDraft,
} from "../../../src/server/evidence/observation-extraction-skill";

const archivePath = new URL("./prompt-ab-results.json", import.meta.url);
const outputDirectory = new URL("../../../storage/", import.meta.url);
const reportPath = new URL("observation-prompt-ab-rerun.json", outputDirectory);
const archive = JSON.parse(await readFile(archivePath, "utf8"));
const prompts = { "/9": archive.prompts["/9"], "/11": archive.prompts["/11"] };
type Version = keyof typeof prompts;

const cases = [
  { id: "loan", title: "借款交付", fragments: [
    ["转账回单", "EVIDENCE", "交易日期：2024年3月8日。付款人：赵甲，收款人：钱乙，转账金额：人民币１２万元。"],
    ["答辩状", "PLEADING", "答辩人钱乙称：本人否认收到赵甲转来的12万元，但认可收到赵甲另笔2万元。"],
    ["证据目录与质证", "EVIDENCE", "原告提交回单复印件，拟证明借款本金已全部交付。被告仅对回单真实性无异议，对证明目的不认可。"],
  ] },
  { id: "equipment", title: "设备采购", fragments: [
    ["签收单", "EVIDENCE", "交接日期：2024年4月8日。启乙公司签收两台机床，签收单注明：数量核对无误，性能待验，保留异议。"],
    ["买方答辩", "PLEADING", "买方辩称：从未通过性能验收，但认可收到了两台设备。"],
    ["买卖合同", "EVIDENCE", "合同约定：双方盖章后生效，验收合格后应付设备尾款24万元。付款单尚未开具。"],
  ] },
  { id: "labor", title: "劳动补偿", fragments: [
    ["双方陈述", "PLEADING", "原告诉称补偿已经支付。\n被告辩称从未收到补偿。"],
    ["通知送达回执", "EVIDENCE", "送达日期：2024年5月6日。员工已收悉通知，本回执未确认工资金额。"],
    ["工资表", "EVIDENCE", "2024年4月工资表列明应付工资9,600元。该表仅供核账。"],
  ] },
  { id: "construction", title: "工程结算", fragments: [
    ["项目结算单", "EVIDENCE", "结算日期：2024年6月。确认未付余额：480,000.00元。"],
    ["复验争议答辩", "PLEADING", "施工方称已完成整改。监理明确否认已通过复验。"],
    ["监理回函", "EVIDENCE", "本函仅确认报验资料收悉，尚未组织复验。\n补录截图仅供参考，以签章原件为准。"],
  ] },
  { id: "lease", title: "租赁解除", fragments: [
    ["租赁合同", "EVIDENCE", "租赁期限自2024年1月1日至2024年12月31日。\n签署日期：2023年12月25日。"],
    ["承租方答辩", "PLEADING", "承租方辩称未收到解除通知，但确认收到催缴函。"],
    ["短信截图", "EVIDENCE", "出租方提交短信截图，拟证明已解除合同。送达页面仅显示发送成功，未显示收悉。"],
    ["租金条款", "EVIDENCE", "租金约定每期不超过3万元。"],
  ] },
  { id: "insurance", title: "保险赔款", fragments: [
    ["银行流水", "EVIDENCE", "交易日期：2024年8月4日。银行记载：保险方向维修方实际汇款USD 3,200。"],
    ["维修方答辩", "PLEADING", "维修方称从未收到保险方另笔USD 1,800。"],
    ["付款指令状态", "EVIDENCE", "另笔付款指令已受理、随后作废，未显示到账。原始回单待调取。"],
    ["赔款沟通记录", "PLEADING", "理赔方称约2024年6月实际支付约5万元。"],
  ] },
] as const;

type Candidate = ReturnType<typeof inspectAiObservationResult>["candidates"][number];
type Metric = "证据措辞" | "否认" | "金额" | "日期";
type Check = { metric: Metric; label: string; pass: boolean };
function score(sample: typeof cases[number], rows: Candidate[]): Check[] {
  const checks: Check[] = [];
  function add(metric: Metric, label: string, pass: boolean) { checks.push({ metric, label, pass }); }
  const at = (fragment: number) => rows.filter(row => row.fragment === fragment);
  const cited = (row: Candidate) => row.data.excerpt?.text ?? "";
  const quotes = (fragment: number, ...words: string[]) =>
    words.every(word => at(fragment).some(row => cited(row).includes(word)));
  const actual = (row: Candidate) => row.data.amount?.nature === "ACTUAL_TRANSFER" ||
    Boolean(row.data.relations?.some(relation => relation.kind === "PAYS_TO"));
  function denial(fragment: number, marker: string, assertiveTitle: RegExp, amountSensitive = false) {
    const targets = at(fragment).filter(row => cited(row).includes(marker));
    add("否认", marker + "归属及极性", targets.length > 0 && targets.every(row =>
      row.data.statement === "PARTY_STATEMENT" && !assertiveTitle.test(row.hint?.title ?? "") &&
      (!amountSensitive || !actual(row))));
  }
  function amount(fragment: number, value: string, currency: string, nature: string) {
    add("金额", [fragment, currency, value, nature].join(" "), at(fragment).some(({ data }) =>
      data.amount?.nature === nature && data.amount.value?.value === value && data.amount.value.currency === currency));
  }
  function date(fragment: number, role: string | null, value: object) {
    add("日期", [fragment, role ?? "不限角色", JSON.stringify(value)].join(" "), at(fragment).some(({ data: { date } }) => {
      if (!date || (role !== null && date.role !== role)) return false;
      const fields = new Map(Object.entries(date.value));
      return Object.entries(value).every(([key, expected]) => fields.get(key) === expected);
    }));
  }
  const exact = (day: string) => ({ precision: "EXACT", day });
  switch (sample.id) {
    case "loan": {
      add("证据措辞", "复印件和拟证明", quotes(3, "复印件", "拟证明") && at(3).every(row => !actual(row)));
      add("证据措辞", "只承认真实性，证明目的有争议", quotes(3, "真实性无异议", "证明目的不认可"));
      denial(2, "否认收到", /^(?!.*(?:否认|未|争议|待核)).*(?:收款|交付|支付|转账)/u, true);
      amount(1, "120000", "CNY", "ACTUAL_TRANSFER");
      add("金额", "另笔认可2万元独立提取", at(2).some(row => !cited(row).includes("否认收到") &&
        cited(row).includes("另笔2万元") && row.data.amount?.value?.currency === "CNY" &&
        row.data.amount.value.value === "20000" && row.data.amount.nature === "ACTUAL_TRANSFER"));
      date(1, "OCCURRENCE", exact("2024-03-08"));
      break;
    }
    case "equipment": {
      add("证据措辞", "签收保留待验和异议", quotes(1, "签收", "性能待验", "保留异议") &&
        at(1).every(row => !/验收(?:通过|合格|完成)/u.test(row.hint?.title ?? "")));
      add("证据措辞", "生效条件和付款条件保留", quotes(3, "盖章后生效", "验收合格后应付"));
      denial(2, "从未通过性能验收", /^(?!.*(?:未|否认|争议|待核)).*(?:验收通过|验收合格|验收完成)/u);
      add("金额", "24万元条件性尾款未记为实付", quotes(3, "24万元") && at(3).every(row => !actual(row)));
      date(1, "OCCURRENCE", exact("2024-04-08"));
      break;
    }
    case "labor": {
      add("证据措辞", "收悉回执未确认金额", quotes(2, "收悉", "未确认工资金额"));
      add("证据措辞", "工资表仅供核账", quotes(3, "仅供核账"));
      denial(1, "从未收到补偿", /^(?!.*(?:未|否认|争议|待核)).*(?:收到|实付|收款)/u, true);
      add("金额", "应付工资未被当成实付", quotes(3, "9,600元") && at(3).every(row => !actual(row)));
      date(2, "SERVICE", exact("2024-05-06"));
      date(3, null, { precision: "MONTH", month: "2024-04" });
      break;
    }
    case "construction": {
      add("证据措辞", "报验资料收悉，复验尚未组织", quotes(3, "资料收悉", "尚未组织复验"));
      add("证据措辞", "补录截图仅供参考", quotes(3, "补录截图", "仅供参考", "以签章原件为准"));
      denial(2, "否认已通过复验", /^(?!.*(?:未|否认|争议|待核)).*(?:复验通过|复验合格|通过复验)/u);
      amount(1, "480000", "CNY", "BALANCE");
      date(1, "OCCURRENCE", { precision: "MONTH", month: "2024-06" });
      break;
    }
    case "lease": {
      add("证据措辞", "截图拟证明，发送状态没有扩大", quotes(3, "短信截图", "拟证明", "未显示收悉") &&
        at(3).every(row => row.data.date?.role !== "SERVICE"));
      denial(2, "未收到解除通知", /^(?!.*(?:未|否认|争议|待核)).*(?:收到解除|解除通知送达|确认解除)/u);
      add("金额", "保留租金上限，未生成定值", quotes(4, "不超过3万元") && at(4).every(row => !row.data.amount?.value));
      date(1, "AGREEMENT", { precision: "RANGE", start: "2024-01-01", end: "2024-12-31" });
      date(1, "SIGNATURE", exact("2023-12-25"));
      break;
    }
    case "insurance": {
      add("证据措辞", "指令作废、未到账、原始回单待调取", quotes(3, "作废", "未显示到账", "待调取") &&
        at(3).every(row => !actual(row)));
      denial(2, "从未收到", /^(?!.*(?:未|否认|争议|待核)).*(?:收款|支付|汇款|到账|收到)/u, true);
      amount(1, "3200", "USD", "ACTUAL_TRANSFER");
      add("金额", "约5万元保留原文，未生成定值", at(4).some(row => row.data.amount?.text === "约5万元" &&
        row.data.amount.value === null) && at(4).every(row => !row.data.amount?.value));
      date(1, "OCCURRENCE", exact("2024-08-04"));
      add("日期", "保留约2024年6月，未强制定为月份", at(4).some(row =>
        row.data.date?.text === "约2024年6月" && row.data.date.value.precision === "UNKNOWN") &&
        at(4).every(row => !row.data.date || row.data.date.value.precision === "UNKNOWN"));
      break;
    }
  }
  return checks;
}

const format = { name: "lexorder_observations", strict: true, schema: observationExtractionSchema };
const providers = [
  { name: "OpenAI", model: "gpt-6.2-sol", url: "https://api.openai.com/v1/chat/completions",
    environmentKey: "OPENAI_API_KEY", extraSystem: "",
    params: { reasoning_effort: "low", max_completion_tokens: 4200, response_format: { type: "json_schema", json_schema: format } } },
  { name: "DeepSeek", model: "deepseek-flash", url: "https://api.deepseek.com/chat/completions",
    environmentKey: "DEEPSEEK_API_KEY", extraSystem: "输出结构：" + JSON.stringify(observationExtractionSchema),
    params: { thinking: { type: "disabled" }, temperature: 0, max_tokens: 4200, response_format: { type: "json_object" } } },
] as const;
const rounds = 2;
const reportedModel = (name: string, model?: string) => model ?? name;
await mkdir(outputDirectory, { recursive: true });

if (process.argv.includes("--rescore")) {
  const result = archive;
  if (result.rows.length !== result.expectedRequests) throw new Error("Wait for all requests before rescoring");
  for (const row of result.rows) {
    const sample = cases.find(sample => sample.id === row.sample);
    if (!sample) throw new Error("Unknown sample " + row.sample);
    row.checks = score(sample, row.candidates ?? []);
  }
  await writeFile(reportPath, JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

async function run(provider: typeof providers[number], sample: typeof cases[number], version: Version, round: number) {
  const start = performance.now();
  const key = process.env[provider.environmentKey];
  const identity = { provider: provider.name, requestedModel: provider.model, sample: sample.id, version, round };
  if (!key) throw new Error("Missing " + provider.environmentKey);
  const fragments = sample.fragments.map(([material, category, text]) => ({ material, category, text }));
  const messages = [
    ...(provider.extraSystem ? [{ role: "system", content: provider.extraSystem }] : []),
    { role: "system", content: prompts[version] },
    { role: "user", content: JSON.stringify({ title: sample.title, fragments: fragments.map(({ material, category, text }, index) => ({
      index: index + 1, material, category, lines: fragmentLines(text).map(({ line, text }) => ({ line, text })),
    })) }) },
  ];
  const elapsed = () => Math.round(performance.now() - start);
  try {
    const response = await fetch(provider.url, {
      method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({ model: provider.model, ...provider.params, messages }),
    });
    const result = await response.json();
    const choice = result.choices?.[0];
    const usage = result.usage;
    const responseData = {
      ...identity, model: reportedModel(provider.model, result.model), fingerprint: result.system_fingerprint ?? null,
      requestId: response.headers.get("x-request-id"), completionId: result.id ?? null, http: response.status,
      finish: choice?.finish_reason ?? null, elapsedMs: elapsed(),
      tokens: usage ? { input: usage.prompt_tokens, output: usage.completion_tokens, total: usage.total_tokens,
        cached: usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? null,
        reasoning: usage.completion_tokens_details?.reasoning_tokens ?? null } : null,
    };
    if (!response.ok) return { ...responseData, status: "HTTP", error: result.error?.code ?? result.error?.type,
      checks: score(sample, []) };
    if (choice?.finish_reason !== "stop" || !choice.message?.content?.trim() || choice.message?.refusal)
      return { ...responseData, status: "INCOMPLETE", checks: score(sample, []) };
    const modelText = choice.message.content as string;
    try {
      const inspected = inspectAiObservationResult(unpackObservationDraft(JSON.parse(modelText)), fragments.map(fragment =>
        ({ ...fragment, start: 0 })));
      return { ...responseData, status: "COMPLETE", checks: score(sample, inspected.candidates),
        rejected: inspected.rejected, skippedFields: inspected.skippedFields, candidates: inspected.candidates };
    } catch {
      return { ...responseData, status: "INVALID", modelText, checks: score(sample, []) };
    }
  } catch (error) {
    return { ...identity, status: "TRANSPORT", elapsedMs: elapsed(),
      error: error instanceof Error ? error.name : "UnknownError", checks: score(sample, []) };
  }
}

const startedAt = new Date().toISOString();
const tasks = providers.flatMap(provider => [...Array(rounds)].flatMap((_, index) => cases.flatMap((sample, sampleIndex) => {
  const order: Version[] = (index + sampleIndex) % 2 ? ["/11", "/9"] : ["/9", "/11"];
  return order.map(version => ({ provider, sample, version, round: index + 1 }));
})));
const rows: Awaited<ReturnType<typeof run>>[] = [];
const save = () => writeFile(reportPath, JSON.stringify({ startedAt, updatedAt: new Date().toISOString(),
  prompts, cases, providers: providers.map(({ name, model, params }) => ({ name, model, params })), expectedRequests: tasks.length, rows }, null, 2) + "\n");
// Parallelize each small wave across providers while retaining alternation within each comparison.
for (let pos = 0; pos < tasks.length / 2; pos += 4) {
  const batch = [...tasks.slice(pos, pos + 4), ...tasks.slice(tasks.length / 2 + pos, tasks.length / 2 + pos + 4)];
  const completed = await Promise.all(batch.map(({ provider, sample, version, round }) => run(provider, sample, version, round)));
  rows.push(...completed);
  await save();
  for (const row of completed) console.log(JSON.stringify({ provider: row.provider, version: row.version, sample: row.sample,
    round: row.round, status: row.status, passed: row.checks.filter(check => check.pass).length, total: row.checks.length }));
}
