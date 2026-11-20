import { fragmentLines, inspectAiObservationResult } from "../src/server/evidence/ai-observation-contract";
import { observationExtractionSchema, observationSystemPrompt, unpackObservationDraft } from "../src/server/evidence/observation-extraction-skill";

const models = ["gpt-4.1-mini-2025-04-14", "gpt-4.1-2025-04-14"];
const rounds = 2;
const cases = [
  {
    id: "loan", title: "借款交付",
    fragments: [
      { category: "EVIDENCE", text: "交易日期：2024年3月12日。赵甲向钱乙支付借款本金12万元。" },
      { category: "PLEADING", text: "答辩人钱乙陈述：本人没有收到这笔借款。" },
    ],
    date: "2024-03-12", amount: "120000", kind: "PAYS_TO", from: "赵甲", to: "钱乙",
  },
  {
    id: "sale", title: "设备采购交付",
    fragments: [
      { category: "EVIDENCE", text: "交付日期：2024年4月8日。恒甲设备有限公司向启乙制造有限公司交付两台机床。" },
      { category: "PLEADING", text: "买方陈述：本次到货尚未完成验收。" },
    ],
    date: "2024-04-08", kind: "DELIVERS_TO", from: "恒甲设备有限公司", to: "启乙制造有限公司",
  },
  {
    id: "labor", title: "劳动用工",
    fragments: [
      { category: "EVIDENCE", text: "2024年5月6日，华丙工厂开始雇用周丁，岗位为检验员。" },
      { category: "PLEADING", text: "劳动者陈述：入职时并未收到书面合同。" },
    ],
    date: "2024-05-06", kind: "EMPLOYS", from: "华丙工厂", to: "周丁",
  },
];

type Completion = {
  id: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
  choices: { finish_reason: string; message: { content: string | null; refusal?: string | null } }[];
};

async function run(key: string, sample: typeof cases[number], model: string, round: number, duplicated: boolean) {
  const system = observationSystemPrompt(false);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model, temperature: 0, max_tokens: 4200,
      response_format: {
        type: "json_schema",
        json_schema: { name: "lexorder_observations", strict: true, schema: observationExtractionSchema },
      },
      messages: [
        { role: "system", content: duplicated ? system + "\n" + JSON.stringify(observationExtractionSchema) : system },
        { role: "user", content: JSON.stringify({
          title: sample.title,
          fragments: sample.fragments.map(({ text, category }, index) => ({
            index: index + 1, material: "合成材料" + (index + 1), category,
            lines: fragmentLines(text).map(({ line, text }) => ({ line, text })),
          })),
        }) },
      ],
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(`${model}/${sample.id} HTTP ${response.status} (${error?.error?.code ?? "unknown"})`);
  }
  const result: Completion = await response.json();
  const choice = result.choices[0];
  const status = choice.finish_reason === "stop" && choice.message.content && !choice.message.refusal ? "COMPLETE" : "INCOMPLETE";
  const validated = status === "COMPLETE"
    ? inspectAiObservationResult(unpackObservationDraft(JSON.parse(choice.message.content!)), sample.fragments.map(fragment => ({ ...fragment, start: 0 })))
    : { candidates: [], rejected: [], skippedFields: 0 };
  const main = validated.candidates.filter(candidate => candidate.fragment === 1);
  const secondary = validated.candidates.filter(candidate => candidate.fragment === 2);
  const expected = {
    date: main.some(candidate => candidate.data.date?.value.precision === "EXACT" && candidate.data.date.value.day === sample.date),
    ...(sample.amount && { amount: main.some(candidate => candidate.data.amount?.value?.currency === "CNY" && candidate.data.amount.value.value === sample.amount) }),
    relation: main.some(({ data }) => data.relations?.some(link => link.kind === sample.kind &&
      data.participants?.[link.from - 1]?.text === sample.from && data.participants[link.to - 1]?.text === sample.to)),
    statement: secondary.length > 0 && secondary.every(candidate => candidate.data.statement === "PARTY_STATEMENT"),
    noInventedRelation: secondary.every(candidate => !candidate.data.relations?.length),
  };
  return {
    sample: sample.id, model: result.model, round, duplicated, status,
    id: result.id, requestId: response.headers.get("x-request-id"),
    input: result.usage.prompt_tokens, output: result.usage.completion_tokens,
    cached: result.usage.prompt_tokens_details?.cached_tokens ?? 0,
    candidates: validated.candidates.length, rejected: validated.rejected.length, skipped: validated.skippedFields, expected,
  };
}

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Set OPENAI_API_KEY for the OpenAI benchmark.");
  for (const model of models) {
    for (let round = 1; round <= rounds; round += 1) {
      await Promise.all(cases.map(async (sample, index) => {
        const order = (round + index) % 2 ? [false, true] : [true, false];
        for (const duplicated of order) console.log(JSON.stringify(await run(key, sample, model, round, duplicated)));
      }));
    }
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : "OpenAI benchmark failed");
  process.exitCode = 1;
});
