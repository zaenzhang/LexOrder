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
  scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "lexorder-folder-")));
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

async function interruptFirstBind(point: "registered" | "published" | "copying" | "retiring" | "discarding", matter: typeof a & { intakeId?: string }) {
  const child = `
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const [point, data, root, storage] = process.argv.slice(1);
    const matter = JSON.parse(data);
    const record = path.join(path.dirname(storage), 'matter-folders', matter.id + '.json');
    const marker = path.join(root, matter.internalCode + ' · ' + matter.title, '.lexorder-matter.json');
    function stop() {
      require('node:fs').writeFileSync(path.join(path.dirname(storage), 'checkpoint'), point);
      if (process.platform === 'win32') process.exit(86);
      process.kill(process.pid, 'SIGKILL');
    }
    const rename = fs.rename, lstat = fs.lstat, open = fs.open, rm = fs.rm, rmdir = fs.rmdir;
    fs.open = async (...args) => {
      const handle = await open(...args);
      if (point === 'copying' && String(args[0]).endsWith(path.sep + 'original.bin') && args[1] === 'wx') {
        const write = handle.writeFile.bind(handle);
        handle.writeFile = async bytes => { await write(bytes.subarray(0, 3)); await handle.sync(); stop(); };
      }
      return handle;
    };
    fs.rm = async (...args) => {
      const result = await rm(...args);
      if (point === 'retiring' && args[0] === path.join(storage, 'm_' + matter.id)) stop();
      return result;
    };
    fs.rmdir = async (...args) => {
      const result = await rmdir(...args);
      if (point === 'discarding' && path.basename(args[0]) === '工作稿') stop();
      return result;
    };
    fs.rename = async (...args) => {
      const result = await rename(...args);
      if (point === 'registered' && args[1] === record && JSON.parse(await fs.readFile(record, 'utf8')).stage) stop();
      return result;
    };
    fs.lstat = async (...args) => {
      if (point === 'discarding' && args[0] === path.dirname(marker) && require('node:fs').existsSync(record) && !require('node:fs').existsSync(args[0])) {
        await fs.mkdir(args[0]);
      }
      const result = await lstat(...args);
      if (point === 'published' && args[0] === marker) stop();
      return result;
    };
    require('node:module').syncBuiltinESMExports();
    const { changeMatterFolder } = require('./src/lib/runtime/matter-folders.ts');
    changeMatterFolder(matter, { action: 'bind', root }, storage).catch(e => { console.error(e); process.exitCode = 1; });
  `;
  await expect(promisify(execFile)(process.execPath, ["--import", "tsx", "-e", child,
    point, JSON.stringify(matter), root, storageRoot])).rejects.toMatchObject(
    process.platform === "win32" ? { code: 86 } : { signal: "SIGKILL" });
  expect(await fs.readFile(path.join(path.dirname(storageRoot), "checkpoint"), "utf8")).toBe(point);
}

it.each(["registered", "published"] as const)("首次绑定在 %s 强退，重开可从原父目录恢复两类原件", async point => {
  const matter = { ...a, intakeId: "c" + "i".repeat(24) };
  const keys = ["m_" + a.id + "/original.bin", "i_" + matter.intakeId + "/intake.bin"];
  for (const key of keys) await storage.writeFileAt(key, Buffer.from(key));
  await interruptFirstBind(point, matter);

  expect(await matterFolderState(a)).toMatchObject({ path: null, available: false });
  for (const key of keys) {
    expect(await fs.readFile(path.join(storageRoot, key), "utf8")).toBe(key);
    await expect(storage.writeFileAt(key + ".new", Buffer.from("new"))).rejects.toThrow("绑定尚未完成");
  }
  const otherRoot = path.join(scratch, "另一个父目录");
  await fs.mkdir(otherRoot);
  await expect(changeMatterFolder(matter, { action: "bind", root: otherRoot }, storageRoot)).rejects.toThrow("原父目录");
  const state = await changeMatterFolder(matter, { action: "bind", root }, storageRoot);
  expect(state).toMatchObject({ path: path.join(root, a.internalCode + " · " + a.title), available: true });
  for (const key of keys) expect((await storage.readFile(key)).toString()).toBe(key);
  expect(await changeMatterFolder(matter, { action: "bind", root }, storageRoot)).toEqual(state);
  expect(await fs.readdir(root)).toEqual([path.basename(state.path!)]);
});

it.each(["copying", "retiring"] as const)("在 %s 强退后继续登记的同一份暂存，清理私有副本", async point => {
  const matter = { ...a, intakeId: "c" + "i".repeat(24) };
  const key = "m_" + a.id + "/original.bin", intake = "i_" + matter.intakeId + "/intake.bin";
  const bytes = Buffer.from("fixed case bytes");
  await storage.writeFileAt(key, bytes);
  await storage.writeFileAt(intake, Buffer.from("intake"));
  await interruptFirstBind(point, matter);
  if (point === "copying") {
    const [stage] = await fs.readdir(root);
    const partial = path.join(root, stage, a.internalCode + " · " + a.title, "已入卷", "original.bin");
    expect(await fs.readFile(partial)).toEqual(bytes.subarray(0, 3));
    await fs.writeFile(partial, "externally changed");
    await expect(changeMatterFolder(matter, { action: "bind", root }, storageRoot)).rejects.toThrow("内容已变化");
    expect(await fs.readFile(partial, "utf8")).toBe("externally changed");
    expect(await fs.readFile(path.join(storageRoot, key))).toEqual(bytes);
    await fs.writeFile(partial, bytes.subarray(0, 3));
  } else {
    expect(await fs.readFile(path.join(storageRoot, intake), "utf8")).toBe("intake");
  }
  expect((await changeMatterFolder(matter, { action: "bind", root }, storageRoot)).available).toBe(true);
  expect(await fs.readdir(root)).toEqual([a.internalCode + " · " + a.title]);
  expect(await storage.readFile(key)).toEqual(bytes);
  expect(await storage.readFile(intake)).toEqual(Buffer.from("intake"));
  for (const file of [key, intake]) await expect(fs.access(path.join(storageRoot, file))).rejects.toMatchObject({ code: "ENOENT" });
});

it("外盘 ENOSPC 后即使断开仍可明确停止复制、继续私有读写并换盘，保留编辑过的暂存", async () => {
  const key = "m_" + a.id + "/original.bin", bytes = Buffer.from("first version");
  await storage.writeFileAt(key, bytes);
  const originalOpen = fsPromises.open.bind(fsPromises);
  const full = vi.spyOn(fsPromises, "open").mockImplementation(async (file, flags, mode) => {
    const handle = await originalOpen(file, flags, mode);
    if (String(file).startsWith(root + path.sep) && String(file).endsWith("original.bin") && flags === "wx") {
      vi.spyOn(handle, "writeFile").mockImplementation(async () => {
        await handle.write(bytes.subarray(0, 3));
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try { await expect(changeMatterFolder(a, { action: "bind", root }, storageRoot)).rejects.toMatchObject({ code: "ENOSPC" }); }
  finally { full.mockRestore(); syncBuiltinESMExports(); }
  const state = await matterFolderState(a);
  expect(state.copyStagePath).toBeTruthy();
  const stageFile = path.join(state.copyStagePath!, state.suggestedName, "已入卷", "original.bin");
  expect(await fs.readFile(stageFile)).toEqual(bytes.subarray(0, 3));
  await fs.writeFile(stageFile, "手工保留的内容");
  await fs.rename(root, root + "-离线");
  await expect(changeMatterFolder(a, { action: "cancel-copy", stagePath: "另一个复制" }, storageRoot)).rejects.toThrow("已变化");
  expect((await changeMatterFolder(a, { action: "cancel-copy", stagePath: state.copyStagePath! }, storageRoot)).copyStagePath).toBeNull();
  expect(await storage.readFile(key)).toEqual(bytes);
  const later = await storage.writeFile("m_" + a.id, Buffer.from("新原件"));
  const next = path.join(scratch, "新磁盘"); await fs.mkdir(next);
  expect((await changeMatterFolder(a, { action: "bind", root: next }, storageRoot)).available).toBe(true);
  expect(await storage.readFile(key)).toEqual(bytes);
  expect((await storage.readFile(later)).toString()).toBe("新原件");
  await fs.rename(root + "-离线", root);
  expect(await fs.readFile(stageFile, "utf8")).toBe("手工保留的内容");
  await expect(changeMatterFolder(a, { action: "cancel-copy", stagePath: state.copyStagePath! }, storageRoot)).rejects.toThrow("已变化");
});

it("写盘中途 ENOSPC 不发布半份原件，腾出空间后可按原键重新发布", async () => {
  const bound = await changeMatterFolder(a, { action: "bind", root }, storageRoot);
  const key = "m_" + a.id + "/reserved.bin", bytes = Buffer.from("原件");
  const originalOpen = fsPromises.open.bind(fsPromises);
  const full = vi.spyOn(fsPromises, "open").mockImplementation(async (file, flags, mode) => {
    const handle = await originalOpen(file, flags, mode);
    if (String(file).endsWith(".upload")) vi.spyOn(handle, "writeFile").mockImplementation(async () => {
      await handle.write(bytes.subarray(0, 1));
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    });
    return handle;
  });
  syncBuiltinESMExports();
  try { await expect(storage.writeFileAt(key, bytes)).rejects.toMatchObject({ code: "ENOSPC" }); }
  finally { full.mockRestore(); syncBuiltinESMExports(); }
  expect(await fs.readdir(path.join(bound.path!, "已入卷"))).toEqual([]);
  await expect(storage.readFile(key)).rejects.toMatchObject({ code: "ENOENT" });
  await storage.writeFileAt(key, bytes);
  expect(await storage.readFile(key)).toEqual(bytes);
});

it("碰撞后清理空暂存中途强退，陌生目录仍保留并可改选父目录", async () => {
  await interruptFirstBind("discarding", a);
  expect(await fs.readdir(path.join(root, a.internalCode + " · " + a.title))).toEqual([]);
  expect((await matterFolderState(a)).path).toBeNull();
  const next = path.join(scratch, "新位置"); await fs.mkdir(next);
  expect((await changeMatterFolder(a, { action: "bind", root: next }, storageRoot)).available).toBe(true);
});

it("带原件的暂存发生同名碰撞时保留两边，移开冲突后从原登记收尾", async () => {
  const matter = { ...a, intakeId: "c" + "i".repeat(24) };
  const key = "m_" + a.id + "/original.bin";
  await storage.writeFileAt(key, Buffer.from("原件"));
  await interruptFirstBind("registered", matter);
  const destination = path.join(root, a.internalCode + " · " + a.title);
  await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, "用户文件"), "原目录");
  await expect(changeMatterFolder(matter, { action: "bind", root }, storageRoot)).rejects.toThrow("暂存材料已保留");
  expect(await fs.readFile(path.join(destination, "用户文件"), "utf8")).toBe("原目录");
  await fs.rename(destination, destination + "-原目录");
  expect((await changeMatterFolder(matter, { action: "bind", root }, storageRoot)).available).toBe(true);
  expect(await storage.readFile(key)).toEqual(Buffer.from("原件"));
});

it("中断后拒绝同案标记的替换副本和改写的原件，保留私有原件供核对", async () => {
  const matter = { ...a, intakeId: "c" + "i".repeat(24) };
  const key = "m_" + a.id + "/original.bin";
  const bytes = Buffer.from("固定原件");
  await storage.writeFileAt(key, bytes);
  await interruptFirstBind("published", matter);
  const destination = path.join(root, a.internalCode + " · " + a.title);
  const saved = path.join(root, "物理原目录");
  await fs.rename(destination, saved);
  await fs.cp(saved, destination, { recursive: true });
  await expect(changeMatterFolder(matter, { action: "bind", root }, storageRoot)).rejects.toThrow("归属不符");
  await expect(changeMatterFolder(matter, { action: "relocate", path: destination }, storageRoot)).rejects.toThrow("原父目录");
  await fs.rename(destination, path.join(root, "保留替换副本"));
  await fs.rename(saved, destination);
  const copied = path.join(destination, "已入卷", "original.bin");
  await fs.writeFile(copied, Buffer.from("外部改写"));
  await expect(changeMatterFolder(matter, { action: "bind", root }, storageRoot)).rejects.toThrow("原件无法核对");
  expect(await fs.readFile(path.join(storageRoot, key))).toEqual(bytes);
  expect(await fs.readFile(copied, "utf8")).toBe("外部改写");
  await fs.writeFile(copied, bytes);
  expect((await changeMatterFolder(matter, { action: "bind", root }, storageRoot)).available).toBe(true);
  expect(await storage.readFile(key)).toEqual(bytes);
});

it("目录检查和发布之间出现的陌生空目录保留原身份，允许改选其他父目录", async () => {
  const destination = path.join(root, a.internalCode + " · " + a.title);
  const originalLstat = fsPromises.lstat.bind(fsPromises);
  const record = path.join(path.dirname(storageRoot), "matter-folders", a.id + ".json");
  let foreignInode: bigint | undefined;
  const competing = vi.spyOn(fsPromises, "lstat").mockImplementation(async (...args) => {
    try { return await originalLstat(...args); }
    catch (error) {
      if (args[0] === destination && !foreignInode && await fs.access(record).then(() => true, () => false)) {
        await fs.mkdir(destination);
        foreignInode = (await fs.stat(destination, { bigint: true })).ino;
      }
      throw error;
    }
  });
  syncBuiltinESMExports();
  try {
    await expect(changeMatterFolder(a, { action: "bind", root }, storageRoot)).rejects.toThrow("同名目录");
    expect(foreignInode).toBeDefined();
    expect((await fs.stat(destination, { bigint: true })).ino).toBe(foreignInode);
    expect(await fs.readdir(destination)).toEqual([]);
    expect(await fs.readdir(root)).toEqual([path.basename(destination)]);
  } finally {
    competing.mockRestore();
    syncBuiltinESMExports();
  }
  const other = path.join(scratch, "合适的父目录");
  await fs.mkdir(other);
  expect((await changeMatterFolder(a, { action: "bind", root: other }, storageRoot)).available).toBe(true);
});
