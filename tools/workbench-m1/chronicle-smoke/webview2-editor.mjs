import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { createSyntheticCase } from "./create-synthetic-case.mjs";
import { webViewRequest } from "./webview2-request.mjs";

const run = promisify(execFile);
const workingCopies = "/api/personal/working-copies";
const materials = "/api/personal/matter-workspace";

export async function verifyWebView2Editor(page, origin, { workspace, manifest, casebookRoot }) {
  const request = webViewRequest(page, origin);
  const tag = randomUUID().slice(0, 8);
  const name = "合成工作稿 " + tag + ".txt";
  const copy = async (body, status) => (await request(workingCopies, body, status)).json();
  const list = async matter => (await (await request(materials + "?" +
    new URLSearchParams({ section: "materials", matter, q: name }))).json()).documents;
  const add = async (letter, text, draft) => {
    const matterId = await createSyntheticCase(request, {
      title: "编辑回传合成案 " + letter + " " + tag,
      clientName: "编辑回传合成委托方 " + letter + " " + tag,
      description: "独立验证 Windows 默认编辑器和案卷版本。",
      casebookRoot,
    });
    const form = new FormData();
    form.set("file", new File([text], name, { type: "text/plain" }));
    for (const [key, value] of Object.entries({
      matterId, name, category: "PLEADING", requestKey: randomUUID(),
      ...(draft && { sourceOrigin: "TEAM_PRODUCED" }),
    })) form.set(key, value);
    await request(materials, form);
    const [document] = await list(matterId);
    assert.equal(document.version, 1);
    assert.equal(document.editable, draft);
    return { matterId, ...document };
  };
  const text = ["", "Windows editor A1 baseline", "Windows editor A2 saved", "Windows editor A3 saved",
    "Independent A4 upload", "Windows editor A4 conflicting local edit"];
  const bText = "Windows editor B1 original";
  const a = await add("A", text[1], true);
  const b = await add("B", bText, false);
  await copy({ action: "open", matterId: b.matterId, documentId: a.id }, 409);
  await copy({ action: "open", matterId: b.matterId, documentId: b.id }, 409);

  await page.goto(origin + "/matters/" + a.matterId + "/materials");
  await page.getByRole("table").getByRole("button").filter({ hasText: name }).click();
  const opens = page.waitForResponse(response => response.url() === origin + workingCopies &&
    response.request().postDataJSON()?.action === "open");
  await page.getByRole("button", { name: "用默认编辑器打开", exact: true }).click();
  const opened = await opens;
  assert.equal(opened.status(), 200, await opened.text());
  const { sessionId } = await opened.json();
  // Leave the matter so its UI polling cannot perform the background save.
  await page.goto(origin + "/practice/today");
  const reopen = { action: "reopen", matterId: a.matterId, sessionId };
  await copy({ ...reopen, matterId: b.matterId }, 409);
  const record = path.join(workspace, "working-copies", manifest.workspaceId, manifest.actorId, sessionId + ".json");
  const baseline = JSON.parse(await readFile(record, "utf8"));
  const folder = await (await request("/api/personal/matter-folder?matter=" + a.matterId)).json();
  const file = path.join(folder.path, "工作稿", baseline.file);
  const save = async (expected, next) => {
    const helper = process.env.M1_WINDOWS_EDITOR_SCRIPT ?? path.join(import.meta.dirname, "windows-editor", "save-notepad.ps1");
    assert(path.isAbsolute(helper), "Pass the absolute path to the local Notepad automation script.");
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-File", helper,
      "-WorkingFile", file, "-ExpectedText", expected, "-NewText", next], { timeout: 60_000, windowsHide: true });
    process.stdout.write(result.stdout);
  };
  const savedVersion = async version => {
    for (let attempt = 0; attempt < 45; attempt++) {
      const row = (await list(a.matterId)).find(document => document.version === version);
      if (row) return row;
      await delay(300);
    }
    assert.fail("The native file watcher did not return version " + version);
  };
  await save(text[1], text[2]);
  const v2 = await savedVersion(2);
  await copy(reopen);
  await save(text[2], text[3]);
  const v3 = await savedVersion(3);

  // Reopen the issued working file before publishing a newer independent version.
  await copy(reopen);
  const form = new FormData();
  form.set("file", new File([text[4]], name, { type: "text/plain" }));
  for (const [key, value] of Object.entries({
    matterId: a.matterId, documentId: v3.id, requestKey: randomUUID(), contextInputs: "[]",
  })) form.set(key, value);
  await request("/api/personal/document-review", form);
  const v4 = await savedVersion(4);
  await save(text[3], text[5]);
  for (let attempt = 0; attempt < 45; attempt++) {
    if (JSON.parse(await readFile(record, "utf8")).pending) break;
    await delay(300);
  }
  assert(JSON.parse(await readFile(record, "utf8")).pending, "The watcher did not preserve the conflicting snapshot.");
  const conflict = (await copy({ action: "sync", sessionId })).find(row => row.sessionId === sessionId);
  assert.match(conflict?.message ?? "", /版本冲突/u);
  await copy({ action: "sync", sessionId });
  assert.deepEqual((await list(a.matterId)).map(document => document.version).sort(), [1, 2, 3, 4]);
  assert.equal((await list(a.matterId)).find(document => document.isLatest)?.id, v4.id);
  assert.equal((await list(b.matterId)).length, 1);
  for (const [document, expected] of [[a, text[1]], [v2, text[2]], [v3, text[3]], [v4, text[4]], [b, bText]]) {
    const fixed = await request("/api/documents/" + document.id + "/download");
    assert.deepEqual(await fixed.body(), Buffer.from(expected));
  }
  await copy({ action: "finish", matterId: a.matterId, sessionId, keepLocal: true });
  assert.equal(await readFile(file, "utf8"), text[5]);
  console.log("PASS native Notepad V2/V3; true V4 conflict retained the local edit and all fixed versions; cross-case and original denied");
}
