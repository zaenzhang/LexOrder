import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeMatterFolder, matterFolderState, matterSubdirectory } from "@/lib/runtime/matter-folders";

const a = { id: "c" + "a".repeat(24), internalCode: "案-01", title: "中文同名案件" };
const b = { id: "c" + "b".repeat(24), internalCode: "案-02", title: "中文同名案件" };
let scratch: string, root: string, storageRoot: string;
let storage: import("@/lib/storage/local").LocalStorageProvider;
beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "lexorder-folder-"));
  root = path.join(scratch, "我的案件");
  const workspace = path.join(scratch, "工作区");
  storageRoot = path.join(workspace, "storage");
  await Promise.all([fs.mkdir(root), fs.mkdir(storageRoot, { recursive: true })]);
  vi.stubEnv("LEXORDER_RUNTIME_MODE", "PERSONAL");
  vi.stubEnv("LEXORDER_PERSONAL_MANIFEST", path.join(workspace, "workspace.json"));
  vi.stubEnv("LEXORDER_PERSONAL_WORKSPACE_ID", randomUUID());
  vi.stubEnv("LEXORDER_PERSONAL_ACTOR_ID", "c" + "x".repeat(24));
  vi.stubEnv("LEXORDER_PERSONAL_CHANNEL_TOKEN", "a".repeat(64));
  vi.stubEnv("LEXORDER_PERSONAL_ORIGIN", "http://127.0.0.1:5001");
  vi.stubEnv("APP_STORAGE_DIR", storageRoot);
  vi.resetModules();
  const { LocalStorageProvider } = await import("@/lib/storage/local");
  storage = new LocalStorageProvider();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(scratch, { force: true, recursive: true });
});

it("双案使用相同的原件文件名，切换后从各自目录读写；新的 Node 进程重开保持同一历史引用", async () => {
  const originalKey = "202611/同名材料.bin";
  const key = (id: string) => "m_" + id + "/" + originalKey;
  await storage.writeFileAt(key(a.id), Buffer.from("A-既有版本"));
  const [first, second] = await Promise.all([a, b].map(m => changeMatterFolder(m, { action: "bind", root }, storageRoot)));
  expect(first.path).not.toBe(second.path);
  expect(await fs.readFile(path.join(first.path!, "已入卷", originalKey), "utf8")).toBe("A-既有版本");
  await storage.writeFileAt(key(b.id), Buffer.from("B-同名原件"));
  await expect(storage.writeFileAt(key(a.id), Buffer.from("覆盖"))).rejects.toMatchObject({ code: "EEXIST" });
  const newKey = await storage.writeFile("m_" + a.id, Buffer.from("A-后续版本"));
  await fs.writeFile(path.join(await matterSubdirectory(a.id, "工作稿"), "答辩.txt"), "A稿");
  await fs.writeFile(path.join(await matterSubdirectory(b.id, "工作稿"), "答辩.txt"), "B稿");
  for (const [m, expected] of [[a, "A-既有版本"], [b, "B-同名原件"], [a, "A-既有版本"]] as const) {
    expect((await storage.readFile(key(m.id))).toString()).toBe(expected);
  }
  const reopened = await promisify(execFile)(process.execPath, ["--import", "tsx", "-e", `
    const { LocalStorageProvider } = require('./src/lib/storage/local.ts');
    const { matterSubdirectory } = require('./src/lib/runtime/matter-folders.ts');
    const fs = require('node:fs/promises'); const path = require('node:path');
    const store = new LocalStorageProvider();
    (async () => {
      const values = [];
      for (const original of process.argv.slice(1, 4)) values.push((await store.readFile(original)).toString());
      for (const id of process.argv.slice(4)) values.push(await fs.readFile(path.join(await matterSubdirectory(id, '工作稿'), '答辩.txt'), 'utf8'));
      console.log(JSON.stringify(values));
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `, key(a.id), key(b.id), newKey, a.id, b.id]);
  expect(JSON.parse(reopened.stdout)).toEqual(["A-既有版本", "B-同名原件", "A-后续版本", "A稿", "B稿"]);
  await expect(fs.access(path.join(storageRoot, "m_" + a.id))).rejects.toMatchObject({ code: "ENOENT" });
});

it("改名后原路径失效，拒绝跨案重定位、目录链接和缺失的案件原件", async () => {
  const aa = await changeMatterFolder(a, { action: "bind", root }, storageRoot);
  const bb = await changeMatterFolder(b, { action: "bind", root }, storageRoot);
  const key = await storage.writeFile("m_" + a.id, Buffer.from("固定的历史版本"));
  const moved = path.join(root, "重新命名");
  await fs.rename(aa.path!, moved);
  expect(await matterFolderState(a)).toMatchObject({ available: false, path: aa.path });
  await expect(storage.readFile(key)).rejects.toThrow("案件目录不可用");
  await expect(changeMatterFolder(a, { action: "relocate", path: bb.path! }, storageRoot)).rejects.toThrow("归属");
  expect((await changeMatterFolder(a, { action: "relocate", path: moved }, storageRoot)).available).toBe(true);
  expect((await storage.readFile(key)).toString()).toBe("固定的历史版本");
  const nested = path.join(moved, "已入卷", "其他目录");
  await fs.symlink(path.join(bb.path!, "工作稿"), nested, "junction");
  await expect(storage.writeFileAt("m_" + a.id + "/其他目录/新文件.bin", Buffer.from("X"))).rejects.toThrow("其他位置");
  await expect(fs.access(path.join(bb.path!, "工作稿", "新文件.bin"))).rejects.toMatchObject({ code: "ENOENT" });
  await fs.unlink(path.join(moved, "已入卷", ...key.split("/").slice(1)));
  await expect(storage.readFile(key)).rejects.toMatchObject({ code: "ENOENT" });
});

it("绑定期间交错上传不丢原件，不接管既有目录，不在另一案中创建嵌套案", async () => {
  const old = path.join(root, (await matterFolderState(a)).suggestedName);
  await fs.mkdir(old);
  await expect(changeMatterFolder(a, { action: "bind", root }, storageRoot)).rejects.toThrow("同名目录");
  await fs.rmdir(old);
  const [firstKey, bound, lastKey] = await Promise.all([
    storage.writeFile("m_" + a.id, Buffer.from("第一件")),
    changeMatterFolder(a, { action: "bind", root }, storageRoot),
    storage.writeFile("m_" + a.id, Buffer.from("第二件")),
  ]);
  expect(await Promise.all([firstKey, lastKey].map(async key => (await storage.readFile(key)).toString()))).toEqual(["第一件", "第二件"]);
  await expect(changeMatterFolder(b, { action: "bind", root: bound.path! }, storageRoot)).rejects.toThrow("嵌套");
  expect(await changeMatterFolder(a, { action: "bind", root }, storageRoot)).toEqual(bound);
});

it("从收案转入案件的历史材料保持原 i_ 键，案内新材料使用独立命名空间", async () => {
  const intakeId = "c" + "i".repeat(24);
  const intakeKey = "i_" + intakeId + "/202611/同名.bin";
  const matterKey = "m_" + a.id + "/202611/同名.bin";
  await storage.writeFileAt(intakeKey, Buffer.from("送审收案件"));
  const state = await changeMatterFolder({ ...a, intakeId }, { action: "bind", root }, storageRoot);
  await storage.writeFileAt(matterKey, Buffer.from("正式案件件"));
  expect(await fs.readFile(path.join(state.path!, "已入卷/收案原件/202611/同名.bin"), "utf8")).toBe("送审收案件");
  expect((await storage.readFile(intakeKey)).toString()).toBe("送审收案件");
  expect((await storage.readFile(matterKey)).toString()).toBe("正式案件件");
  const moved = path.join(root, "新案目录");
  await fs.rename(state.path!, moved);
  await expect(storage.readFile(intakeKey)).rejects.toThrow("案件目录不可用");
  await changeMatterFolder({ ...a, intakeId }, { action: "relocate", path: moved }, storageRoot);
  expect((await storage.readFile(intakeKey)).toString()).toBe("送审收案件");
  await expect(fs.access(path.join(storageRoot, "i_" + intakeId))).rejects.toMatchObject({ code: "ENOENT" });
});

it("拒绝未登记的替换副本；异地副本重定位须逐项核对已入卷的固定版本", async () => {
  const { createHash } = await import("node:crypto");
  const original = await changeMatterFolder(a, { action: "bind", root }, storageRoot);
  const oldCopy = path.join(root, "早期副本");
  await fs.cp(original.path!, oldCopy, { recursive: true });
  const bytes = Buffer.from("后续原件");
  const key = await storage.writeFile("m_" + a.id, bytes);
  const documents = [{ path: key, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length,
    encrypted: false, iv: null, authTag: null }];
  const moved = path.join(root, "移动的完整目录");
  await fs.rename(original.path!, moved);
  await fs.rename(oldCopy, original.path!);
  expect((await matterFolderState(a)).available).toBe(false);
  await expect(storage.readFile(key)).rejects.toThrow("案件目录不可用");
  await expect(changeMatterFolder(a, { action: "relocate", path: original.path! }, storageRoot, documents)).rejects.toThrow("已入卷版本不完整");
  await fs.rename(original.path!, oldCopy);
  const full = path.join(root, "跨盘转入");
  await fs.cp(moved, full, { recursive: true });
  const filename = path.join(full, "已入卷", ...key.split("/").slice(1));
  await fs.writeFile(filename, Buffer.alloc(bytes.length, 1));
  await expect(changeMatterFolder(a, { action: "relocate", path: full }, storageRoot, documents)).rejects.toThrow("已入卷版本不完整");
  await fs.writeFile(filename, bytes);
  expect((await changeMatterFolder(a, { action: "relocate", path: full }, storageRoot, documents)).available).toBe(true);
  expect(await storage.readFile(key)).toEqual(bytes);
});

it("旧登记显示原位置并冻结读写，重新定位时核对原件后登记物理目录", async () => {
  const { createHash } = await import("node:crypto");
  const bound = await changeMatterFolder(a, { action: "bind", root }, storageRoot);
  const bytes = Buffer.from("旧版已入卷材料");
  const key = await storage.writeFile("m_" + a.id, bytes);
  const documents = [{ path: key, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length,
    encrypted: false, iv: null, authTag: null }];
  const record = path.join(path.dirname(storageRoot), "matter-folders", a.id + ".json");
  const prior = JSON.parse(await fs.readFile(record, "utf8"));
  delete prior.directoryKey;
  await fs.writeFile(record, JSON.stringify(prior));
  expect(await matterFolderState(a)).toMatchObject({ path: bound.path, available: false });
  await expect(storage.readFile(key)).rejects.toThrow("重新定位");
  await expect(storage.writeFile("m_" + a.id, Buffer.from("X"))).rejects.toThrow("重新定位");
  await expect(matterSubdirectory(a.id, "工作稿")).rejects.toThrow("重新定位");
  await expect(changeMatterFolder(a, { action: "bind", root }, storageRoot)).rejects.toThrow("重新定位");
  await expect(changeMatterFolder(a, { action: "relocate", path: bound.path! }, storageRoot)).rejects.toThrow("需核对");
  const wrong = [{ ...documents[0], sha256: "0".repeat(64) }];
  await expect(changeMatterFolder(a, { action: "relocate", path: bound.path! }, storageRoot, wrong)).rejects.toThrow("原件");
  expect(JSON.parse(await fs.readFile(record, "utf8"))).toEqual(prior);
  expect(await changeMatterFolder(a, { action: "relocate", path: bound.path! }, storageRoot, documents)).toMatchObject({ available: true });
  expect(JSON.parse(await fs.readFile(record, "utf8")).directoryKey).toMatch(/^\d+\/\d+$/);
  expect(await storage.readFile(key)).toEqual(bytes);
});

it("不支持硬链接的卷在首次绑定或重定位前失败，保留旧原件和登记", async () => {
  const key = await storage.writeFile("m_" + a.id, Buffer.from("既有原件"));
  const bBound = await changeMatterFolder(b, { action: "bind", root }, storageRoot);
  const bKey = await storage.writeFile("m_" + b.id, Buffer.from("第二案原件"));
  const moved = path.join(root, "拟转入卷");
  await fs.rename(bBound.path!, moved);
  const mappings = path.join(path.dirname(storageRoot), "matter-folders");
  const prior = await fs.readFile(path.join(mappings, b.id + ".json"));
  // Exercise real directories and the actual binding transaction while returning
  // the error produced when the destination volume cannot create a hard link.
  const denied = vi.spyOn(fsPromises, "link").mockRejectedValue(Object.assign(new Error(), { code: "EOPNOTSUPP" }));
  syncBuiltinESMExports();
  try {
    await expect(changeMatterFolder(a, { action: "bind", root }, storageRoot)).rejects.toThrow("硬链接");
    expect(await matterFolderState(a)).toMatchObject({ path: null, available: false });
    expect(await storage.readFile(key)).toEqual(Buffer.from("既有原件"));
    await expect(changeMatterFolder(b, { action: "relocate", path: moved }, storageRoot)).rejects.toThrow("硬链接");
    expect(await fs.readFile(path.join(mappings, b.id + ".json"))).toEqual(prior);
    expect(await fs.readdir(root)).toEqual(["拟转入卷"]);
    expect((await fs.readdir(path.join(moved, "已入卷"))).some(name => name.startsWith(".lexorder-volume-"))).toBe(false);
  } finally {
    denied.mockRestore();
    syncBuiltinESMExports();
  }
  await fs.rename(moved, bBound.path!);
  expect(await storage.readFile(bKey)).toEqual(Buffer.from("第二案原件"));
  expect((await changeMatterFolder(a, { action: "bind", root }, storageRoot)).available).toBe(true);
});
