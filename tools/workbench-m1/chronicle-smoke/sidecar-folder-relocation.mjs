import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, lstat, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function verifyFolderRelocation({ roots, matterId, request, download, upload, materials }) {
  const [sourceRoot, targetRoot] = roots;
  assert(roots.length === 2 && roots.every(root => path.isAbsolute(root)), "Pass two isolated casebook parent paths.");
  assert.notEqual((await stat(sourceRoot)).dev, (await stat(targetRoot)).dev, "Use different mounted volumes.");

  const change = (body, status) => request("matter-folder", { body: { matterId, ...body }, status });
  const state = () => request("matter-folder?matter=" + matterId);
  const binding = await change({ action: "bind", root: sourceRoot });
  assert(binding.available);
  assert.equal(path.relative(sourceRoot, path.dirname(binding.path)), "");

  const received = await upload("迁卷核对原件.txt", "合成原件甲，固定版本，跨盘核对。");
  assert.equal(received.ok, true);
  const original = (await materials()).find(doc => doc.name === "迁卷核对原件.txt");
  assert(original);
  const before = await download(original.id);
  assert.equal(before.status, 200);
  const expected = Buffer.from(await before.arrayBuffer());
  assert.equal(expected.toString(), "合成原件甲，固定版本，跨盘核对。");

  // Only rename and copy this freshly created synthetic case directory.
  const moved = path.join(targetRoot, path.basename(binding.path));
  const offline = binding.path + " · 已移开";
  await assert.rejects(lstat(moved), { code: "ENOENT" });
  await assert.rejects(lstat(offline), { code: "ENOENT" });
  await cp(binding.path, moved, { recursive: true, force: false, errorOnExist: true });
  assert.match((await change({ action: "relocate", path: moved }, 409)).error, /原目录仍然存在/);
  await rename(binding.path, offline);
  const pendingName = "磁盘不可用时提交的材料.txt";
  const pendingText = "合成受阻材料，重新定位后重送。";
  const pendingKey = randomUUID();
  const closedName = "失联后决定关闭的上传.txt";
  const closedKey = randomUUID();
  let relocated = false;
  try {
    assert.deepEqual(await state(), { ...binding, available: false });
    const missing = await download(original.id);
    assert.equal(missing.status, 409);
    assert.match((await missing.json()).error, /重新定位/);
    const pending = await upload(pendingName, pendingText, 403, pendingKey);
    assert.match(pending.error, /原件保存未完成/);
    assert(!(await materials()).some(doc => doc.name === pendingName));
    await upload(closedName, "合成放弃上传", 403, closedKey);

    const stamp = path.join(moved, ".lexorder-matter.json");
    const identity = await readFile(stamp);
    const wrong = { ...JSON.parse(identity), matterId: "c" + "a".repeat(24) };
    await writeFile(stamp, JSON.stringify(wrong));
    assert.match((await change({ action: "relocate", path: moved }, 409)).error, /归属不符/);
    await writeFile(stamp, identity);

    const originals = path.join(moved, "已入卷");
    const files = (await readdir(originals, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());
    assert(files.length >= 2);
    const candidate = await Promise.all(files.map(async entry => {
      const filename = path.join(entry.parentPath, entry.name);
      const bytes = await readFile(filename);
      return { filename, bytes };
    }));
    const exact = candidate.find(file => file.bytes.equals(expected));
    assert(exact, "Could not identify text fixture in the new directory");
    await writeFile(exact.filename, Buffer.alloc(exact.bytes.length, 1));
    assert.match((await change({ action: "relocate", path: moved }, 409)).error, /内容无法核对/);
    assert.deepEqual(await state(), { ...binding, available: false });
    await writeFile(exact.filename, exact.bytes);
    assert.equal((await change({ action: "relocate", path: moved })).available, true);
    relocated = true;
    assert.equal(path.relative(moved, (await state()).path), "");
    const after = await download(original.id);
    assert.equal(after.status, 200);
    assert.deepEqual(Buffer.from(await after.arrayBuffer()), expected);
  } finally {
    if (!relocated) await rename(offline, binding.path);
  }
  return { originalId: original.id, expected, moved, pendingName, pendingText, pendingKey, closedKey };
}
