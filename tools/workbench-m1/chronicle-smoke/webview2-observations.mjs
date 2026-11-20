import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createSyntheticCase } from "./create-synthetic-case.mjs";
import { webViewRequest } from "./webview2-request.mjs";

export async function verifyWebView2Observations(page, origin, casebookRoot) {
  const request = webViewRequest(page, origin);
  const endpoint = "/api/personal/matter-workspace";
  const tag = randomUUID().slice(0, 8);
  const matterId = await createSyntheticCase(request, {
    title: "记载编辑验收 " + tag, clientName: "合成记载编辑委托 " + tag,
    description: "隔离合成案卷，验证人工标注、修订和固定来源历史。", casebookRoot,
  });
  const post = async (action, data) => (await request(endpoint, { action, matterId, data })).json();
  const get = async params => (await (await request(endpoint + "?" + new URLSearchParams({ matter: matterId, ...params }))).json());
  const title = "交付款项核对 " + tag;
  const name = "合成银行回单 " + tag + ".txt";
  const quote = "2023-03-03 ｜ 张三 ｜ 李四 ｜ 480,000.00";
  const material = "交易日期 ｜ 付款人 ｜ 收款人 ｜ 金额（元）\r\n" + quote + "\r\n";
  const form = new FormData();
  form.set("file", new File([material], name, { type: "text/plain" }));
  for (const [key, value] of Object.entries({ matterId, name, category: "EVIDENCE", requestKey: randomUUID() })) form.set(key, value);
  await request(endpoint, form);
  const [document] = (await get({ section: "materials", q: name })).documents;
  let prepared;
  const parsingDeadline = Date.now() + 90_000;
  do {
    const preview = await post("preview-skill-input", { matterId, documents: [{ documentId: document.id }] });
    assert.equal(preview.modelSupply.sentChars, 0);
    prepared = preview.items[0];
    if (prepared.processing?.state === "READY") break;
    assert.notEqual(prepared.processing?.state, "FAILED", JSON.stringify(prepared.processing));
    await delay(750);
  } while (Date.now() < parsingDeadline);
  assert.equal(prepared.processing?.state, "READY", "The local material worker did not parse the fixture within 90 seconds.");
  const fact = { title, content: "核对银行回单记载的付款日期、金额和关系。", kind: "FACT" };
  const { id: evidenceItemId } = await post("create-evidence", {
    matterId, requestKey: randomUUID(), ...fact, sourceDocumentId: null, sourcePage: null, sourceRelation: "CONTEXT",
  });
  const linked = await post("link-evidence", {
    evidenceItemId, expectedRevision: 1, documentId: document.id, relation: "SUPPORTS",
    parseRunId: prepared.run.id, anchorId: prepared.preparation.ranges[0].anchorId,
  });
  assert.equal(linked.revision, 2);

  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(origin + "/matters/" + matterId + "/evidence/graph?item=" + evidenceItemId);
  const detail = page.getByRole("region", { name: "要点与出处", exact: true });
  await detail.getByRole("heading", { name: title, exact: true }).waitFor();
  const source = detail.getByRole("button", { name, exact: true });
  await source.waitFor();
  if (await source.getAttribute("aria-expanded") !== "true") await source.click();
  const add = detail.getByRole("button", { name: "新增记载", exact: true });
  await add.click();
  const create = page.getByRole("dialog", { name: "新增记载", exact: true });
  const note = page.getByRole("textbox", { name: "记载的固定原文", exact: true });
  const button = action => page.getByRole("dialog").getByRole("button", { name: action, exact: true });
  async function mark(text, action) {
    await note.evaluate((input, text) => {
      const start = input.value.indexOf(text);
      if (start < 0) throw new Error("The selected quote is absent from the fixed source.");
      input.focus();
      input.setSelectionRange(start, start + text.length);
    }, text);
    await button(action).click();
  }
  async function choose(label, option) {
    const trigger = page.getByRole("dialog").getByRole("combobox", { name: label, exact: true });
    await trigger.click();
    const listId = await page.waitForFunction(label => {
      const combobox = [...document.querySelectorAll('[role="combobox"][aria-expanded="true"]')]
        .find(element => element.getAttribute("aria-label") === label);
      return combobox?.getAttribute("aria-controls");
    }, label, { timeout: 5000 }).then(value => value.jsonValue());
    const listbox = page.locator('[id="' + listId + '"]');
    await listbox.getByRole("option", { name: option, exact: true }).click();
    await listbox.waitFor({ state: "hidden" });
    assert.equal((await trigger.innerText()).trim(), option);
  }
  const save = button("保存记载");
  const writing = () => page.waitForResponse(response => response.url() === origin + endpoint &&
    response.request().postDataJSON()?.action === "record-evidence-observation");
  await create.waitFor();
  assert(await save.isDisabled());
  await button("设为日期").click();
  await create.getByRole("alert").filter({ hasText: "请先在固定原文中选中文字。" }).waitFor();
  await mark("2023-03-03", "设为日期");
  await mark("480,000.00", "设为金额");
  await mark("金额（元）", "设为金额单位");
  for (const person of ["张三", "李四"]) await mark(person, "添加参与人");
  await mark(quote, "引用为关系");
  await choose("关系类别", "付款");
  await choose("关系起点", "李四");
  await choose("关系终点", "张三");
  await button("应用关系").click();
  // Verify that the fixed footer is on screen while the narrow form scrolls.
  const layout = await save.evaluate(element => {
    const body = element.closest("form").firstElementChild;
    const { top, bottom, right } = element.getBoundingClientRect();
    return { top, bottom, right, screenHeight: innerHeight, screenWidth: document.documentElement.clientWidth,
      scrollHeight: body.scrollHeight, clientHeight: body.clientHeight };
  });
  assert(layout.top >= 0 && layout.bottom <= layout.screenHeight && layout.right <= layout.screenWidth &&
    layout.scrollHeight > layout.clientHeight, JSON.stringify(layout));
  await create.getByText("李四 · 付款 → 张三", { exact: true }).waitFor();
  const wrongDirection = writing();
  await save.click();
  const rejected = await wrongDirection;
  const wrong = rejected.request().postDataJSON().data.observation;
  assert.deepEqual(wrong.relations.map(({ kind, from, to }) => ({ kind, from, to })), [{ kind: "PAYS_TO", from: 2, to: 1 }]);
  assert.equal(rejected.ok(), false, "The server accepted the reversed roles in the bank receipt.");
  await create.getByRole("alert").filter({ hasText: "付款方向与原文标注不符" }).waitFor();
  await create.getByText("李四 · 付款 → 张三", { exact: true }).waitFor();
  await button("修改关系").click();
  await choose("关系起点", "张三");
  await choose("关系终点", "李四");
  await button("应用关系").click();
  const accepted = writing();
  await save.click();
  const first = await accepted;
  assert.equal(first.status(), 200, await first.text());
  const initial = await first.json();
  assert.equal(initial.revision, 3);
  await create.waitFor({ state: "hidden" });

  const records = detail.getByRole("region", { name: "材料记录", exact: true });
  await records.getByText("张三 · 付款 → 李四", { exact: true }).waitFor();
  const revise = page.getByRole("dialog", { name: "修订记载", exact: true });
  async function openRevision() {
    await records.getByRole("button", { name: "记载操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "修订此条记载", exact: true }).click();
    await revise.waitFor();
  }
  await openRevision();
  await choose("金额性质", "实际交付");
  const changed = writing();
  await save.click();
  const update = await changed;
  assert.equal(update.status(), 200, await update.text());
  assert.equal((await update.json()).revision, 4);
  await revise.waitFor({ state: "hidden" });
  await records.getByText("实际交付", { exact: true }).waitFor();

  await page.setViewportSize({ width: 1450, height: 900 });
  const changes = detail.getByRole("button", { name: /^变更记录/ });
  if (await changes.getAttribute("aria-expanded") !== "true") await changes.click();
  await detail.getByRole("button", { name: "记载历史", exact: true }).click();
  const history = page.getByRole("dialog", { name: "记载历史", exact: true });
  await history.getByRole("button", { name: /^要点 V3(?: ·|$)/ }).click();
  await history.getByText("金额", { exact: true }).waitFor();
  await history.getByText("480,000 元", { exact: true }).waitFor();
  await history.getByRole("button", { name: "查看当时出处", exact: true }).click();
  const original = history.getByRole("link", { name: "下载此版本", exact: true });
  await original.waitFor();
  assert((await history.locator("mark").allTextContents()).includes("480,000.00"),
    "The historical original did not highlight the saved amount quotation.");
  assert((await history.locator("mark").allTextContents()).includes("2023-03-03"));
  assert.equal(new URL(await original.getAttribute("href"), origin).pathname, "/api/documents/" + document.id + "/download");
  assert.deepEqual(await (await request("/api/documents/" + document.id + "/download")).body(), Buffer.from(material));
  await history.getByRole("button", { name: "Close", exact: true }).click();
  await history.waitFor({ state: "hidden" });

  await openRevision();
  await choose("金额性质", "诉请金额");
  const newer = await post("revise-evidence", { ...fact, content: "独立请求更新案情说明。", evidenceItemId, expectedRevision: 4 });
  assert.equal(newer.revision, 5);
  const stale = writing();
  await save.click();
  assert.equal((await stale).ok(), false);
  await revise.getByRole("alert").filter({ hasText: /已有新修订/ }).waitFor();
  assert.match(await revise.getByRole("combobox", { name: "金额性质", exact: true }).innerText(), /诉请金额/);
  assert((await note.inputValue()).includes(quote));
  const { items } = await get({ section: "evidence-items", timeline: "1" });
  const saved = items.find(item => item.id === evidenceItemId);
  assert.equal(saved.revision, 5);
  assert.equal(saved.observations.length, 1);
  assert.equal(saved.observations[0].data.amount.nature, "ACTUAL_TRANSFER");
  assert.deepEqual(saved.observations[0].data.amount.value, { currency: "CNY", value: "480000" });
  assert.deepEqual(saved.observations[0].data.date.value, { precision: "EXACT", day: "2023-03-03" });
  assert.deepEqual(saved.observations[0].data.relations.map(({ kind, from, to }) => ({ kind, from, to })), [{ kind: "PAYS_TO", from: 1, to: 2 }]);
  console.log("PASS native fact observations: narrow original selection and save, reversed relation refused, V3 original/V4 revision, stale edit retained");
}
