import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { createSyntheticCase } from "./create-synthetic-case.mjs";
import { webViewRequest } from "./webview2-request.mjs";

export async function verifyWebView2MaterialUploads(page, origin, casebookRoot) {
  const request = webViewRequest(page, origin);
  const endpoint = "/api/personal/matter-workspace";
  const tag = randomUUID().slice(0, 8);
  const name = "待恢复材料 " + tag + ".txt";
  const text = "本文件是用于重开工作区后恢复入卷的合成原件。";
  const matterId = await createSyntheticCase(request, {
    title: "恢复上传验收 " + tag, clientName: "合成委托 " + tag, description: "恢复上传验收", casebookRoot,
  });
  const { path: directory } = await (await request("/api/personal/matter-folder?matter=" + matterId)).json();
  const unavailable = directory + " · 已移开";
  const form = new FormData();
  form.set("file", new File([text], name, { type: "text/plain" }));
  for (const [key, value] of Object.entries({ matterId, name, category: "EVIDENCE", requestKey: randomUUID() })) form.set(key, value);
  await rename(directory, unavailable);
  try {
    assert.match((await (await request(endpoint, form, 403)).json()).error, /原件保存未完成/);
  } finally {
    await rename(unavailable, directory);
  }

  await page.setViewportSize({ width: 390, height: 790 });
  await page.goto(origin + "/matters/" + matterId + "/materials");
  const trigger = page.getByRole("button", { name: "批量导入", exact: true });
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "批量导入材料", exact: true });
  const unfinished = sheet.getByRole("region", { name: "未完成上传", exact: true });
  await unfinished.getByText(name, { exact: true }).waitFor();
  await unfinished.getByRole("button", { name: "继续处理", exact: true }).click();
  await unfinished.getByRole("alert").getByText(/重新选择文件/).waitFor();
  await unfinished.getByRole("button", { name: "重新选择原文件", exact: true }).click();
  const picker = unfinished.getByLabel("选择与原提交内容相同的文件");
  const select = value => picker.setInputFiles({ name: "重新选择.txt", mimeType: "text/plain", buffer: Buffer.from(value) });
  await select("错误的合成文件");
  await unfinished.getByRole("alert").getByText(/不一致/).waitFor();
  await select(text);
  await sheet.getByRole("status").getByText("已恢复上传，材料已入卷。", { exact: true }).waitFor();
  await unfinished.getByText(name, { exact: true }).waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });
  await trigger.evaluate(node => {
    if (document.activeElement !== node) throw new Error("The upload sheet did not return keyboard focus.");
  });
  const table = page.getByRole("table", { name: "案内材料", exact: true });
  await table.getByText(name, { exact: true }).waitFor();
  assert.equal(await table.getByText(name, { exact: true }).count(), 1);
  console.log("PASS WebView2 narrow upload sheet shows persisted failure, refuses wrong bytes, recovers file, updates catalog and returns focus");
}
