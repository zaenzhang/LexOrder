import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createSyntheticCase } from "./create-synthetic-case.mjs";
import { webViewRequest } from "./webview2-request.mjs";

export async function verifyWebView2AnalysisPreview(page, origin, casebookRoot) {
  const request = webViewRequest(page, origin);
  const endpoint = "/api/personal/matter-workspace";
  const tag = randomUUID().slice(0, 8);
  const settings = await (await request("/api/personal/practice-resources?view=ai")).json();
  assert.equal(settings.configured, false, "Use an isolated fixture with app AI unconfigured.");
  const makeCase = suffix => createSyntheticCase(request, {
    title: "分段预检合成案" + suffix + " " + tag, clientName: "预检合成委托方" + suffix + " " + tag,
    description: "验证发送前逐段核对、案卷归属与未配置模型的提示。", casebookRoot,
  });
  const matterId = await makeCase("甲");
  const otherCase = await makeCase("乙");
  const documents = [];
  for (const [name, text] of [
    ["接收回单 " + tag + ".txt", "本单记载 2024 年 5 月 12 日收到第一批设备。"],
    ["另份记录 " + tag + ".txt", "另份原件含独立段落，只应出现在第二份材料自己的预览。"],
  ]) {
    const form = new FormData();
    form.set("file", new File([text], name, { type: "text/plain" }));
    for (const [key, value] of Object.entries({ matterId, name, category: "EVIDENCE", requestKey: randomUUID() })) form.set(key, value);
    await request(endpoint, form);
    const [document] = (await (await request(endpoint + "?" + new URLSearchParams({ matter: matterId, section: "materials", q: name }))).json()).documents;
    documents.push({ documentId: document.id, name, text });
  }
  const grants = { action: "preview-skill-input", data: {
    matterId, purpose: "FACT_ANALYSIS", documents: documents.map(({ documentId }) => ({ documentId })),
  } };
  let coverage;
  const deadline = Date.now() + 90_000;
  do {
    coverage = await (await request(endpoint, grants)).json();
    assert.equal(coverage.modelSupply.sentChars, 0);
    if (coverage.items.every(item => item.processing?.state === "READY")) break;
    await delay(750);
  } while (Date.now() < deadline);
  assert(coverage.items.every(item => item.processing.state === "READY"), "The fixture's materials did not finish parsing.");
  const [batch] = coverage.analysisPlan.batches;
  assert.equal(batch.ranges.length, 2);
  const ranges = batch.ranges.map(({ locationLabel: _label, ...range }) => range);
  const fragment = { action: "preview-matter-observation-fragment", matterId, range: ranges[0] };
  await request(endpoint, { ...fragment, matterId: otherCase }, 403);
  await request(endpoint, { ...fragment, range: { ...fragment.range, parseRunId: ranges[1].parseRunId } }, 403);
  await request(endpoint, { ...fragment, range: { ...fragment.range, end: fragment.range.end + 1 } }, 403);
  await request(endpoint, { ...fragment, range: { ...fragment.range, end: fragment.range.start } }, 400);
  const exact = await (await request(endpoint, fragment)).json();
  assert.deepEqual(exact, { text: documents[0].text });

  await page.setViewportSize({ width: 390, height: 790 });
  await page.goto(origin + "/matters/" + matterId + "/evidence/graph");
  await page.getByRole("link", { name: "准备案情分析", exact: true }).click();
  await page.getByRole("table", { name: "案内材料", exact: true }).getByRole("checkbox", { name: "Select all on this page", exact: true }).check();
  await page.getByRole("button", { name: "分段预检", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "案情分析分段预检", exact: true });
  await sheet.getByText("在「设置 → 应用 AI」配置模型后可确认发送。").waitFor();
  await sheet.getByRole("button", { name: /^第 1 批 · 2 段/ }).click();
  const requests = [];
  const note = event => {
    if (event.url() !== origin + endpoint || event.method() !== "POST") return;
    const body = event.postDataJSON();
    if (body?.action === "preview-matter-observation-fragment") requests.push(body);
  };
  page.on("request", note);
  try {
    const [first] = documents;
    const preview = sheet.getByRole("button", { name: new RegExp("^查看片段 · " + first.name) });
    await preview.waitFor();
    assert.equal(await sheet.getByRole("blockquote").count(), 0);
    assert.deepEqual(requests, []);
    await preview.click();
    const text = sheet.getByRole("blockquote", { name: "本次拟发送的固定片段" });
    await text.waitFor();
    assert.equal(await text.textContent(), first.text);
    assert.deepEqual(requests, [fragment]);
    assert(await text.evaluate(element => {
      const sheet = element.closest('[role="dialog"]').getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      return bounds.left >= sheet.left && bounds.right <= sheet.right;
    }));
    await sheet.getByRole("button", { name: new RegExp("^收起片段 · " + first.name) }).click();
    await text.waitFor({ state: "hidden" });
    assert.equal(await sheet.getByRole("button", { name: /^确认发送/ }).count(), 0);
  } finally {
    page.off("request", note);
  }

  await request(endpoint, { action: "start-matter-observation-run", data: {
    matterId, runId: randomUUID(), confirmed: true, model: settings.textModel, origin: new URL(settings.baseUrl).origin, ranges,
  } }, 403);
  const list = await (await request(endpoint + "?" + new URLSearchParams({ matter: matterId, section: "evidence-items", analysis: "case" }))).json();
  assert.equal(list.destination, null);
  assert.deepEqual(list.runs, []);
  console.log("PASS native case analysis: on-demand exact frozen excerpt, adjacent fragment excluded, invalid and cross-case ranges refused, unconfigured dispatch blocked");
}
