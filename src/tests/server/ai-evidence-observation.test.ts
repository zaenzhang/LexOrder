import { describe, expect, it, vi } from "vitest";
import { inspectAiObservationResult, mergeExplicitFields, prepareAiObservationResult, readBankReceiptCandidates, readExplicitMessageCandidates, readExplicitPleadingCandidates, readLoanNotePrincipalCandidates } from "@/server/evidence/ai-observation-contract";

import { readObservationRuns } from "@/server/evidence/analysis-runs";
import { observationJobKey } from "@/server/evidence/analysis-run-contract";
import { unpackObservationDraft } from "@/server/evidence/observation-extraction-skill";

const mock = vi.hoisted(() => ({
  runs: vi.fn(), deadJobs: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (read: (tx: unknown) => unknown) => read({
    evidenceItem: { findFirst: async () => ({ id: "item", revision: 2 }) },
    evidenceObservationRun: { findMany: mock.runs },
    jobQueue: { findMany: mock.deadJobs },
  }) },
}));
vi.mock("@/server/matters/context-service", () => ({ contextAccess: async () => ({ canWrite: false }) }));

const fragment = { start: 300, text: "诉请 50 万元。\n2023年3月1日，原告当日交付借款 50 万元。" };
const statement = { fragment: 1, statement: "PARTY_STATEMENT",
  date: { role: "OCCURRENCE", quote: { text: "2023年3月1日" } },
  amount: { nature: "ACTUAL_TRANSFER", quote: { text: "50 万元", context: "原告当日交付借款 50 万元" } } };

describe("AI structured observations", () => {
  it("locates fields unambiguously in the authorized fragment and adds the anchor offset", () => {
    const [candidate] = prepareAiObservationResult({ observations: [statement] }, [fragment]);
    const amountOffset = fragment.start + fragment.text.lastIndexOf("50 万元");
    expect(candidate.input.amount?.span).toEqual({ start: amountOffset, end: amountOffset + 5 });
    expect(candidate.data.amount).toMatchObject({ text: "50 万元", value: { currency: "CNY", value: "500000" } });
    expect(candidate.data.date?.value).toEqual({ precision: "EXACT", day: "2023-03-01" });
    expect(candidate.data.statement).toEqual("PARTY_STATEMENT");
  });

  it("refuses duplicate, invented and ambiguous links, and rejects render or normalized value instructions", () => {
    expect(() => prepareAiObservationResult({ observations: [statement, statement] }, [fragment])).toThrow("重复输出");
    expect(() => prepareAiObservationResult({ observations: [{ ...statement, fragment: 2 }] }, [fragment])).toThrow("未授权");
    expect(() => prepareAiObservationResult({ observations: [{ ...statement, amount: {
      ...statement.amount, quote: { text: "500 万元" },
    } }] }, [fragment])).toThrow("未命中");
    expect(() => prepareAiObservationResult({ observations: [{ ...statement, amount: {
      ...statement.amount, quote: { text: "50 万元" },
    } }] }, [fragment])).toThrow("唯一定位");
    expect(() => prepareAiObservationResult({ observations: [{ ...statement, amount: {
      ...statement.amount, value: "1",
    } }] }, [fragment])).toThrow();
    expect(() => prepareAiObservationResult({ observations: [statement], component: "iframe" }, [fragment])).toThrow();
  });

  it.each([
    { text: "转账金额48万元，账户余额49万元。", amount: "49万元", expected: "BALANCE", wrong: "ACTUAL_TRANSFER" },
    { text: "账户余额49万元，转账金额（元）：480000元。", amount: "480000元", expected: "ACTUAL_TRANSFER", wrong: "BALANCE" },
  ])("明确的金额标注约束候选性质：$text", ({ text, amount, expected, wrong }) => {
    const result = (nature: string) => prepareAiObservationResult({ observations: [{
      fragment: 1, statement: "RECORD", amount: { nature, quote: { text: amount } },
    }] }, [{ start: 0, text }]);
    expect(() => result(wrong)).toThrow("金额性质与原文标注不符");
    expect(result(expected)[0].data.amount?.nature).toBe(expected);
  });

  it("署日与提交日各自按原文标注校验", () => {
    const text = "落款日期：2023-03-03；提交日期：2023-03-05。";
    const record = { fragment: 1, statement: "PARTY_STATEMENT", date: { role: "FILING", quote: { text: "2023-03-03" } } };
    expect(() => prepareAiObservationResult({ observations: [record] }, [{ start: 0, text }])).toThrow("日期性质与原文标注不符");
    const results = prepareAiObservationResult({ observations: [
      { ...record, date: { ...record.date, role: "SIGNATURE" } },
      { ...record, date: { ...record.date, quote: { text: "2023-03-05" } } },
    ] }, [{ start: 0, text }]);
    expect(results.map(candidate => candidate.data.date?.role)).toEqual(["SIGNATURE", "FILING"]);
  });

  it("preserves participants and a directed relation with exact anchor offsets", () => {
    const text = "交易日期 ｜ 付款人 ｜ 收款人 ｜ 金额（元）\n2023-03-03 ｜ 张三 ｜ 李四 ｜ 480,000.00";
    const candidate = { fragment: 1, statement: "RECORD",
      participants: ["张三", "李四"].map(name => ({ quote: { text: name } })),
      relations: [{ kind: "PAYS_TO", from: 1, to: 2, quote: { text: "张三 ｜ 李四 ｜ 480,000.00" } }],
    };
    const source = [{ start: 800, text }];
    const [parsed] = prepareAiObservationResult({ observations: [candidate] }, source);
    expect(parsed.data.participants).toEqual(["张三", "李四"].map(name => ({
      text: name, span: { start: 800 + text.indexOf(name), end: 802 + text.indexOf(name) },
    })));
    expect(parsed.data.relations).toMatchObject([{ kind: "PAYS_TO", from: 1, to: 2, text: "张三 ｜ 李四 ｜ 480,000.00" }]);
    const link = candidate.relations[0];
    const changed = (relation: object) => prepareAiObservationResult({ observations: [
      { ...candidate, relations: [{ ...link, ...relation }] },
    ] }, source);
    expect(() => changed({ from: 2, to: 1 })).toThrow("付款方向");
    expect(() => changed({ from: 1, to: 1 })).toThrow("两个不同的参与人");
    expect(() => changed({ from: 3 })).toThrow("两个不同的参与人");
    expect(() => changed({ quote: { text: "480,000.00" } })).toThrow("两个不同的参与人");
    expect(() => changed({ quote: { text: "虚构的关系" } })).toThrow("未命中");
    expect(() => prepareAiObservationResult({ observations: [candidate, {
      ...candidate, participants: [...candidate.participants].reverse(), relations: [{ ...link, from: 2, to: 1 }],
    }] }, source)).toThrow("重复输出");
  });

  it("leaves same-named mentions source-bound and does not infer a roster identity", () => {
    const record = { fragment: 1, statement: "PARTY_STATEMENT",
      participants: [{ quote: { text: "原告" } }, { quote: { text: "李四", context: "经办人李四" } }],
    };
    const source = [{ start: 0, text: "原告提到经办人李四，另一份表列有见证人李四。" }];
    expect(prepareAiObservationResult({ observations: [record] }, source)[0].data).toMatchObject({
      participants: [{ text: "原告" }, { text: "李四", span: { start: 7, end: 9 } }],
    });
    expect(() => prepareAiObservationResult({ observations: [{ ...record, participants: [
      { quote: { text: "李四" } },
    ] }] }, source)).toThrow("唯一定位");
    expect(() => prepareAiObservationResult({ observations: [{ ...record, participants: [
      { quote: { text: "假名" }, partyId: "official" },
    ] }] }, source)).toThrow();
  });

  it("does not treat identical wording from two fixed fragments as the same citation", () => {
    const candidates = prepareAiObservationResult({ observations: [statement, { ...statement, fragment: 2 }] }, [fragment, fragment]);
    expect(candidates.map(entry => entry.fragment)).toEqual([1, 2]);
  });
});

it("列出批次时一次检查失效队列，并区分派发前失败和结果不明", async () => {
  const active = { evidenceItemId: "item", baseRevision: 2, ranges: [{ sourceId: "c" + "s".repeat(24), documentId: "c" + "d".repeat(24),
    parseRunId: "c" + "r".repeat(24), anchorId: "anchor", start: 0, end: 3 }],
  };
  mock.runs.mockResolvedValue([
    { ...active, id: "queued", state: "QUEUED", receipt: null },
    { ...active, id: "dispatched", state: "DISPATCHED", receipt: { sentCharacters: 3 } },
    { ...active, id: "running", state: "DISPATCHED", receipt: null },
    { ...active, id: "complete", state: "READY", receipt: null },
  ]);
  mock.deadJobs.mockResolvedValue([
    { dedupeKey: observationJobKey("queued") }, { dedupeKey: observationJobKey("dispatched") },
  ]);
  const result = await readObservationRuns({ id: "lawyer", role: "LAWYER" }, "matter", "item");
  if (!("runs" in result)) throw new Error("Expected a batch list");
  if (!result.runs) throw new Error("Expected the analysis run list");
  expect(result.runs.map(({ id, state, receipt }) => [id, state, receipt?.error])).toEqual([
    ["queued", "FAILED", "UNAVAILABLE"],
    ["dispatched", "UNCERTAIN", "INTERRUPTED"],
    ["running", "DISPATCHED", undefined],
    ["complete", "READY", undefined],
  ]);
  expect(result.runs[1].receipt).toMatchObject({ sentCharacters: 3 });
  expect(mock.deadJobs).toHaveBeenCalledOnce();
  expect(mock.deadJobs.mock.calls[0][0].where).toEqual({
    dedupeKey: { in: ["queued", "dispatched", "running"].map(observationJobKey) }, status: "DEAD",
  });
});

it("保留纯引文候选，逐条拒绝越界、假引文、重复和错误结构", () => {
  const source = { start: 12, text: "附件正文\n整机性能测试未通过。\n" };
  const excerpt = { text: "整机性能测试未通过" };
  const candidate = { fragment: 1, statement: "PARTY_STATEMENT", excerpt };
  const output = inspectAiObservationResult({
    observations: [candidate, { ...candidate, fragment: 2 }, { ...candidate, excerpt: { text: "验收通过" } },
      candidate, { ...candidate, statement: "CONFIRMED" }],
  }, [source]);
  expect(output.candidates).toHaveLength(1);
  expect(output.candidates[0].data.excerpt).toEqual({ span: { start: 17, end: 26 }, text: excerpt.text });
  expect(output.rejected.map(entry => entry.reason)).toEqual(["RANGE", "SOURCE", "DUPLICATE", "SCHEMA"]);
});

it("跨行引文可唯一定位并保留原文换行，同样的无空格文字有多处时拒绝", () => {
  const candidate = { fragment: 1, statement: "PARTY_STATEMENT", excerpt: { text: "利息已预先扣除" } };
  const raw = { observations: [candidate] };
  const text = "材料正文\n利息已\n预先扣除。";
  expect(inspectAiObservationResult(raw, [{ start: 5, text }]).candidates[0].data.excerpt?.text).toBe("利息已\n预先扣除");
  expect(inspectAiObservationResult(raw, [{ start: 5, text: text + "\n利息 已预先扣除" }]).rejected[0]?.reason).toBe("SOURCE");
});

it("编号行在固定范围内解析，以材料类型校正陈述并单独拒绝不可定位的字段", () => {
  const source = { start: 2, category: "PLEADING", text: "诉状\n对方称已付款。\n2023-01-01" };
  const raw = { observations: [
    { fragment: 1, statement: "RECORD", lines: { first: 2 }, date: { role: "OCCURRENCE", quote: { text: "2023-01-01" } } },
    { fragment: 1, statement: "RECORD", lines: { first: 0 } },
  ] };
  const output = inspectAiObservationResult(raw, [source]);
  expect(output.candidates[0].data).toEqual({ statement: "PARTY_STATEMENT", excerpt: { span: { start: 5, end: 12 }, text: "对方称已付款。" } });
  expect(output.skippedFields).toBe(1);
  expect(output.rejected[0]?.reason).toBe("SCHEMA");
});

it("完整银行表头直接回读日期和金额，列不明时留给律师或分析技能", () => {
  const header = "某银行 转账回单\n交易日期 ｜ 付款人 ｜ 收款人 ｜ 金额（元） ｜ 摘要\n";
  const row = "2023-03-03 ｜ 张三 ｜ 李四 ｜ 480,000.00 ｜ 借款";
  const { candidates, covered } = readBankReceiptCandidates([{ start: 15, category: "EVIDENCE", text: header + row }]);
  expect([...covered]).toEqual([1]);
  expect(candidates[0].data.date?.value).toEqual({ precision: "EXACT", day: "2023-03-03" });
  expect(candidates[0].data.amount?.value).toEqual({ currency: "CNY", value: "480000" });
  expect(candidates[0].data.relations?.[0].kind).toBe("PAYS_TO");
  expect(readBankReceiptCandidates([{ start: 0, category: "EVIDENCE", text: header + row + "\n其他：日期待查" }]).candidates).toEqual([]);
});

it("字面收款与预扣陈述独立提取，否认收款不产生正向记录", () => {
  const text = "答辩人实际于2023年3月3日收到借款48万元，原告口头约定的利息\n已从本金中预先扣除。";
  const records = readExplicitPleadingCandidates([{ start: 0, category: "PLEADING", text }]);
  expect(records).toHaveLength(2);
  expect(records[0].data).toMatchObject({ statement: "PARTY_STATEMENT", date: { value: { day: "2023-03-03" } },
    amount: { value: { value: "480000" }, nature: "ACTUAL_TRANSFER" } });
  expect(records[1].data.excerpt?.text).toBe("利息\n已从本金中预先扣除");
  expect(records[1].data.date).toBeUndefined();
  expect(readExplicitPleadingCandidates([{ start: 0, category: "PLEADING", text: "2023年3月3日未收到借款48万元。" }])).toHaveLength(0);
});

it.each([
  "被告否认其于2023年3月3日收到借款48万元。",
  "没有证据证明：\n2023年3月3日收到借款48万元。",
  "原告于2023年3月3日向被告出借款48万元，约定当日交付。",
  "答辩人称，若2023年3月3日收到借款48万元，才承担付款义务。",
  "辩称2023年3月3日收到借款48万元不属实。",
  "被告不认可利息已从本金中预先扣除。",
])("本机规则保留待核范围，跳过否认、条件或无明确交付的记载：%s", text => {
  expect(readExplicitPleadingCandidates([{ start: 0, category: "PLEADING", text }])).toEqual([]);
});

it("未肯定的前一笔和后续承认的另笔分别核对", () => {
  const text = "被告否认于2023年3月1日收到借款12万元，但承认于2023年3月3日收到借款2万元。";
  const records = readExplicitPleadingCandidates([{ start: 90, category: "PLEADING", text }]);
  expect(records).toHaveLength(1);
  expect(records[0].data).toMatchObject({ statement: "PARTY_STATEMENT", amount: { value: { value: "20000" } },
    excerpt: { text: "2023年3月3日收到借款2万元" } });
});

it("模型传来的关系用同一份正式契约落位，错误记录逐条拒绝", () => {
  const text = "青禾公司向远桥公司交付设备。";
  const source = { text, start: 100, category: "EVIDENCE" };
  const wire = { fragment: 1, firstLine: 1, lastLine: 1, title: "交付设备", category: "performance", kind: "FACT",
    statement: "RECORD", excerpt: null, dateRole: null, dateText: null, amountNature: null, amountText: null,
    participants: ["青禾公司", "远桥公司"].map(text => ({ text, context: null })), relations: [{ kind: "DELIVERS_TO", from: 1, to: 2, quote: text }],
  };
  const result = inspectAiObservationResult(unpackObservationDraft({ observations: [wire, { ...wire, firstLine: "1" }] }), [source]);
  expect(result.rejected).toEqual([{ index: 1, reason: "SCHEMA" }]);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].data).toMatchObject({
    participants: [{ text: "青禾公司", span: { start: 100, end: 104 } }, { text: "远桥公司", span: { start: 105, end: 109 } }],
    relations: [{ kind: "DELIVERS_TO", from: 1, to: 2, text, span: { start: 100, end: 100 + text.length } }],
  });
  const unsupported = inspectAiObservationResult(unpackObservationDraft({ observations: [
    { ...wire, relations: [{ ...wire.relations[0], quote: "青禾公司雇用远桥公司。" }] },
  ] }), [source]);
  expect(unsupported.skippedFields).toBe(1);
  expect(unsupported.candidates[0].data.participants).toHaveLength(2);
  expect(unsupported.candidates[0].data.relations).toBeUndefined();
});


it.each([null, "见证方林青", "虚构的签收人林青"])("同名上下文 %s 不影响其他参与人和有出处的关系", context => {
  const text = "见证方林青到场，另一份清单亦称见证方林青到场。签收方林青接收。青禾公司向远桥公司交付设备。";
  const source = { text, start: 75 };
  const relation = "青禾公司向远桥公司交付设备。";
  const wire = {
    fragment: 1, firstLine: 1, lastLine: 1, title: "交付设备", category: "performance", kind: "FACT",
    statement: "RECORD", excerpt: null, dateRole: null, dateText: null, amountNature: null, amountText: null,
    participants: [{ text: "林青", context }, { text: "青禾公司", context: null }, { text: "远桥公司", context: null }],
    relations: [
      { kind: "DELIVERS_TO", from: 2, to: 1, quote: text },
      { kind: "DELIVERS_TO", from: 2, to: 3, quote: relation },
    ],
  };
  const result = inspectAiObservationResult(unpackObservationDraft({ observations: [wire] }), [source]);
  expect(result.rejected).toEqual([]);
  expect(result.skippedFields).toBe(2);
  const [candidate] = result.candidates;
  expect(candidate.data.participants?.map(person => person.text)).toEqual(["青禾公司", "远桥公司"]);
  expect(candidate.data.relations).toMatchObject([{ kind: "DELIVERS_TO", from: 1, to: 2, text: relation }]);
});

it("同一行内两个同名参与人按原文上下文定位各自的固定偏移", () => {
  const text = "签字人林青已验收，见证人林青在场。";
  const start = 190;
  const result = inspectAiObservationResult(unpackObservationDraft({ observations: [{
    fragment: 1, firstLine: 1, lastLine: 1, title: "验收记载", category: "performance", kind: "FACT",
    statement: "RECORD", excerpt: null, dateRole: null, dateText: null, amountNature: null, amountText: null,
    participants: [{ text: "林青", context: "签字人林青" }, { text: "林青", context: "见证人林青" }], relations: null,
  }] }), [{ text, start }]);
  expect(result.rejected).toEqual([]);
  expect(result.skippedFields).toBe(0);
  expect(result.candidates[0].data.participants).toEqual([text.indexOf("林青"), text.lastIndexOf("林青")].map(offset => ({
    text: "林青", span: { start: start + offset, end: start + offset + 2 },
  })));
});

it.each([
  { dateText: "2024年3月", amountText: "人民币４８万元", dateValue: { precision: "MONTH", month: "2024-03" },
    amountValue: { currency: "CNY", value: "480000" } },
  { dateText: "约2024年3月", amountText: "约48万元", dateValue: { precision: "UNKNOWN" }, amountValue: null },
])("抽取结果保留原文及日期金额精度：$dateText，$amountText", ({ dateText, amountText, dateValue, amountValue }) => {
  const text = `${dateText}，乙方转账${amountText}。`;
  const draft = unpackObservationDraft({ observations: [{
    fragment: 1, firstLine: 1, lastLine: 1, title: "转账记载", category: "payment", kind: "FACT", statement: "RECORD",
    excerpt: text, dateRole: "OCCURRENCE", dateText, amountNature: "ACTUAL_TRANSFER", amountText, participants: null, relations: null,
  }] });
  const result = inspectAiObservationResult(draft, [{ text, start: 0 }]);
  expect(result.rejected).toEqual([]);
  expect(result.skippedFields).toBe(0);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].data).toMatchObject({
    excerpt: { text },
    date: { text: dateText, value: dateValue },
    amount: { text: amountText, value: amountValue },
  });
});

it("以可回读的分句定位另笔收款，拒绝同一行其他分句的日期和参与人", () => {
  const text = "被告否认于2024年3月1日收到吴乙的12万元，但认可收到另笔2万元。";
  const excerpt = "认可收到另笔2万元。";
  const draft = unpackObservationDraft({ observations: [{
    fragment: 1, firstLine: 1, lastLine: 1, title: "认可另笔收款", category: "payment", kind: "TODO_VERIFY",
    statement: "PARTY_STATEMENT", excerpt, dateRole: "OCCURRENCE", dateText: "2024年3月1日",
    amountNature: "ACTUAL_TRANSFER", amountText: "2万元", participants: ["吴乙"].map(text => ({ text, context: null })), relations: null,
  }] });
  const offset = 250;
  const result = inspectAiObservationResult(draft, [{ text, start: offset }]);
  expect(result.rejected).toEqual([]);
  expect(result.skippedFields).toBe(2);
  const [candidate] = result.candidates;
  expect(candidate.data.excerpt?.text).toBe(excerpt);
  expect(candidate.data.amount).toMatchObject({
    text: "2万元", value: { currency: "CNY", value: "20000" },
    span: { start: offset + text.lastIndexOf("2万元"), end: offset + text.lastIndexOf("2万元") + 3 },
  });
  expect(candidate.data.date).toBeUndefined();
  expect(candidate.data.participants).toBeUndefined();
});

it.each([
  ["被告否认：\n", "。", "否认"],
  ["假如", "，才承担逾期责任。", "假如"],
  ["双方约定于", "。", "约定于"],
  ["", "，以设备验收通过为条件。", "为条件"],
  ["", "并不属实。", "不属实"],
])("固定引文补回被模型截掉的履行限定语：%s", (prefix, suffix, boundary) => {
  const claim = "2024年3月1日吴乙向周甲付款12万元";
  const text = prefix + claim + suffix;
  const draft = unpackObservationDraft({ observations: [{
    fragment: 1, firstLine: prefix.endsWith("\n") ? 2 : 1, lastLine: prefix.endsWith("\n") ? 2 : 1,
    title: "吴乙已付款", category: "payment", kind: "FACT", statement: "RECORD",
    excerpt: claim, dateRole: "OCCURRENCE", dateText: "2024年3月1日",
    amountNature: "ACTUAL_TRANSFER", amountText: "12万元", participants: ["吴乙", "周甲"].map(text => ({ text, context: null })),
    relations: [{ kind: "PAYS_TO", from: 1, to: 2, quote: "吴乙向周甲付款12万元" }],
  }] });
  const result = inspectAiObservationResult(draft, [{ text, start: 75, category: "PLEADING" }]);
  expect(result.rejected).toEqual([]);
  const [candidate] = result.candidates;
  expect(candidate.hint).toMatchObject({ kind: "TODO_VERIFY" });
  expect(candidate.hint?.title).not.toBe("吴乙已付款");
  expect(candidate.data.excerpt?.text).toContain(boundary);
  expect(candidate.data.excerpt?.span?.start).toBe(75);
  expect(candidate.data.amount).toBeUndefined();
  expect(candidate.data.date).toBeUndefined();
  expect(candidate.data.relations).toBeUndefined();
  expect(candidate.data.participants?.map(person => person.text)).toEqual(["吴乙", "周甲"]);
  expect(result.skippedFields).toBe(3);
});

it.each(["2024年4月9日", "2024-04-09"])("否定词与动作隔着日期时保留限定语，也保留后一句承认：%s", day => {
  const stripped = day + "收到借款，也未在该日支付人民币80000元";
  const denied = "李四陈述：我没有在" + stripped;
  const affirmed = "李四随后确认于2024年4月10日实际支付2000元";
  const result = inspectAiObservationResult({ observations: [
    { fragment: 1, lines: { first: 1 }, statement: "PARTY_STATEMENT", excerpt: { text: stripped },
      hint: { title: "李四已支付", category: "payment", kind: "FACT" },
      date: { role: "OCCURRENCE", quote: { text: day } },
      amount: { nature: "ACTUAL_TRANSFER", quote: { text: "80000元" } } },
    { fragment: 1, lines: { first: 1 }, statement: "PARTY_STATEMENT", excerpt: { text: affirmed },
      date: { role: "OCCURRENCE", quote: { text: "2024年4月10日" } },
      amount: { nature: "ACTUAL_TRANSFER", quote: { text: "2000元" } } },
  ] }, [{ text: denied + "。" + affirmed + "。", start: 0, category: "EVIDENCE" }]);
  expect(result.rejected).toEqual([]);
  const [qualified, recorded] = result.candidates;
  expect(qualified.data.excerpt?.text).toBe(denied);
  expect(qualified.data.date).toBeUndefined();
  expect(qualified.data.amount).toBeUndefined();
  expect(qualified.hint?.kind).toBe("TODO_VERIFY");
  expect(recorded.data.date?.value).toEqual({ precision: "EXACT", day: "2024-04-10" });
  expect(recorded.data.amount?.value).toEqual({ currency: "CNY", value: "2000" });
});

it("整行出现否认与明确承认时，独立承认的金额可以保留", () => {
  const text = "被告否认于2024年3月1日收到12万元，但认可收到另笔2万元。";
  const result = inspectAiObservationResult({ observations: [{
    fragment: 1, lines: { first: 1 }, statement: "PARTY_STATEMENT",
    hint: { title: "2024年3月1日到账", category: "payment", kind: "FACT" },
    date: { role: "OCCURRENCE", quote: { text: "2024年3月1日" } },
    amount: { nature: "ACTUAL_TRANSFER", quote: { text: "2万元", context: "认可收到另笔2万元" } },
  }] }, [{ text, start: 0, category: "PLEADING" }]);
  expect(result.rejected).toEqual([]);
  const [candidate] = result.candidates;
  expect(candidate.hint?.kind).toBe("TODO_VERIFY");
  expect(candidate.data.date).toBeUndefined();
  expect(candidate.data.amount?.value).toEqual({ currency: "CNY", value: "20000" });
  expect(candidate.data.excerpt?.text).toBe(text);
});

it("独立一句的落款日期，以及后续明确承认的事实日期，不被前一句的否认改变", () => {
  const text = "被告否认收款。落款日期：2024年3月1日。被告另确认于2024年3月2日收到2万元。";
  const result = inspectAiObservationResult({ observations: [
    { fragment: 1, lines: { first: 1 }, statement: "RECORD", excerpt: { text: "落款日期：2024年3月1日" },
      date: { role: "OCCURRENCE", quote: { text: "2024年3月1日" } } },
    { fragment: 1, lines: { first: 1 }, statement: "PARTY_STATEMENT", excerpt: { text: "被告另确认于2024年3月2日收到2万元" },
      date: { role: "OCCURRENCE", quote: { text: "2024年3月2日" } },
      amount: { nature: "ACTUAL_TRANSFER", quote: { text: "2万元" } } },
  ] }, [{ text, start: 0, category: "PLEADING" }]);
  expect(result.rejected).toEqual([]);
  expect(result.skippedFields).toBe(0);
  expect(result.candidates[0].data.date?.role).toBe("SIGNATURE");
  expect(result.candidates[1].data.date?.value).toEqual({ precision: "EXACT", day: "2024-03-02" });
  expect(result.candidates[1].data.amount?.value).toEqual({ currency: "CNY", value: "20000" });
});

it("唯一命中的数字后缀不能作为完整金额或年份", () => {
  const text = "2024年，转账12万元。";
  const observation = {
    fragment: 1, statement: "RECORD", lines: { first: 1 }, excerpt: { text },
    date: { role: "OCCURRENCE", quote: { text: "024年" } },
    amount: { nature: "ACTUAL_TRANSFER", quote: { text: "2万元" } },
  };
  const result = inspectAiObservationResult({ observations: [observation] }, [{ text, start: 0 }]);
  expect(result.skippedFields).toBe(2);
  expect(result.candidates[0].data).toEqual({ statement: "RECORD", excerpt: { text, span: { start: 0, end: text.length } } });
});

it("付款方向与原文列不符时只去掉关系，保留可定位的参与人", () => {
  const text = "交易日期 ｜ 付款人 ｜ 收款人 ｜ 金额（元）\n2023-03-03 ｜ 张三 ｜ 李四 ｜ 480,000.00";
  const candidate = {
    fragment: 1, firstLine: 2, lastLine: 2, title: "付款", category: "payment", kind: "FACT", statement: "RECORD",
    excerpt: null, dateRole: null, dateText: null, amountNature: null, amountText: null, participants: ["张三", "李四"].map(text => ({ text, context: null })),
    relations: [{ kind: "PAYS_TO", from: 2, to: 1, quote: "张三 ｜ 李四" }],
  };
  const result = inspectAiObservationResult(unpackObservationDraft({ observations: [candidate] }), [{ text, start: 0 }]);
  expect(result.skippedFields).toBe(1);
  expect(result.candidates[0].data.participants?.map(value => value.text)).toEqual(["张三", "李四"]);
  expect(result.candidates[0].data.relations).toBeUndefined();
});

it.each([
  ["约定交付日期：2024年6月2日。", "2024年6月2日", "AGREEMENT", "2024-06-02"],
  ["实际履行日期：2024年6月3日。", "2024年6月3日", "OCCURRENCE", "2024-06-03"],
  ["发送时间：2024-06-02 23:59:02", "2024-06-02 23:59:02", "SENT", "2024-06-02"],
  ["接收时间：2024-06-03 00:00:01", "2024-06-03 00:00:01", "RECEIVED", "2024-06-03"],
])("以原文标注校正日期角色并保留时间原文：%s", (text, dateText, role, day) => {
  const result = inspectAiObservationResult({ observations: [{
    fragment: 1, lines: { first: 1 }, statement: "RECORD", date: { role: "SERVICE", quote: { text: dateText } },
  }] }, [{ text, start: 0 }]);
  expect(result.candidates[0].data.date).toMatchObject({ role, text: dateText, value: { precision: "EXACT", day } });
});

it("从有明确借款条款的借条读取名义本金，维持固定引文", () => {
  const text = "借条\n今借到陈某人民币壹拾万元整（¥100,000），借期一年。";
  const [candidate] = readLoanNotePrincipalCandidates([{ text, start: 0, category: "EVIDENCE" }]);
  expect(candidate.data.amount).toMatchObject({
    nature: "AGREED_PRINCIPAL", text: "¥100,000", value: { currency: "CNY", value: "100000" },
  });
  expect(candidate.hint?.kind).toBe("TODO_VERIFY");
  expect(readLoanNotePrincipalCandidates([
    { text: text.replace("，借期一年", ""), start: 0, category: "EVIDENCE" },
    { text: text.replace("借条", "其他材料"), start: 0, category: "EVIDENCE" },
    { text: text.replace("¥100,000", "100,000"), start: 0, category: "EVIDENCE" },
  ])).toEqual([]);
});

it("直接从消息记录读取明确标注的日期，并保留同一出处的丰富候选", () => {
  const text = "发送时间：2024-06-02 23:59:02\n接收时间：2024-06-03 00:00:01。\n接收时间：2024-06-03 24:01:00";
  const authorized = [{ text, start: 90, category: "EVIDENCE" }];
  const local = readExplicitMessageCandidates(authorized);
  expect(local.map(candidate => candidate.data.date)).toMatchObject([
    { role: "SENT", text: "2024-06-02 23:59:02", value: { precision: "EXACT", day: "2024-06-02" } },
    { role: "RECEIVED", text: "2024-06-03 00:00:01", value: { precision: "EXACT", day: "2024-06-03" } },
  ]);
  const live = inspectAiObservationResult({ observations: [{
    fragment: 1, lines: { first: 1, last: 2 }, statement: "RECORD",
    date: { role: "SENT", quote: { text: "2024-06-02 23:59:02" } },
  }] }, authorized).candidates;
  expect(mergeExplicitFields(live, local)).toEqual([live[0], local[1]]);
});

it("坏时刻保留原文，但不生成可定位的日期", () => {
  const text = "接收时间：2024-06-03 24:01:00";
  const result = inspectAiObservationResult({ observations: [{
    fragment: 1, lines: { first: 1 }, statement: "RECORD", date: { role: "SERVICE", quote: { text: "2024-06-03 24:01:00" } },
  }] }, [{ text, start: 0 }]);
  expect(result.candidates[0].data.date).toMatchObject({ role: "RECEIVED", text: "2024-06-03 24:01:00", value: { precision: "UNKNOWN" } });
});

it.each([
  ["原告诉称合同已经履行。", "合同已经履行", "COURT_FINDING", "PARTY_STATEMENT"],
  ["经审理查明，被告已接收第一批设备。", "被告已接收第一批设备", "PARTY_STATEMENT", "COURT_FINDING"],
  ["The supplier argues that the second agreement applies.", "the second agreement applies", "COURT_FINDING", "PARTY_STATEMENT"],
  ["We conclude that the documents require further review.", "the documents require further review", "PARTY_STATEMENT", "COURT_FINDING"],
  ["双方已提交相关材料。", "双方已提交相关材料", "RECORD", "RECORD"],
  ["The Court says the agreement matters.", "the agreement matters", "RECORD", "RECORD"],
])("以当前原文的陈述主体校正错误标注：%s", (text, excerpt, wrong, expected) => {
  const result = inspectAiObservationResult({ observations: [{
    fragment: 1, lines: { first: 1 }, statement: wrong, excerpt: { text: excerpt },
  }] }, [{ text, start: 10, category: "JUDGMENT" }]);
  expect(result.candidates[0].data.statement).toBe(expected);
  expect(result.candidates[0].data.excerpt?.text).toBe(excerpt);
});
