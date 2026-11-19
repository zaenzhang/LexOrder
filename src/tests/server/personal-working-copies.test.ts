import { afterEach, beforeEach, expect, it } from "vitest";
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, truncate, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ActionError } from "@/lib/action-error";
import { WorkingCopies, type DraftAdapter, type DraftDocument } from "@/server/desktop/working-copies";

let root: string;
beforeEach(async () => {
  // The production binding resolves its root before supplying a drafts directory.
  // Windows TEMP can point at the same directory through a DOS short name.
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "lex-drafts-")));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("归属随签出持久保留；原地与替换保存各回传一版，丢回执重启按原键恢复，过期工作稿保留", async () => {
  const documents = new Map<string, DraftDocument>(["A", "B"].map(matterId => [matterId + "1", {
    id: matterId + "1", matterId, familyId: matterId, version: 1, name: "同名工作稿.txt", extension: ".txt", checkoutJti: matterId }]));
  const heads = new Map([["A", "A1"], ["B", "B1"]]);
  const receipts = new Map<string, DraftDocument>();
  const opened: string[] = [];
  let loseResponse = true;
  const adapter: DraftAdapter = {
    read: async () => {},
    drafts: async matter => { const dir = path.join(root, matter); await mkdir(dir, { recursive: true }); return dir; },
    launch: async file => { opened.push(file); },
    checkout: async (matter, id) => {
      if (heads.get(matter) !== id) throw new ActionError("旧版");
      return { doc: documents.get(id)!, bytes: Buffer.from(matter + " - " + id) };
    },
    save: async (doc, _bytes, key) => {
      if (receipts.has(key)) return receipts.get(key)!;
      if (heads.get(doc.matterId) !== doc.id) throw new ActionError("版本冲突");
      const next = { ...doc, id: doc.matterId + (doc.version + 1), version: doc.version + 1 };
      heads.set(doc.matterId, next.id);
      documents.set(next.id, next); receipts.set(key, next);
      if (loseResponse) { loseResponse = false; throw new Error("reply lost"); }
      return next;
    },
  };
  const registry = path.join(root, "private");
  let copies = new WorkingCopies(registry, adapter);
  const a = await copies.open("A", "A1");
  await copies.open("B", "B1");
  await copies.open("A", "A1");
  expect(opened[2]).toEqual(opened[0]);
  expect(opened[0]).not.toEqual(opened[1]);

  async function settle(file: string, bytes: string, replace = false) {
    if (replace) { await writeFile(file + ".tmp", bytes); await rename(file + ".tmp", file); }
    else await writeFile(file, bytes);
    await utimes(file, new Date(0), new Date(0));
  }
  await settle(opened[0], "A第二版");
  expect((await copies.sync()).find(row => row.matterId === "A")?.message).toBeTruthy();
  copies = new WorkingCopies(registry, adapter);
  await settle(opened[0], "A第三版", true);
  expect((await copies.sync()).find(row => row.matterId === "A")?.id).toBe("A2");
  expect((await copies.sync()).find(row => row.matterId === "A")?.id).toBe("A3");
  await copies.sync();
  expect(receipts.size).toBe(2);
  // Swapping in an older backup with the same marker and file names must
  // never turn its stale bytes into a new authoritative document version.
  await rename(path.join(root, "A"), path.join(root, "A-old"));
  await cp(path.join(root, "A-old"), path.join(root, "A"), { recursive: true });
  await settle(opened[0], "旧目录副本中的材料");
  expect((await copies.sync()).find(row => row.matterId === "A")?.message).toContain("目录已替换");
  expect(receipts.size).toBe(2);
  await rm(path.join(root, "A"), { recursive: true });
  await rename(path.join(root, "A-old"), path.join(root, "A"));
  expect(await readFile(opened[1], "utf8")).toBe("B - B1");

  heads.set("A", "other");
  await settle(opened[0], "应保留的冲突版本");
  expect((await copies.sync()).find(row => row.matterId === "A")?.message).toBe("版本冲突");
  await copies.reopen("A", a.sessionId);
  expect(opened.at(-1)).toBe(opened[0]);
  await settle(opened[0], "冲突后继续修改", true);
  // Restart after the retention file was created but before deregistration.
  const record = JSON.parse(await readFile(path.join(registry, a.sessionId + ".json"), "utf8"));
  const retained = opened[0].slice(0, -record.extension.length) + "_待回传_" + record.pending.key + record.extension;
  await writeFile(retained, "已有的其他文件");
  copies = new WorkingCopies(registry, adapter);
  await expect(copies.finish("A", a.sessionId, true)).rejects.toThrow("同名保留稿已变化");
  expect(await readFile(retained, "utf8")).toBe("已有的其他文件");
  await writeFile(retained, "应保留的冲突版本");
  await copies.finish("A", a.sessionId, true);
  const files = await readdir(path.dirname(opened[0]));
  expect(await Promise.all(files.map(name => readFile(path.join(root, "A", name), "utf8")))).toEqual(expect.arrayContaining(["应保留的冲突版本", "冲突后继续修改"]));
  expect((await copies.sync()).map(row => row.id)).toEqual(["B1"]);
});

it.each(["truncated", "missing"] as const)("校验 %s 快照，保留后续修改，按原摘要与原请求恢复", async damage => {
  const dir = path.join(root, "案");
  const registry = path.join(root, "private");
  await mkdir(dir);
  const doc: DraftDocument = { id: "A1", matterId: "A", familyId: "A", name: "合同.txt", version: 1, extension: ".txt", checkoutJti: "ticket" };
  const attempted: { bytes: string; key: string }[] = [];
  let working = "";
  const adapter: DraftAdapter = {
    drafts: async () => dir, checkout: async () => ({ doc, bytes: Buffer.from("原版") }),
    launch: async file => { working = file; }, read: async () => {},
    save: async (_doc, bytes, key) => {
      attempted.push({ bytes: bytes.toString(), key });
      if (attempted.length === 1) throw new Error("synthetic offline");
      return { id: "A2", version: 2 };
    },
  };
  const copies = new WorkingCopies(registry, adapter);
  const { sessionId } = await copies.open("A", "A1");
  const frozen = "请求已冻结的完整正文";
  await writeFile(working, frozen);
  await utimes(working, new Date(0), new Date(0));
  expect((await copies.sync())[0].message).toBeTruthy();
  const record = path.join(registry, sessionId + ".json");
  const snapshot = path.join(registry, attempted[0].key + ".pending");
  if (damage === "truncated") await writeFile(snapshot, "截断");
  else await rm(snapshot);
  await writeFile(working, "离线后的另一份正确稿");
  const restored = new WorkingCopies(registry, adapter);
  expect((await restored.sync())[0].message).toContain("快照校验失败");
  await expect(restored.finish("A", sessionId, true)).rejects.toThrow("快照校验失败");
  expect(attempted).toHaveLength(1);
  expect(JSON.parse(await readFile(record, "utf8")).pending.key).toBe(attempted[0].key);
  expect(await readFile(working, "utf8")).toBe("离线后的另一份正确稿");

  await writeFile(working, frozen);
  if (damage === "truncated") {
    expect((await restored.sync())[0]).toMatchObject({ id: "A2", version: 2 });
    expect(attempted).toEqual([attempted[0], { key: attempted[0].key, bytes: frozen }]);
  } else {
    await restored.finish("A", sessionId, true);
    expect(attempted).toHaveLength(1);
    const kept = (await readdir(dir)).find(name => name.includes("_待回传_"));
    expect(await readFile(path.join(dir, kept!), "utf8")).toBe(frozen);
  }
});


it.each(["改名", "超限"] as const)("工作稿%s后可保留本机文件并重新签出，保留任何待回传快照", async kind => {
  const folder = path.join(root, "案");
  await mkdir(folder);
  const doc: DraftDocument = { id: "A1", matterId: "A", familyId: "A", name: "诉状.txt", version: 1, extension: ".txt", checkoutJti: "ticket" };
  let working = "";
  const adapter: DraftAdapter = {
    drafts: async () => folder, checkout: async () => ({ doc, bytes: Buffer.from("原件") }),
    launch: async file => { working = file; }, read: async () => {},
    save: async () => { throw new ActionError("已撤回"); },
  };
  const registry = path.join(root, "private");
  const copies = new WorkingCopies(registry, adapter);
  for (const pending of [false, true]) {
    const { sessionId } = await copies.open("A", "A1");
    if (pending) {
      await writeFile(working, "待回传编辑");
      await utimes(working, new Date(0), new Date(0));
      expect((await copies.sync())[0].message).toBe("已撤回");
    }
    if (kind === "改名") await rename(working, working + ".bak");
    else await truncate(working, 20 * 1024 * 1024 + 1);
    await copies.finish("A", sessionId, true);
    expect(await copies.sync()).toEqual([]);
    const retained = await readdir(folder);
    expect(retained).toContain(path.basename(working) + (kind === "改名" ? ".bak" : ""));
    if (pending) {
      const snapshot = retained.find(name => name.includes("_待回传_"))!;
      expect(await readFile(path.join(folder, snapshot), "utf8")).toBe("待回传编辑");
    }
  }
});
