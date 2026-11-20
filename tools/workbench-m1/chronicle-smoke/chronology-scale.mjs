import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { fixture } from "./fixture.mjs";

export async function seedChronologyScale(request, casebookRoot) {
  assert(path.isAbsolute(casebookRoot), "Pass an absolute casebook root inside the disposable fixture.");
  const workspaceEndpoint = "/api/personal/matter-workspace";
  const practiceEndpoint = "/api/personal/practice";
  const practice = async body => (await request(practiceEndpoint, body)).json();
  const post = async (action, data, matterId) => (await request(workspaceEndpoint, { action, data, ...(matterId && { matterId }) })).json();
  const tag = randomUUID().slice(0, 8);
  const title = "图谱规模验收 " + tag;
  const client = await practice({ action: "create-client", input: { name: "合成规模验收委托方 " + tag, type: "COMPANY" } });
  const intake = await practice({ action: "create-intake", input: {
    title, category: "NON_LITIGATION", clientId: client.id, description: "隔离合成案卷，核对时间轴、材料定位和分页。",
  } });
  await practice({ action: "check-intake", id: intake.id });
  const { check } = await (await request(practiceEndpoint + "?" + new URLSearchParams({ view: "intake", id: intake.id }))).json();
  await practice({ action: "decide-conflict", id: check.id, conclusion: "DIFFERENT", note: "本机合成样本" });
  await practice({ action: "submit-intake", id: intake.id });
  const { matterId } = await practice({ action: "convert-intake", id: intake.id });
  const get = async (section, params) => request(workspaceEndpoint + "?" + new URLSearchParams({ section, matter: matterId, ...params }));
  await request("/api/personal/matter-folder", { matterId, action: "bind", root: casebookRoot });

  const procedureIds = [];
  for (const [label, day] of [["规模验收一审", "2024-06-15"], ["规模验收财产保全", "2024-07-05"]]) {
    const { id: procedureId } = await post("add-procedure", {
      matterId, type: "CUSTOM", customLabel: label, engagement: "INFORMATIONAL",
    });
    procedureIds.push(procedureId);
    await post("add-deadline", { procedureId, title: label + "期限", duePrecision: "DATE", dueAt: day, remindDays: 2 }, matterId);
  }

  const files = [];
  for (let i = 1; i <= 12; i++) {
    const name = "合成附件 " + String(i).padStart(2, "0") + " " + "设备交接与分批复核".repeat(7) + ".txt";
    const quote = "原件记载批次 " + i + "，交接日期为 2024 年 6 月 15 日。";
    const text = quote + "\n" + ("合成附件附录文字，用于核对固定原件阅读和滚动。\n").repeat(60);
    const form = new FormData();
    form.set("file", new File([text], name, { type: "text/plain" }));
    for (const [key, value] of Object.entries({ matterId, name, category: "EVIDENCE", requestKey: randomUUID() })) form.set(key, value);
    assert.equal((await (await request(workspaceEndpoint, form)).json()).ok, true);
    const { documents } = await (await get("materials", { q: name })).json();
    assert.equal(documents.length, 1);
    files.push({ id: documents[0].id, name, quote });
  }

  const created = [];
  for (let i = 1; i <= 120; i++) {
    const eventDate = i <= 100 ? { precision: "EXACT", start: "2024-06-15", end: null, text: null }
      : i <= 110 ? { precision: "RANGE", start: "2023-12-" + (i - 80), end: "2024-01-" + (i - 90), text: null }
      : i <= 115 ? { precision: "UNKNOWN", start: null, end: null, text: "当事人未载明日期" }
      : { precision: "EXACT", start: "2025-01-" + (i - 100), end: null, text: null };
    const id = (await post("create-evidence", {
      matterId, requestKey: randomUUID(), title: "合成图谱事项 " + String(i).padStart(3, "0"), kind: i > 115 ? "CLAIM" : "FACT",
      eventDate, content: "核对本条固定记载与案卷材料。" + "附带段落用于检查案件正文与原文能分别滚动。".repeat(12),
      sourceRelation: "CONTEXT", sourcePage: null, sourceDocumentId: i === 100 ? null : files[(i - 1) % files.length].id,
    })).id;
    assert(id);
    created.push(id);
  }

  const file = files[0];
  let coverage;
  const deadline = Date.now() + 45_000;
  do {
    coverage = await post("preview-skill-input", { matterId, documents: files.map(({ id: documentId }) => ({ documentId })) });
    assert.equal(coverage.modelSupply.sentChars, 0);
    if (coverage.items.every(item => item.processing?.state === "READY")) break;
    assert(Date.now() < deadline, "Timed out waiting for synthetic document parsing");
    await delay(500);
  } while (true);
  const parsed = coverage.items.find(item => item.documentId === file.id);
  const evidenceItemId = created[99];
  const link = await post("link-evidence", {
    evidenceItemId, expectedRevision: 1, documentId: file.id, relation: "SUPPORTS", parseRunId: parsed.run.id,
    anchorId: parsed.preparation.ranges[0].anchorId,
  }, matterId);

  const metrics = [];
  for (let pass = 0; pass < 5; pass++) {
    const start = performance.now();
    const response = await get("evidence-items", { timeline: "1" });
    const payload = await response.text();
    metrics.push({ ms: Math.round(performance.now() - start), bytes: Buffer.byteLength(payload) });
    const items = JSON.parse(payload).items;
    assert.equal(items.length, 120);
    assert.equal(items.filter(item => item.eventDate.start === "2024-06-15").length, 100);
    assert.equal(items.filter(item => item.eventDate.precision === "UNKNOWN").length, 5);
    assert.equal(new Set(items.flatMap(item => item.sources.map(source => source.documentId))).size, 12);
  }
  const start = performance.now();
  const source = await (await request("/api/personal/evidence-review", {
    action: "open-evidence-source", matterId, evidenceItemId, sourceId: link.sourceId, revision: link.revision,
  })).json();
  const sourceMs = Math.round(performance.now() - start);
  assert.equal(source.status, "AVAILABLE");
  assert.equal(source.documentVersion, 1);
  assert(source.text.includes(file.quote));
  const { programs } = await (await get("evidence-items", { programs: "1" })).json();
  const relevant = programs.filter(program => procedureIds.includes(program.id));
  assert.equal(relevant.length, 2);
  assert(relevant.every(program => program.events.length === 1 && program.events[0].kind === "法律期限"));
  return { matterId, title, evidenceItemId, sourceName: file.name, sourceQuote: file.quote, timeline: metrics, sourceMs, modelCalls: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { request, cases: [reference] } = await fixture();
  const folder = await (await request("/api/personal/matter-folder?matter=" + reference.id)).json();
  assert(folder.available && folder.path, "The disposable fixture must have a bound case directory");
  console.log(JSON.stringify(await seedChronologyScale(request, path.dirname(folder.path))));
}
