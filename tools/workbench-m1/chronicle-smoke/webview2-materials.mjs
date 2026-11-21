import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSyntheticCase } from "./create-synthetic-case.mjs";
import { webViewRequest } from "./webview2-request.mjs";

export async function verifyWebView2Materials(page, origin, casebookRoot) {
  const request = webViewRequest(page, origin);
  const endpoint = "/api/personal/matter-workspace";
  const tag = randomUUID().slice(0, 8);
  const matterId = await createSyntheticCase(request, {
    title: "案卷整理验收 " + tag, clientName: "合成案卷整理委托 " + tag,
    description: "隔离合成案卷，验收跨页归类、固定原件与卷宗顺序。", casebookRoot,
  });
  const post = async (action, data) => (await request(endpoint, { action, matterId, ...data })).json();
  const list = async params => (await (await request(endpoint + "?" +
    new URLSearchParams({ section: "materials", matter: matterId, ...params }))).json());
  const prefix = "批量材料 " + tag;
  async function upload(name, sourceOrigin) {
    const data = new FormData();
    data.set("file", new File([name], name + ".txt", { type: "text/plain" }));
    for (const [key, value] of Object.entries({
      matterId, name, category: "OTHER", requestKey: randomUUID(), ...(sourceOrigin && { sourceOrigin }),
    })) data.set(key, value);
    await request(endpoint, data);
  }
  for (let index = 0; index < 22; index++) {
    await upload(prefix + " " + String(index + 1).padStart(2, "0"));
  }
  const historyName = "换版样本 " + tag;
  await upload(historyName, "TEAM_PRODUCED");
  const [original] = (await list({ q: historyName })).documents;
  const replacement = new FormData();
  replacement.set("file", new File(["更新后的案卷材料"], historyName + ".txt", { type: "text/plain" }));
  for (const [key, value] of Object.entries({
    matterId, documentId: original.id, requestKey: randomUUID(), contextInputs: "[]",
  })) replacement.set(key, value);
  await request("/api/personal/document-review", replacement);
  for (const name of ["材料甲卷", "材料乙卷", "材料丙卷"]) await post("create-volume", { name });

  await page.setViewportSize({ width: 1460, height: 880 });
  await page.goto(origin + "/matters/" + matterId + "/materials");
  const table = page.getByRole("table", { name: "案内材料", exact: true });
  const category = page.getByRole("button", { name: "更改类别", exact: true });
  const history = page.getByRole("tab", { name: "历史版本", exact: true });
  const current = page.getByRole("tab", { name: "当前版本", exact: true });
  await history.click();
  const historicalRow = table.getByRole("row").filter({ hasText: historyName }).filter({ hasText: "V1 · 历史版本" });
  await historicalRow.getByRole("checkbox").check();
  await page.getByText("选材含历史或审核版本，移除后可更改类别。").waitFor();
  assert(await category.isDisabled(), "The known historical selection must disable bulk classification.");
  await current.click();
  await historicalRow.waitFor({ state: "hidden" });
  assert(await category.isDisabled(), "Bulk classification became available when the selected historical version left the page.");
  await page.getByText("选材含历史或审核版本，移除后可更改类别。").waitFor();
  await page.getByRole("button", { name: "清空选材", exact: true }).click();

  const search = page.getByRole("textbox", { name: "搜索案内材料" });
  const selectPage = table.getByRole("checkbox", { name: "Select all on this page" });
  const lastRow = table.getByRole("row").filter({ hasText: prefix + " 01" });
  await search.fill(prefix);
  await table.getByRole("row").filter({ hasText: historyName }).waitFor({ state: "hidden" });
  assert.equal(await table.getByRole("row").count(), 21);
  await selectPage.check();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await lastRow.waitFor();
  assert.equal(await table.getByRole("row").count(), 3);
  await selectPage.check();
  const selected = page.getByRole("status").filter({ hasText: "已选 22 份材料" });
  await selected.waitFor();
  await category.press("Enter");
  const editor = page.getByRole("dialog", { name: "更改材料类别" });
  await editor.getByText(/更新已勾选的 22 份材料/).waitFor();
  const kind = editor.getByRole("combobox", { name: "目标类别" });
  await kind.click();
  await page.getByRole("option", { name: "合同", exact: true }).click();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await selected.waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === "更改类别");
  await category.click();
  await kind.click();
  await page.getByRole("option", { name: "合同", exact: true }).click();
  await editor.getByRole("button", { name: "保存类别", exact: true }).click();
  await page.getByText("已更新 22 份材料的类别。").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "搜索案内材料");
  assert.equal(await search.inputValue(), prefix);
  const reorganized = (await list({ q: prefix, category: "CONTRACT" })).documents;
  assert.equal(reorganized.length, 22);
  for (const document of [reorganized[0], reorganized.at(-1), original]) {
    assert.deepEqual(await (await request("/api/documents/" + document.id + "/download")).body(), Buffer.from(document.name));
  }
  console.log("PASS native materials: historical selection retained, 22 targets across 2 pages, cancel/focus, original bytes");

  await page.setViewportSize({ width: 390, height: 790 });
  const manage = page.getByRole("button", { name: "管理卷宗", exact: true });
  await manage.click();
  const volume = page.getByRole("dialog", { name: "案内卷宗" });
  const order = volume.getByRole("combobox", { name: "操作", exact: true });
  await order.selectOption("reorder-volumes");
  const { folders } = await list({});
  const [first, second, third, ...remaining] = folders;
  const remainingIds = remaining.map(folder => folder.id);
  const moveSecond = volume.getByRole("button", { name: "上移 " + second.name, exact: true });
  await moveSecond.click();
  const save = volume.getByRole("button", { name: "保存", exact: true });
  const expectedOrder = folders.map(folder => folder.id);
  // A simultaneous writer moves the third folder to the front before our save.
  const concurrentOrder = [third.id, first.id, second.id, ...remainingIds];
  await post("reorder-volumes", { expectedOrder, orderedIds: concurrentOrder });
  await save.click();
  await volume.getByRole("alert").filter({ hasText: /卷宗清单或顺序已变化/ }).waitFor();
  assert.deepEqual((await list({})).folders.map(folder => folder.id), concurrentOrder);
  // Switch back to a fresh baseline, then apply a different order.
  const folderFilter = page.locator('select[aria-label="筛选案内卷宗"]');
  await folderFilter.locator("option").nth(2).filter({ hasText: third.name }).waitFor({ state: "attached" });
  await order.selectOption("file-in-volume");
  await order.selectOption("reorder-volumes");
  const submittedOrder = [third.id, second.id, first.id, ...remainingIds];
  await moveSecond.click();
  assert(await save.evaluate(element => {
    const { left, right } = element.getBoundingClientRect();
    return left >= 0 && right <= document.documentElement.clientWidth;
  }));
  await save.click();
  await volume.waitFor({ state: "hidden" });
  await page.reload();
  await folderFilter.waitFor();
  assert.deepEqual((await folderFilter.locator('option').allTextContents()).slice(2), [third.name, second.name, first.name, ...remaining.map(folder => folder.name)]);
  assert.deepEqual((await list({})).folders.map(folder => folder.id), submittedOrder);
  console.log("PASS native volumes: narrow sheet, concurrent stale order rejected, fresh save and reload");
}
