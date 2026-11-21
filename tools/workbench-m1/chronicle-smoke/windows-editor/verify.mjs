// Run from the repository root on Windows with Microsoft Store Notepad as the .txt association.
// Only the business checkout/save adapter is a fixture. The launcher, watcher,
// directory binding, working-copy registry and process restart are production paths.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const { WorkingCopies } = require("../../../../src/server/desktop/working-copies.ts");
const { openDefaultEditor } = require("../../../../src/server/desktop/default-editor.ts");
const { watchWorkingFile, unwatchWorkingFile } = require("../../../../src/server/desktop/working-watch.ts");
const { changeMatterFolder, matterFolderState, matterSubdirectory } = require("../../../../src/lib/runtime/matter-folders.ts");

const run = promisify(execFile);
const [a, b] = ["a", "b"].map(letter => ({
  id: "c" + letter.repeat(24), internalCode: letter.toUpperCase(), title: "同名 [测试]",
}));
const filename = "同名 [修订].txt";
const content = ["", "A original", "LexOrder native V2", "LexOrder native V3"];
const helper = process.env.M1_WINDOWS_EDITOR_SCRIPT ?? path.join(import.meta.dirname, "save-notepad.ps1");
assert(path.isAbsolute(helper), "Pass the absolute path to the local Notepad automation script.");
const otherFile = async () => path.join(await matterSubdirectory(b.id, "工作稿"), filename);

async function worker(fixture, version) {
  const registry = path.join(fixture, "private", "records");
  const storage = path.join(fixture, "private", "storage");
  const cases = path.join(fixture, "案件 目录");
  const receipts = path.join(fixture, "receipts");
  const session = path.join(fixture, "session.json");
  const workspace = process.env.LEXORDER_PERSONAL_WORKSPACE_ID;
  let file;
  let events = 0;
  let currentSync = Promise.resolve();
  const copies = new WorkingCopies(registry, {
    drafts: id => matterSubdirectory(id, "工作稿"),
    checkout: async (matterId, id) => {
      assert.equal(matterId, a.id);
      assert.equal(id, "A1");
      return { doc: { id, matterId, familyId: id, name: filename, extension: ".txt", version: 1, checkoutJti: "fixture" },
        bytes: Buffer.from(content[1]) };
    },
    read: async (matterId, id) => { assert.equal(matterId, a.id); assert.equal(id, "A2"); },
    launch: async target => { file = target; await openDefaultEditor(target); },
    watch: (target, id, directory) => watchWorkingFile(workspace, id, target, directory, () => {
      events++;
      currentSync = currentSync.then(() => copies.sync(id));
      return currentSync;
    }),
    save: async (doc, bytes, key) => {
      assert.equal(doc.matterId, a.id);
      assert.equal(doc.id, "A" + (version - 1));
      assert.equal(doc.version, version - 1);
      await fs.writeFile(path.join(receipts, key), bytes, { flag: "wx" });
      return { id: "A" + version, version };
    },
  });
  let saved;
  if (version === 2) {
    await Promise.all([fs.mkdir(storage, { recursive: true }), fs.mkdir(receipts)]);
    const created = await fs.mkdir(cases, { recursive: true });
    assert.equal(path.toNamespacedPath(created), path.toNamespacedPath(cases));
    console.log("Windows %s / Node %s; recursive mkdir returned a different path spelling: %s", os.release(), process.version, created !== cases);
    const first = await changeMatterFolder(a, { action: "bind", root: cases }, storage);
    const second = await changeMatterFolder(b, { action: "bind", root: cases }, storage);
    assert.notEqual(first.path, second.path);
    await fs.writeFile(await otherFile(), "B original");
    const opened = await copies.open(a.id, "A1");
    saved = { id: opened.sessionId, file, first: first.path, second: second.path };
    await fs.writeFile(session, JSON.stringify(saved));
  } else {
    saved = JSON.parse(await fs.readFile(session, "utf8"));
    const before = await matterFolderState(a);
    assert.equal(before.path, saved.first);
    const moved = saved.first + "-临时移位";
    await fs.rename(saved.first, moved);
    try {
      await assert.rejects(changeMatterFolder(a, { action: "relocate", path: saved.second }, storage), /归属/);
      assert.equal((await matterFolderState(a)).path, before.path);
    } finally { await fs.rename(moved, saved.first); }
    assert.deepEqual(await matterFolderState(a), before);
    await assert.rejects(copies.reopen(b.id, saved.id), /工作稿记录不存在/);
    assert.equal(file, undefined);
    await copies.reopen(a.id, saved.id);
    assert.equal(file, saved.file);
    console.log("PASS restored both bindings; foreign folder and session rejected; same A working file reopened");
  }
  try {
    // The helper operates only on this unique working-copy window. The default
    // editor performs the disk write. Do not call sync until the watcher has saved.
    const edit = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-File", helper,
      "-WorkingFile", file, "-ExpectedText", content[version - 1], "-NewText", content[version]], { timeout: 60000, windowsHide: true });
    process.stdout.write(edit.stdout);
    const record = path.join(registry, saved.id + ".json");
    const readVersion = async () => JSON.parse(await fs.readFile(record, "utf8")).version;
    for (let i = 0; i < 60 && await readVersion() !== version; i++) await wait(250);
    assert.equal(await readVersion(), version, "watcher did not advance the persisted version");
    assert.ok(events > 0);
    await currentSync;
    await copies.sync(saved.id);
    const keys = await fs.readdir(receipts);
    assert.equal(keys.length, version - 1);
    const bytes = await fs.readFile(file);
    assert.equal(bytes.toString("utf8").replace(/^\uFEFF/, ""), content[version]);
    const versions = await Promise.all(keys.map(key => fs.readFile(path.join(receipts, key))));
    assert.ok(versions.some(received => received.equals(bytes)));
    assert.equal(await fs.readFile(await otherFile(), "utf8"), "B original");
    console.log("PASS pid=%d watcher returned V%d, bytes=%d; duplicate sync and case B unchanged", process.pid, version, bytes.length);
  } finally { unwatchWorkingFile(workspace, saved.id); }
}

async function main() {
  assert.equal(process.platform, "win32", "requires Windows with Notepad as the default .txt editor");
  if (process.argv[2] === "--worker") return worker(process.argv[3], Number(process.argv[4]));
  const fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "lexorder-native-")));
  const env = { ...process.env, LEXORDER_RUNTIME_MODE: "PERSONAL", LEXORDER_PERSONAL_WORKSPACE_ID: randomUUID(),
    LEXORDER_PERSONAL_ORIGIN: "http://127.0.0.1:5001", LEXORDER_PERSONAL_ACTOR_ID: "c" + "x".repeat(24),
    LEXORDER_PERSONAL_CHANNEL_TOKEN: "a".repeat(64), LEXORDER_PERSONAL_MANIFEST: path.join(fixture, "private", "workspace.json") };
  try {
    for (const version of [2, 3]) {
      const result = await run(process.execPath, [import.meta.filename, "--worker", fixture, String(version)], { env, timeout: 90000 });
      process.stdout.write(result.stdout);
    }
  } finally { await fs.rm(fixture, { recursive: true, force: true }); }
}

main().catch(error => {
  if (error.stdout) process.stdout.write(error.stdout);
  console.error(error.stderr || error);
  process.exitCode = 1;
});
