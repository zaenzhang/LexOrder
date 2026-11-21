// Run only against fixture.mjs's disposable two-case Personal workspace.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fixture } from "./fixture.mjs";

const { workspace, cases: [matter, other], request } = await fixture();
const endpoint = "/api/personal/matter-workspace";
const tag = randomUUID().slice(0, 8);
const quantity = "设备签收 12 台";
const contract = "设备性能须经双方另行验收";
const issueTitle = "签收能否证明性能验收 " + tag;
const post = async (body, expected = 200) => (await request(endpoint, body, expected)).json();
const get = async (matterId, section, params, expected = 200) =>
  (await request(endpoint + "?" + new URLSearchParams({ matter: matterId, section, ...params }), undefined, expected)).json();

const folderRoot = path.join(path.dirname(workspace), path.basename(workspace) + "-casebook");
await mkdir(folderRoot, { recursive: true, mode: 0o700 });
for (const target of [matter, other]) {
  const folder = await (await request("/api/personal/matter-folder?matter=" + target.id)).json();
  if (folder.path) assert(folder.available);
  else await request("/api/personal/matter-folder", { matterId: target.id, action: "bind", root: folderRoot });
}
async function upload(target, title, text, draft = false) {
  const name = title + "-" + tag + ".txt";
  const form = new FormData();
  for (const [key, value] of Object.entries({ name, matterId: target.id, category: "EVIDENCE", requestKey: randomUUID() })) form.set(key, value);
  if (draft) form.set("sourceOrigin", "TEAM_PRODUCED");
  form.set("file", new File([text], name, { type: "text/plain" }));
  await request(endpoint, form);
  const { documents } = await get(target.id, "materials", { q: name });
  assert.equal(documents.length, 1, name);
  return documents[0].id;
}
async function fixedRanges(target, ids) {
  const until = Date.now() + 45_000;
  for (;;) {
    const coverage = await post({ action: "preview-skill-input", data: { matterId: target.id, documents: ids.map(documentId => ({ documentId })) } });
    assert.deepEqual(coverage.modelSupply, { status: "NOT_SENT", sentChars: 0 });
    if (coverage.items.every(item => item.processing?.state === "READY")) {
      return ids.map(documentId => {
        const item = coverage.items.find(entry => entry.documentId === documentId);
        const range = item?.preparation.ranges[0];
        assert(range && item.run?.id && range.end > range.start, documentId);
        return { documentId, parseRunId: item.run.id, anchorId: range.anchorId, start: range.start, end: range.end };
      });
    }
    assert(Date.now() < until, "Timed out waiting for synthetic text material coverage");
    await delay(500);
  }
}
const first = await upload(matter, "合成设备交接", quantity + "，仅核对数量及外观。");
const second = await upload(matter, "合成设备合同", contract + "。", process.argv.includes("--material-impact"));
const foreign = await upload(other, "乙案独立材料", "乙案收货标记，不属于甲案。");
const ranges = await fixedRanges(matter, [first, second]);
const [foreignRange] = await fixedRanges(other, [foreign]);
const issue = await post({ action: "create-evidence", data: {
  matterId: matter.id, requestKey: randomUUID(), kind: "ISSUE", title: issueTitle,
  content: "区分签收数量和性能验收。", sourceDocumentId: null, sourcePage: null, sourceRelation: "CONTEXT",
} });
const issueRow = (await get(matter.id, "evidence-items", {})).items.find(row => row.id === issue.id);
assert(issueRow && issueRow.kind === "ISSUE");
const issueInput = { action: "create-issue-signoff", matterId: matter.id, requestKey: randomUUID(), researchedAt: new Date().toISOString(), ranges,
  issue: { kind: "CURRENT", issueId: issue.id, revision: issueRow.revision, confirmedAt: issueRow.confirmedAt } };
const researchIds = async () => (await get(matter.id, "research", {})).records.map(row => row.id);
const beforeIssueSubmit = await researchIds();
await post({ ...issueInput, issue: { ...issueInput.issue, revision: issueInput.issue.revision + 1 } }, 403);
await post({ ...issueInput, ranges: [foreignRange] }, 403);
assert.deepEqual(await researchIds(), beforeIssueSubmit);
const fromIssue = await post(issueInput);
assert.equal((await post(issueInput)).id, fromIssue.id);
const issueResearch = await get(matter.id, "research", { record: fromIssue.baseResearchId });
assert.equal(issueResearch.issue.id, issue.id);
assert.equal(issueResearch.version, 1);
await post({ ...issueInput, issue: { ...issueInput.issue, revision: issueInput.issue.revision + 1 } }, 403);
console.log("PASS dispute entry atomically creates one fixed research and commission; stale or cross-case requests leave no partial research");
const base = await post({ action: "create-research", matterId: matter.id, requestKey: randomUUID(),
  researchedAt: new Date().toISOString(), question: issueTitle, scope: "合成采购案内材料",
  conclusion: "待分项核对签收记录和合同条件。", unresolved: "整批性能报告待补。",
  issueSelection: { kind: "CURRENT", issueId: issue.id, revision: issueRow.revision, confirmedAt: issueRow.confirmedAt },
});
const create = { action: "create-signoff", matterId: matter.id, researchId: base.id, requestKey: randomUUID(), ranges };
await post({ ...create, ranges: [foreignRange] }, 403);
await post({ ...create, ranges: [ranges[0], ranges[0]] }, 400);
const run = await post(create);
assert.equal((await post(create)).id, run.id);
if (process.argv.includes("--native-ai-disabled")) {
  const settingsPath = "/api/personal/practice-resources?view=ai";
  const config = await (await request(settingsPath)).json();
  assert.equal(config.configured, false, "Require an isolated workspace without an AI key");
  await post({ action: "run-signoff-ai", matterId: matter.id, id: run.id, confirmed: false, model: config.textModel, origin: new URL(config.baseUrl).origin }, 400);
  await post({ action: "run-signoff-ai", matterId: matter.id, id: run.id, confirmed: true, model: config.textModel, origin: new URL(config.baseUrl).origin }, 403);
  const record = await get(matter.id, "skill-commissions", { record: run.id });
  assert.equal(record.aiProvider, null);
  assert.equal(record.aiExecution, null);
  assert.equal(record.result, null);
  console.log("PASS native AI unconfigured and explicit confirmation guards without dispatch");
}
const late = await post({ ...create, requestKey: randomUUID() });
const receipt = (id, owner = matter.id, status = 200) => get(owner, "skill-commissions", { record: id }, status);
const exportRun = (id, status = 200) => post({ action: "export-signoff", matterId: matter.id, id, confirmed: true }, status);
await receipt(run.id, other.id, 403);
const bundle = await exportRun(run.id);
const lateBundle = await exportRun(late.id);
assert.equal(bundle.question, issueTitle);
assert.equal(bundle.fragments.length, 2);
assert.deepEqual(bundle.fragments, lateBundle.fragments);
function citation(index, quote) {
  const start = bundle.fragments[index - 1].text.indexOf(quote);
  assert(start >= 0);
  return { fragment: index, start, end: start + quote.length, quote, relation: "SUPPORTS" };
}
const result = { commissionId: run.id, methodVersion: bundle.methodVersion, host: "CODEX",
  candidates: [
    { kind: "QUANTITY", assessment: "SUPPORTED", finding: "合成清单载有签收数量。", citations: [citation(1, quantity)] },
    { kind: "PERFORMANCE", assessment: "INSUFFICIENT", finding: "尚无整批通过性能验收的材料。", citations: [citation(2, contract)] },
  ],
};
const submit = (id, candidate, expected = 200) => post({ action: "submit-signoff", matterId: matter.id, id, result: candidate }, expected);
const wrongQuote = structuredClone(result);
wrongQuote.candidates[0].citations[0].quote = "设备签收 15 台";
await submit(run.id, wrongQuote, 403);
assert.equal((await receipt(run.id)).result, null);
const submitted = await submit(run.id, result);
assert.equal((await submit(run.id, result)).submittedAt, submitted.submittedAt);
await submit(run.id, { ...result, host: "WORKBUDDY" }, 403);
const before = await get(matter.id, "research", { record: base.id });
assert.equal(before.version, 1);
assert.equal(before.current, true);

const decisions = [
  { candidate: 0, disposition: "PARTIAL", value: "律师采用清单签收 12 台的数量记载。", reason: "限于数量及外观。" },
  { candidate: 1, disposition: "NEEDS_SOURCE", value: "仍待取得双方性能验收报告。", reason: "合同约定另行验收。" },
];
const adopt = (id, choices, expected = 200) => post({ action: "adopt-signoff", matterId: matter.id, id, decisions: choices }, expected);
await adopt(run.id, [decisions[0]], 403);
const revision = await adopt(run.id, decisions);
assert.equal(revision.version, 2);
assert.notEqual(revision.id, base.id);
assert.deepEqual(await adopt(run.id, decisions), { id: revision.id, replayed: true });
await adopt(run.id, [{ ...decisions[0], value: "改写已确认的数量" }, decisions[1]], 403);
const revised = await get(matter.id, "research", { record: revision.id });
assert.equal(revised.current, true);
assert(revised.content.conclusion.includes(decisions[0].value));
assert(revised.content.unresolved.includes(decisions[1].value));
assert(revised.content.supportingAnalysis.includes(decisions[0].reason));
assert.deepEqual(new Set(revised.sources.map(source => source.anchorId + "/" + source.documentId)),
  new Set(ranges.map(range => range.anchorId + "/" + range.documentId)));
const confirmed = await receipt(run.id);
assert.equal(confirmed.adoptedResearchId, revision.id);
assert.deepEqual(confirmed.decisions, decisions);

const history = (params, owner = matter.id, status = 200) => get(owner, "skill-commissions", params, status);
const issuePage = await history({ issue: issue.id });
assert.deepEqual(new Set(issuePage.items.map(row => row.id)), new Set([run.id, late.id, fromIssue.id]));
assert.equal(issuePage.nextCursor, null);
const saved = issuePage.items.find(row => row.id === run.id);
assert.equal(saved.adoptedResearchId, revision.id);
assert.equal(saved.baselineCurrent, false);
assert.equal(saved.researchVersion, 1);
assert.equal(saved.issueRevision, issueRow.revision);
assert.equal(saved.aiState, null);
assert.equal("ranges" in saved || "result" in saved || "baseResearch" in saved, false);
const fromAdoptedResearch = await history({ research: revision.id });
assert.deepEqual(new Set(fromAdoptedResearch.items.map(row => row.id)), new Set([run.id, late.id]));
await history({ research: revision.id, before: fromIssue.id }, matter.id, 403);
await history({ issue: issue.id }, other.id, 403);
const excerpt = await history({ record: run.id, fragment: "1" });
assert.deepEqual(excerpt, { text: bundle.fragments[0].text });
assert.equal(excerpt.text.slice(result.candidates[0].citations[0].start, result.candidates[0].citations[0].end), quantity);
await history({ record: run.id, fragment: "3" }, matter.id, 403);
await history({ record: run.id, fragment: "1" }, other.id, 403);
for (let index = 0; index < 8; index++) {
  await post({ ...issueInput, requestKey: randomUUID() });
}
const pageOne = await history({ issue: issue.id });
assert.equal(pageOne.items.length, 10);
assert(pageOne.nextCursor);
const pageTwo = await history({ issue: issue.id, before: pageOne.nextCursor });
assert.equal(pageTwo.items.length, 1);
assert.equal(pageTwo.nextCursor, null);
assert.equal(new Set([...pageOne.items, ...pageTwo.items].map(row => row.id)).size, 11);
assert.deepEqual((await receipt(run.id)).decisions, decisions);
assert.equal((await receipt(run.id)).aiExecution, null);
console.log("PASS dispute history and adopted research find fixed receipts; ordered pages, exact original excerpt, scope rejection and no AI dispatch on reopen");

// A result from an already-exported V1 may be retained after V2, but must not replace V2.
await submit(late.id, { ...result, commissionId: late.id });
assert.equal((await receipt(late.id)).baselineCurrent, false);
await exportRun(late.id, 403);
await adopt(late.id, decisions, 403);
await post({ ...create, requestKey: randomUUID() }, 403);
assert.equal((await receipt(late.id)).adoptedResearchId, null);
assert.equal((await get(matter.id, "research", { record: revision.id })).current, true);
console.log("PASS two-case fixed-source commission, exact quoted offsets, replay, lawyer revision V2 and late V1 refusal; CODEX is a synthetic host label");

// Exercise the wire protocol without an external model. Opt in with --mcp.
if (process.argv.includes("--mcp")) {
  const currentCreate = { ...create, researchId: revision.id };
  const protocolRun = await post({ ...currentCreate, requestKey: randomUUID() });
  const otherRun = await post({ ...currentCreate, requestKey: randomUUID(), ranges: [ranges[1]] });
  const grants = [];
  try {
    const grant = await issueGrant(protocolRun.id);
    grants.push({ id: protocolRun.id, grantId: grant.id });
    const otherGrant = await issueGrant(otherRun.id);
    grants.push({ id: otherRun.id, grantId: otherGrant.id });
    assert.equal(grant.endpoint, otherGrant.endpoint);
    const requestedVersion = "2025-06-18";
    let version = requestedVersion;
    let sequence = 0;
    async function rpc(method, params, { token = grant.token, origin, expected = 200, notification = false } = {}) {
      const id = ++sequence;
      const headers = { Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
      if (token !== null) headers.Authorization = "Bearer " + token;
      if (origin) headers.Origin = origin;
      if (method !== "initialize") headers["MCP-Protocol-Version"] = version;
      const response = await fetch(grant.endpoint, {
        method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }),
      });
      assert.equal(response.status, expected, method + " HTTP status");
      if (expected !== 200) return;
      assert.match(response.headers.get("content-type") || "", /application\/json/);
      const message = await response.json();
      assert.equal(message.id, id);
      assert.equal(message.jsonrpc, "2.0");
      assert(!message.error, method + " returned a JSON-RPC error");
      return message.result;
    }
    const call = (name, args, options) => rpc("tools/call", { name, arguments: args }, options);
    function toolValue(toolResult) {
      assert(!toolResult.isError, "Expected the MCP tool to succeed");
      assert.equal(toolResult.content[0].type, "text");
      return JSON.parse(toolResult.content[0].text);
    }

    await rpc("tools/list", {}, { token: null, expected: 401 });
    await rpc("tools/list", {}, { token: "0".repeat(64), expected: 401 });
    await rpc("tools/list", {}, { origin: "https://outside.invalid", expected: 403 });
    const handshake = await rpc("initialize", { protocolVersion: requestedVersion, capabilities: {},
      clientInfo: { name: "lexorder-fixture-smoke", version: "1.0.0" } });
    assert.equal(handshake.serverInfo.name, "lexorder-signoff");
    assert.equal(handshake.protocolVersion, requestedVersion);
    version = handshake.protocolVersion;
    await rpc("notifications/initialized", {}, { notification: true, expected: 202 });
    const tools = await rpc("tools/list", {});
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ["read_signoff_packet", "submit_signoff_result"]);

    const packet = toolValue(await call("read_signoff_packet", {}));
    assert.equal(packet.commissionId, protocolRun.id);
    assert.deepEqual(packet.fragments, bundle.fragments);
    assert.deepEqual(toolValue(await call("read_signoff_packet", {})), packet);
    const isolated = toolValue(await call("read_signoff_packet", {}, { token: otherGrant.token }));
    assert.equal(isolated.commissionId, otherRun.id);
    assert.deepEqual(isolated.fragments.map(fragment => fragment.text), [bundle.fragments[1].text]);
    const hostResult = { ...result, commissionId: protocolRun.id };
    assert.equal((await call("submit_signoff_result", hostResult, { token: otherGrant.token })).isError, true);
    assert.equal((await call("submit_signoff_result", { ...hostResult, host: "WORKBUDDY" })).isError, true);
    assert.equal((await call("submit_signoff_result", { ...wrongQuote, commissionId: protocolRun.id })).isError, true);
    assert.equal((await receipt(protocolRun.id)).result, null);
    assert.equal((await receipt(otherRun.id)).result, null);
    const accepted = toolValue(await call("submit_signoff_result", hostResult));
    assert(accepted.submittedAt);
    assert.equal(toolValue(await call("submit_signoff_result", hostResult)).submittedAt, accepted.submittedAt);
    assert.equal((await receipt(protocolRun.id)).adoptedResearchId, null);
    assert.equal((await revokeGrant(protocolRun.id, grant.id)).revoked, true);
    await call("submit_signoff_result", hostResult, { expected: 401 });
    assert.equal((await receipt(protocolRun.id)).submittedAt, accepted.submittedAt);
    console.log("PASS MCP handshake, scoped tool list, no-cookie Bearer calls, packets, exact citations, host/grant isolation and revoked replay");
  } finally {
    for (const grant of grants) await revokeGrant(grant.id, grant.grantId);
  }
}

async function issueGrant(id) {
  const grant = await post({ action: "grant-signoff-host", matterId: matter.id, id, host: "CODEX", confirmed: true });
  const url = new URL(grant.endpoint);
  assert(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port &&
    url.pathname === "/api/personal/skill-mcp" && !url.username && !url.password && !url.search && !url.hash,
  "Expected the fixture's loopback MCP endpoint");
  assert(typeof grant.token === "string" && /^[0-9a-f]{64}$/.test(grant.token), "Expected a scoped host token");
  return grant;
}
function revokeGrant(id, grantId) {
  return post({ action: "revoke-signoff-host", matterId: matter.id, id, grantId });
}

// Provide credentials for a separate real-client acceptance only when explicitly requested.
if (process.env.M1_SKILL_CODEX_GRANT_OUT === "1") {
  const output = path.join(workspace, "skill-codex-grant.json");
  const file = await open(output, "wx", 0o600);
  let id, grant;
  try {
    const current = await post({ ...create, researchId: revision.id, requestKey: randomUUID() });
    id = current.id;
    grant = await issueGrant(id);
    await file.writeFile(JSON.stringify({ endpoint: grant.endpoint, token: grant.token, commissionId: id,
      matterId: matter.id, grantId: grant.id }) + "\n", "utf8");
    await file.close();
  } catch (error) {
    try {
      if (grant) await revokeGrant(id, grant.id);
    } finally {
      await file.close();
      await unlink(output);
    }
    throw error;
  }
  console.log("Prepared a separate synthetic commission for the real Codex CLI in this fixture workspace.");
}

if (process.argv.includes("--material-impact")) {
  const before = await receipt(run.id);
  assert(before.continuation.items.every(item => item.newerMaterials.length === 0));
  await upload(matter, "独立性能附件", contract + "。");
  const afterUnlinked = await receipt(run.id);
  assert(afterUnlinked.continuation.items.every(item => item.newerMaterials.length === 0));

  const replacement = new FormData();
  replacement.set("file", new File([contract + "。新版须附监理记录。"], "设备合同新版.txt", { type: "text/plain" }));
  replacement.set("matterId", matter.id);
  replacement.set("documentId", second);
  replacement.set("contextInputs", "[]");
  replacement.set("requestKey", randomUUID());
  const version = await (await request("/api/personal/document-review", replacement)).json();
  assert.equal(version.version, 2);
  const impacted = await receipt(run.id);
  const byKind = new Map(impacted.continuation.items.map(item => [item.kind, item.newerMaterials]));
  assert.deepEqual(byKind.get("QUANTITY"), []);
  const [impact] = byKind.get("PERFORMANCE");
  assert.equal(byKind.get("PERFORMANCE").length, 1);
  assert.deepEqual([impact.previous.id, impact.previous.version, impact.latest.id, impact.latest.version], [second, 1, version.id, 2]);
  assert.deepEqual(await history({ record: run.id, fragment: "2" }), { text: bundle.fragments[1].text });
  const [versionRange] = await fixedRanges(matter, [version.id]);
  const next = await post({ ...create, researchId: revision.id, requestKey: randomUUID(), ranges: [versionRange],
    followUp: { priorId: run.id, kind: "PERFORMANCE" } });
  const preview = await receipt(next.id);
  assert.equal(preview.fragments.length, 1);
  assert.equal(preview.fragments[0].documentId, version.id);
  assert.equal(preview.followUp.newFragments, 1);
  assert.equal(preview.aiExecution, null);
  assert.deepEqual((await receipt(run.id)).decisions, decisions);
  console.log("PASS only cited family updates the affected item, unrelated upload unassigned, V1 citation resolves, and V2-only follow-up prepares without model dispatch");
}

if (process.argv.includes("--follow-up")) {
  const supplementText = "双方在补件中确认整批设备通过性能验收";
  const supplement = await upload(matter, "A-118 合成补件", supplementText + "。双方签字。");
  const [supplementRange] = await fixedRanges(matter, [supplement]);
  const handNote = "独立人工备注：另行核对甲方逾期通知。";
  const readResearch = id => get(matter.id, "research", { record: id });
  const revise = (previous, analysis) => post({ action: "revise-research", matterId: matter.id, requestKey: randomUUID(),
    supersedesId: previous.id, expectedVersion: previous.version, analysis: {
      rule: previous.content.rule, exceptions: previous.content.exceptions, supportingAnalysis: previous.content.supportingAnalysis,
      opposingAnalysis: previous.content.opposingAnalysis, conclusion: previous.content.conclusion, unresolved: previous.content.unresolved,
      nextSteps: previous.content.nextSteps, ...analysis,
    },
  });
  const manual = await revise(revised, { conclusion: revised.content.conclusion + "\n\n" + handNote });
  const old = await receipt(run.id);
  assert.equal(old.continuation.researchId, manual.id);
  assert.deepEqual(new Set(old.continuation.items.map(item => item.kind)), new Set(["QUANTITY", "PERFORMANCE"]));
  const nextInput = { ...create, researchId: manual.id, requestKey: randomUUID(), ranges: [supplementRange],
    followUp: { priorId: run.id, kind: "PERFORMANCE" } };
  await post({ ...nextInput, ranges }, 403);
  await post({ ...nextInput, researchId: revision.id }, 403);
  await post({ ...nextInput, ranges: [foreignRange] }, 403);
  await post({ ...nextInput, followUp: { priorId: fromIssue.id, kind: "PERFORMANCE" } }, 403);
  await post({ ...nextInput, followUp: { priorId: run.id, kind: "APPEARANCE" } }, 403);
  const next = await post(nextInput);
  assert.equal((await post(nextInput)).id, next.id);
  await post({ ...nextInput, followUp: { priorId: run.id, kind: "QUANTITY" } }, 403);
  const initial = await receipt(next.id);
  assert.equal(initial.aiExecution, null);
  assert.deepEqual(initial.followUp, { priorId: run.id, kind: "PERFORMANCE", newFragments: 1,
    carried: [{ kind: "QUANTITY", commissionId: run.id, disposition: decisions[0].disposition,
      value: decisions[0].value, reason: decisions[0].reason }],
  });
  const newBundle = await exportRun(next.id);
  assert.equal(newBundle.focus, "PERFORMANCE");
  assert.equal(newBundle.fragments.length, 1);
  assert(newBundle.fragments[0].text.includes(supplementText));
  assert(!newBundle.fragments[0].text.includes(quantity));
  const start = newBundle.fragments[0].text.indexOf(supplementText);
  const candidate = { kind: "PERFORMANCE", assessment: "SUPPORTED", finding: supplementText,
    citations: [{ fragment: 1, start, end: start + supplementText.length, quote: supplementText, relation: "SUPPORTS" }] };
  const supplementResult = { ...result, commissionId: next.id, candidates: [candidate] };
  await submit(next.id, { ...supplementResult, candidates: [{ ...candidate, kind: "QUANTITY" }] }, 403);
  await submit(next.id, { ...supplementResult, candidates: [candidate, { ...candidate, kind: "QUANTITY" }] }, 403);
  await submit(next.id, supplementResult);
  const followDecisions = [{ candidate: 0, disposition: "ADOPT", value: "律师核对后采用双方已签字的整批验收结论。", reason: "A-118有双方签字。" }];
  const changed = await adopt(next.id, followDecisions);
  assert.equal(changed.version, 4);
  const active = await readResearch(changed.id);
  assert(active.content.conclusion.includes(decisions[0].value));
  assert(active.content.conclusion.includes(handNote));
  assert(active.content.conclusion.includes(followDecisions[0].value));
  assert(!active.content.unresolved.includes(decisions[1].value));
  assert(!active.content.supportingAnalysis.includes(decisions[1].reason));
  assert((await readResearch(revision.id)).content.unresolved.includes(decisions[1].value));
  assert.deepEqual((await receipt(run.id)).decisions, decisions);
  assert.equal((await receipt(run.id)).continuation, null);
  const current = await receipt(next.id);
  assert.deepEqual(current.decisions, followDecisions);
  assert.equal(current.continuation.researchId, changed.id);
  assert.deepEqual(current.followUp.carried, initial.followUp.carried);

  const secondRound = await post({ ...nextInput, researchId: changed.id, requestKey: randomUUID(),
    followUp: { priorId: next.id, kind: "QUANTITY" } });
  const secondRoundView = await receipt(secondRound.id);
  assert.deepEqual(secondRoundView.followUp.carried.map(item => [item.kind, item.commissionId, item.value]),
    [["PERFORMANCE", next.id, followDecisions[0].value]]);
  const manuallyChanged = await revise(active, { conclusion: active.content.conclusion.replace(decisions[0].value, "律师手工改写签收数量结论。") });
  const rejected = await post({ ...nextInput, researchId: manuallyChanged.id, requestKey: randomUUID(),
    followUp: { priorId: next.id, kind: "QUANTITY" } }, 403);
  assert.match(rejected.error, /改写|重复/);
  await exportRun(secondRound.id, 403);
  assert.deepEqual(await fixedRanges(matter, [first, second]), ranges, "historical material parsing generations remain reusable");
  console.log("PASS A-118 scoped performance follow-up, only new selected excerpt, preserve quantity and manual text, replace prior issue, retain frozen history, and refuse stale and edited baselines");
}

if (process.argv.includes("--linked-supplement")) {
  const evidenceNow = async () => (await get(matter.id, "evidence-items", {})).items.find(item => item.id === issue.id);
  const attach = async (expectedRevision, range) => post({ action: "link-evidence", matterId: matter.id, data: {
    evidenceItemId: issue.id, expectedRevision, documentId: range.documentId, parseRunId: range.parseRunId, anchorId: range.anchorId,
    relation: "SUPPORTS",
  } });
  const acceptance = (update, requestKey = randomUUID()) => ({
    action: "accept-issue-supplements", matterId: matter.id, researchId: update.researchId, expectedVersion: update.expectedVersion,
    issue: update.issue, requestKey,
  });
  const oldSnapshot = (await get(matter.id, "research", { record: revision.id })).issue;
  const text = "补件确认十二台设备已通过性能验收";
  const addedId = await upload(matter, "A-118 新增争点出处", text + "。签字页另附。");
  const otherAdded = await upload(matter, "A-118 补件签字页", "双方经办人签字确认证据。");
  const [addedRange, otherAddedRange] = await fixedRanges(matter, [addedId, otherAdded]);
  await attach((await evidenceNow()).revision, addedRange);
  const waiting = await receipt(run.id);
  assert.equal(waiting.continuation, null);
  assert.equal(waiting.pendingIssueUpdate.researchId, revision.id);
  assert.deepEqual(waiting.pendingIssueUpdate.materials.map(item => item.id), [addedId]);
  const staleAction = acceptance(waiting.pendingIssueUpdate);
  await post({ ...create, requestKey: randomUUID(), researchId: revision.id, ranges: [addedRange],
    followUp: { priorId: run.id, kind: "PERFORMANCE" } }, 403);

  await attach((await evidenceNow()).revision, otherAddedRange);
  await post(staleAction, 403);
  await post({ ...staleAction, matterId: other.id }, 403);
  const currentUpdate = (await receipt(run.id)).pendingIssueUpdate;
  assert.deepEqual(new Set(currentUpdate.materials.map(item => item.id)), new Set([addedId, otherAdded]));
  const confirm = acceptance(currentUpdate);
  const rebased = await post(confirm);
  assert.equal(rebased.version, revision.version + 1);
  assert.deepEqual(await post(confirm), { ...rebased, replayed: true });
  const after = await get(matter.id, "research", { record: rebased.id });
  assert.equal(after.issue.revision, currentUpdate.issue.revision);
  assert.equal(after.issue.sources.length, 2);
  for (const field of ["conclusion", "unresolved", "supportingAnalysis"]) assert.equal(after.content[field], revised.content[field]);
  assert.deepEqual((await get(matter.id, "research", { record: revision.id })).issue.sources, oldSnapshot.sources);
  assert.deepEqual((await receipt(run.id)).decisions, decisions);
  const continued = await receipt(run.id);
  assert.equal(continued.pendingIssueUpdate, null);
  assert.equal(continued.continuation.researchId, rebased.id);
  assert.deepEqual(new Set(continued.continuation.issueSupplements.map(item => item.id)), new Set([addedId, otherAdded]));
  assert(continued.continuation.items.every(item => item.newerMaterials.length === 0));
  const focused = await post({ ...create, requestKey: randomUUID(), researchId: rebased.id, ranges: [addedRange],
    followUp: { priorId: run.id, kind: "PERFORMANCE" } });
  const next = await receipt(focused.id);
  assert.equal(next.aiExecution, null);
  assert.equal(next.fragments.length, 1);
  assert.equal(next.fragments[0].documentId, addedId);
  const packet = await exportRun(focused.id);
  const start = packet.fragments[0].text.indexOf(text);
  const candidate = { kind: "PERFORMANCE", assessment: "SUPPORTED", finding: text,
    citations: [{ fragment: 1, start, end: start + text.length, quote: text, relation: "SUPPORTS" }] };
  await submit(focused.id, { ...result, commissionId: focused.id, candidates: [candidate] });
  const choices = [{ candidate: 0, disposition: "ADOPT", value: "律师确认补件覆盖设备性能验收。", reason: "A-118 指向整批设备。" }];
  const applied = await adopt(focused.id, choices);
  const afterAdopting = await get(matter.id, "research", { record: applied.id });
  assert.equal(applied.version, rebased.version + 1);
  assert(afterAdopting.content.conclusion.includes(decisions[0].value));
  assert(afterAdopting.content.conclusion.includes(choices[0].value));
  assert(!(afterAdopting.content.unresolved.includes(decisions[1].value)));

  const openSupplements = new Map((await receipt(focused.id)).continuation.issueSupplements.map(item => [item.id, item.eligibleKinds]));
  assert.deepEqual(openSupplements.get(addedId), ["QUANTITY"]);
  assert.deepEqual(new Set(openSupplements.get(otherAdded)), new Set(["QUANTITY", "PERFORMANCE"]));

  const beforeChange = await evidenceNow();
  await post({ action: "revise-evidence", matterId: matter.id, data: {
    evidenceItemId: issue.id, expectedRevision: beforeChange.revision,
    title: beforeChange.title, content: beforeChange.content + "另外增加质保争议。", kind: "ISSUE",
  } });
  const now = await evidenceNow();
  const changed = await receipt(focused.id);
  assert.equal(changed.pendingIssueUpdate, null);
  assert.equal(changed.issueUpdateRequiresReview, true);
  await post(acceptance({ researchId: applied.id, expectedVersion: applied.version,
    issue: { kind: "CURRENT", issueId: issue.id, revision: now.revision, confirmedAt: now.confirmedAt } }), 403);
  console.log("PASS linked A-118 sources require explicit fresh baseline, stale assent rejected, adopted focused review preserves prior decisions, substantive issue change blocks refresh");
}
