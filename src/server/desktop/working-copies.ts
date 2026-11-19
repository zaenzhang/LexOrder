import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ActionError } from "@/lib/action-error";

export type DraftDocument = { id: string; matterId: string; familyId: string; name: string; version: number; extension: string; checkoutJti: string };
export class ClosedDraftIntent extends ActionError {}
type Pending = { key: string; snapshot?: string; hash: string; stamp: string };
type Copy = DraftDocument & { sessionId: string; file: string; hash: string; stamp: string; directoryIdentity?: string; pending?: Pending };
export type CopyView = Pick<Copy, "sessionId" | "matterId" | "id" | "version"> & { message?: string };
export type DraftAdapter = {
  drafts(matterId: string): Promise<string>;
  checkout(matterId: string, documentId: string): Promise<{ doc: DraftDocument; bytes: Buffer }>;
  save(copy: DraftDocument, bytes: Buffer, requestKey: string): Promise<{ id: string; version: number }>;
  launch(file: string): Promise<void>;
  read(matterId: string, id: string): Promise<void>;
  watch?(file: string, sessionId: string, directory: string): void;
  unwatch?(sessionId: string): void;
};

const maxBytes = 20 * 1024 * 1024;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const stamp = (s: { ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }) => [s.ino, s.size, s.mtimeNs, s.ctimeNs].join("/");
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

async function directoryIdentity(folder: string) {
  const s = await lstat(folder, { bigint: true });
  return String(s.dev) + "/" + String(s.ino);
}

async function syncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeExclusive(file: string, data: string | Buffer) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally { await handle.close(); }
  await syncDirectory(path.dirname(file));
}

async function replaceDurably(file: string, data: string | Buffer) {
  const temporary = file + "." + randomUUID() + ".new";
  try {
    await writeExclusive(temporary, data);
    await rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally { await rm(temporary, { force: true }); }
}

// The registry and pending snapshots belong to the private runtime. Only the
// editable copy is in the user's case folder; a folder cannot supply a binding.
export class WorkingCopies {
  constructor(private readonly registry: string, private readonly adapter: DraftAdapter) {}

  private record(id: string) { return path.join(this.registry, id + ".json"); }

  private async records(): Promise<Copy[]> {
    const created = await mkdir(this.registry, { recursive: true, mode: 0o700 });
    if (created) {
      for (let dir = this.registry; dir !== path.dirname(created); dir = path.dirname(dir)) {
        await syncDirectory(path.dirname(dir));
      }
    }
    const files = (await readdir(this.registry)).filter(name => name.endsWith(".json") && uuid.test(name.slice(0, -5)));
    return Promise.all(files.map(async name => JSON.parse(await readFile(path.join(this.registry, name), "utf8")) as Copy));
  }

  private async persist(copy: Copy) {
    await replaceDurably(this.record(copy.sessionId), JSON.stringify(copy));
  }

  private async file(copy: Copy) {
    const base = await this.adapter.drafts(copy.matterId);
    const file = path.join(base, copy.file);
    if (path.dirname(file) !== base || await realpath(file) !== file) throw new ActionError("工作稿位置已变化，请检查案件目录。");
    const stat = await lstat(file, { bigint: true });
    if (!stat.isFile() || stat.nlink !== BigInt(1)) throw new ActionError("工作稿须为案目录中的独立文件。");
    if (stat.size > BigInt(maxBytes)) throw new ActionError("工作稿超过 20 MB，已保留本机文件。");
    const directory = await directoryIdentity(base);
    this.adapter.watch?.(file, copy.sessionId, directory);
    return { file, stat, directoryIdentity: directory };
  }

  async open(matterId: string, documentId: string) {
    const { doc, bytes } = await this.adapter.checkout(matterId, documentId);
    const copies = await this.records();
    let copy = copies.find(row => row.matterId === matterId && row.id === documentId);
    if (!copy) {
      const folder = await this.adapter.drafts(matterId);
      const sessionId = randomUUID();
      const stem = path.parse(doc.name).name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").slice(0, 75).trim() || "文稿";
      const file = sessionId + "_" + stem + doc.extension;
      const target = path.join(folder, file);
      await writeExclusive(target, bytes);
      copy = { ...doc, file, sessionId, directoryIdentity: await directoryIdentity(folder), stamp: stamp(await lstat(target, { bigint: true })), hash: hash(bytes) };
      await this.persist(copy);
    }
    await this.adapter.launch((await this.file(copy)).file);
    return this.view(copy);
  }

  async reopen(matterId: string, sessionId: string) {
    const copy = (await this.records()).find(row => row.matterId === matterId && row.sessionId === sessionId);
    if (!copy) throw new ActionError("工作稿记录不存在。");
    await this.adapter.read(matterId, copy.id);
    await this.adapter.launch((await this.file(copy)).file);
  }

  private view(copy: Copy, message?: string): CopyView {
    const { sessionId, matterId, id, version } = copy;
    return { sessionId, matterId, id, version, message };
  }

  async sync(only?: string): Promise<CopyView[]> {
    const rows = [];
    let copies: Copy[];
    if (only) {
      if (!uuid.test(only)) return [];
      try { copies = [JSON.parse(await readFile(this.record(only), "utf8")) as Copy]; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    } else { copies = await this.records(); }
    for (const copy of copies) {
      try {
        await this.syncOne(copy);
        rows.push(this.view(copy));
      } catch (error) {
        rows.push(this.view(copy, error instanceof ActionError ? error.message : "工作稿尚未回传，请检查案目录或运行时连接。"));
      }
    }
    return rows;
  }

  private async stableBytes(copy: Copy, location: Awaited<ReturnType<WorkingCopies["file"]>>) {
    const signature = stamp(location.stat);
    const handle = await open(location.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      if (stamp(await handle.stat({ bigint: true })) !== signature) return;
      const bytes = await handle.readFile();
      if (stamp(await handle.stat({ bigint: true })) !== signature || stamp((await this.file(copy)).stat) !== signature) return;
      return bytes;
    } finally { await handle.close(); }
  }

  private async verifiedSnapshot(copy: Copy, pending: Pending, snapshot: string) {
    try {
      const bytes = await readFile(snapshot);
      if (hash(bytes) === pending.hash) return bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Restore the frozen request only from bytes matching its recorded SHA.
    // A later edit cannot take over an existing request key.
    const current = await this.stableBytes(copy, await this.file(copy));
    if (!current || hash(current) !== pending.hash) {
      throw new ActionError("待回传快照校验失败。工作稿和登记已保留，请恢复对应工作稿后重试。");
    }
    await replaceDurably(snapshot, current);
    return current;
  }

  private async syncOne(copy: Copy) {
    if (!copy.pending) {
      const location = await this.file(copy);
      const moved = location.directoryIdentity !== copy.directoryIdentity;
      const signature = stamp(location.stat);
      if ((!moved && signature === copy.stamp) || Date.now() - Number(location.stat.mtimeMs) < 150) return;
      const bytes = await this.stableBytes(copy, location);
      if (!bytes) return;
      const digest = hash(bytes);
      if (digest === copy.hash) {
        copy.stamp = signature; copy.directoryIdentity = location.directoryIdentity; await this.persist(copy); return;
      }
      if (moved) throw new ActionError("工作稿目录已替换且内容不同，已暂停回传。请核对本机稿并从当前版本重新打开。");
      if (!bytes.length) throw new ActionError("工作稿暂为空，已保留上一版本。");
      const key = randomUUID();
      await replaceDurably(path.join(this.registry, key + ".pending"), bytes);
      copy.pending = { key, hash: digest, stamp: signature };
      await this.persist(copy);
    }
    const pending = copy.pending;
    const snapshot = path.join(this.registry, (pending.snapshot ?? pending.key) + ".pending");
    let saved;
    try { saved = await this.adapter.save(copy, await this.verifiedSnapshot(copy, pending, snapshot), pending.key); }
    catch (error) {
      if (error instanceof ClosedDraftIntent) {
        // Only a terminal, explicitly abandoned receipt may receive a new key.
        // Keep the original immutable snapshot even if the editor saves again.
        pending.snapshot ??= pending.key;
        pending.key = randomUUID();
        await this.persist(copy);
      }
      throw error;
    }
    copy.id = saved.id;
    copy.version = saved.version;
    copy.hash = pending.hash;
    copy.stamp = pending.stamp;
    delete copy.pending;
    await this.persist(copy);
    await rm(snapshot, { force: true });
  }

  // The user may keep a conflicting working file and begin a new checkout
  // from the visible head. Stopping never removes the editable file.
  async finish(matterId: string, sessionId: string, keepLocal: boolean) {
    const copy = (await this.records()).find(row => row.matterId === matterId && row.sessionId === sessionId);
    if (!copy) return;
    if (!keepLocal) {
      await this.syncOne(copy);
      if (copy.pending || stamp((await this.file(copy)).stat) !== copy.stamp) throw new ActionError("文件仍在保存，请稍后结束编辑。");
    } else {
      const { file } = await this.file(copy);
      if (copy.pending) {
        const snapshot = await this.verifiedSnapshot(copy, copy.pending, path.join(this.registry, (copy.pending.snapshot ?? copy.pending.key) + ".pending"));
        const sibling = file.slice(0, -copy.extension.length) + "_待回传_" + copy.pending.key + copy.extension;
        try { await writeExclusive(sibling, snapshot); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          // FlushFileBuffers on Windows requires write access, including on a retry.
          const access = process.platform === "win32" ? constants.O_RDWR : constants.O_RDONLY;
          const saved = await open(sibling, access | (constants.O_NOFOLLOW || 0));
          try {
            const stored = await saved.stat();
            if (!stored.isFile() || stored.nlink !== 1 || hash(await saved.readFile()) !== copy.pending.hash) {
              throw new ActionError("同名保留稿已变化，请核对文件后重试。");
            }
            await saved.sync();
          } finally { await saved.close(); }
          await syncDirectory(path.dirname(sibling));
        }
      }
    }
    await rm(this.record(sessionId));
    await syncDirectory(this.registry);
    this.adapter.unwatch?.(sessionId);
    if (copy.pending) await rm(path.join(this.registry, (copy.pending.snapshot ?? copy.pending.key) + ".pending"), { force: true });
  }
}
