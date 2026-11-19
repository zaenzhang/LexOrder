import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { fixture } from "./fixture.mjs";

const { workspace, manifest, cases, request } = await fixture();
const [A, B] = cases;
const api = request;
const copies = async (input, status) => (await api("/api/personal/working-copies", input, status)).json();
const list = async (m) =>
  (await (await api("/api/personal/matter-workspace?section=materials&matter=" + m.id)).json()).documents;
for (const m of [A, B]) {
  const state = await (await api("/api/personal/matter-folder?matter=" + m.id)).json();
  if (!state.path) {
    const dir = workspace + "-editor-cases";
    await fs.mkdir(dir, { recursive: true });
    await api("/api/personal/matter-folder", { action: "bind", matterId: m.id, root: dir });
  } else if (!state.available) {
    // The same synthetic workspace may have been bound by an older Personal
    // runtime. Revalidate its marker and every original through the public route.
    await api("/api/personal/matter-folder", { action: "relocate", matterId: m.id, path: state.path });
  }
}
const name = "编辑回传同名稿-" + randomUUID().slice(0, 8) + ".txt";
async function add(m, draft) {
  const form = new FormData();
  form.set("file", new File([m.internalCode + " fixed original\n"], name, { type: "text/plain" }));
  for (const [k, v] of Object.entries({
    matterId: m.id,
    name,
    category: "PLEADING",
    requestKey: randomUUID(),
    ...(draft ? { sourceOrigin: "TEAM_PRODUCED" } : {}),
  }))
    form.set(k, v);
  await api("/api/personal/matter-workspace", form);
  return (await list(m)).find((row) => row.name === name && row.version === 1);
}
const a = await add(A, true),
  b = await add(B, false);
assert(a?.editable && !b?.editable, "correct DRAFT / received-original projection");
await copies({ action: "open", matterId: B.id, documentId: a.id }, 409);
await copies({ action: "open", matterId: B.id, documentId: b.id }, 409);
const active = await copies({ action: "open", matterId: A.id, documentId: a.id });
const privateRoot = path.join(workspace, "working-copies", manifest.workspaceId, manifest.actorId);
const record = path.join(privateRoot, active.sessionId + ".json");
const baseline = JSON.parse(await fs.readFile(record, "utf8"));
const folder = await (await api("/api/personal/matter-folder?matter=" + A.id)).json();
const work = path.join(folder.path, "工作稿", baseline.file);
async function syncVersion(v) {
  for (let n = 0; n < 30; n++) {
    await wait(400);
    const row = (await list(A)).find((r) => r.name === name && r.version === v);
    if (row) return row;
  }
  throw Error("editor callback did not create V" + v);
}
// No sync request here: the OS watcher must initiate the return on its own.
const v2 = await syncVersion(2);
assert.match(await fs.readFile(work, "utf8"), /Linux default editor saved/);
await copies({ action: "sync" });
const retained = JSON.parse(await fs.readFile(record, "utf8"));
const temp = work + ".save";
await fs.writeFile(temp, "经编辑器替换保存的第三版\n");
await fs.rename(temp, work);
const v3 = await syncVersion(3);
await copies({ action: "sync" });
await copies({ action: "sync" });
const rows = (await list(A)).filter((row) => row.name === name);
assert.deepEqual(rows.map((r) => r.version).sort(), [1, 2, 3]);
assert.equal(rows.find((r) => r.id === v3.id)?.isLatest, true);
assert.equal((await list(B)).filter((row) => row.name === name).length, 1);
const read = async (id) => (await api("/api/documents/" + id + "/download")).text();
assert.equal(await read(a.id), A.internalCode + " fixed original\n");
assert.match(await read(v2.id), /Linux default editor saved/);
assert.equal(await read(v3.id), "经编辑器替换保存的第三版\n");
assert.equal(await read(b.id), B.internalCode + " fixed original\n");
// Replay an actual offline V2 binding while the database already holds V3.
const stale = { ...retained, sessionId: randomUUID(), file: "离线" + retained.file };
const staleFile = path.join(folder.path, "工作稿", stale.file);
await fs.writeFile(staleFile, "离线工作稿\n");
await fs.utimes(staleFile, new Date(0), new Date(0));
await fs.writeFile(path.join(privateRoot, stale.sessionId + ".json"), JSON.stringify(stale));
const conflict = (await copies({ action: "sync" })).find((row) => row.sessionId === stale.sessionId);
assert.match(conflict.message, /版本冲突/);
assert.equal(await fs.readFile(staleFile, "utf8"), "离线工作稿\n");
assert.equal((await list(A)).filter((row) => row.name === name).length, 3);
await copies({ action: "finish", matterId: A.id, sessionId: stale.sessionId, keepLocal: true });
await copies({ action: "finish", matterId: A.id, sessionId: active.sessionId, keepLocal: false });
assert.equal(await fs.readFile(staleFile, "utf8"), "离线工作稿\n");
console.log(
  "PASS Linux default editor via xdg-open/Vim Ex; two real matters; V1/V2/V3 byte reads; 2 duplicate syncs; cross-case/original denial; restored stale V2 refused and local file preserved",
);
