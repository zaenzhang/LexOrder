import { describe, expect, it, vi } from "vitest";
import { inspectAiObservationResult, prepareAiObservationResult, readBankReceiptCandidates, readExplicitPleadingCandidates } from "@/server/evidence/ai-observation-contract";

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
    participants: ["青禾公司", "远桥公司"], relations: [{ kind: "DELIVERS_TO", from: 1, to: 2, quote: text }],
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
    amountNature: "ACTUAL_TRANSFER", amountText: "2万元", participants: ["吴乙"], relations: null,
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
    excerpt: null, dateRole: null, dateText: null, amountNature: null, amountText: null, participants: ["张三", "李四"],
    relations: [{ kind: "PAYS_TO", from: 2, to: 1, quote: "张三 ｜ 李四" }],
  };
  const result = inspectAiObservationResult(unpackObservationDraft({ observations: [candidate] }), [{ text, start: 0 }]);
  expect(result.skippedFields).toBe(1);
  expect(result.candidates[0].data.participants?.map(value => value.text)).toEqual(["张三", "李四"]);
  expect(result.candidates[0].data.relations).toBeUndefined();
});
