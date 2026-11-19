import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ActionError } from "../action-error";
import { decryptBuffer, sha256 } from "../storage/crypto";
import { personalRuntime } from "./personal-channel";

const marker = ".lexorder-matter.json";
type Matter = { id: string; internalCode: string; title: string; intakeId?: string | null };
type Binding = { path: string; directoryKey: string | null; stage?: string; copying?: boolean };
export type MovedOriginal = { path: string; encrypted: boolean; iv: string | null; authTag: string | null; sha256: string | null; size: number | null };
type Change = { action: "bind"; root: string } | { action: "relocate"; path: string } | { action: "cancel-copy"; stagePath: string };

function registry(matterId: string) {
  if (!/^c[a-z0-9]{24,}$/.test(matterId)) throw new ActionError("案件编号无效");
  return path.join(path.dirname(personalRuntime().manifestPath), "matter-folders", matterId + ".json");
}

function hasCode(error: unknown, code: string) {
  return (error as NodeJS.ErrnoException)?.code === code;
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function suggestedName(matter: Matter) {
  const name = [matter.internalCode, matter.title].join(" · ").replace(/[<>:"/\\|?*\p{Cc}]/gu, "_");
  return Array.from(name).slice(0, 60).join("").replace(/[. ]+$/, "");
}

async function registeredFolder(matterId: string): Promise<Binding | null> {
  let contents: string;
  try { contents = await fs.readFile(registry(matterId), "utf8"); }
  catch (error) { if (hasCode(error, "ENOENT")) return null; throw error; }
  const data = JSON.parse(contents);
  if (data.workspaceId !== personalRuntime().workspaceId || data.matterId !== matterId || typeof data.path !== "string" || !path.isAbsolute(data.path) || (data.directoryKey !== undefined && (typeof data.directoryKey !== "string" || !/^\d+\/\d+$/.test(data.directoryKey)))) {
    throw new ActionError("本机案件目录登记损坏");
  }
  if (data.stage !== undefined && (typeof data.stage !== "string" || !/^\.lexorder-bind-[a-zA-Z0-9]{6}$/.test(data.stage) || !data.directoryKey)) {
    throw new ActionError("本机案件目录登记损坏");
  }
  if (data.copying !== undefined && (data.copying !== true || !data.stage)) throw new ActionError("本机案件目录登记损坏");
  return { path: data.path, directoryKey: data.directoryKey ?? null, stage: data.stage, copying: data.copying };
}

async function directoryKey(directory: string) {
  const stat = await fs.stat(directory, { bigint: true });
  return String(stat.dev) + "/" + String(stat.ino);
}

async function verifyFolder(directory: string, matterId: string, expectedKey?: string) {
  try {
    if (path.relative(directory, await fs.realpath(directory)) !== "") throw new Error();
    if (expectedKey && await directoryKey(directory) !== expectedKey) throw new Error();
    const stamp = path.join(directory, marker);
    if (!(await fs.lstat(stamp)).isFile()) throw new Error();
    const identity = JSON.parse(await fs.readFile(stamp, "utf8"));
    if (identity.workspaceId !== personalRuntime().workspaceId || identity.matterId !== matterId) throw new Error();
    for (const name of ["已入卷", "工作稿"]) {
      if (!(await fs.lstat(path.join(directory, name))).isDirectory()) throw new Error();
    }
  } catch {
    throw new ActionError("案件目录不可用或归属不符，请检查磁盘连接，或重新定位原案目录");
  }
}

async function verifyBinding(binding: Binding, matterId: string) {
  if (binding.stage) throw new ActionError("案件目录绑定尚未完成，请重新选择原父目录以继续绑定");
  if (!binding.directoryKey) throw new ActionError("此目录需要重新定位并核对原案材料");
  await verifyFolder(binding.path, matterId, binding.directoryKey);
}

export async function requireMatterFolder(matterId: string) {
  const location = await registeredFolder(matterId);
  if (!location) throw new ActionError("请先绑定本案目录");
  await verifyBinding(location, matterId);
  return location.path;
}

export async function matterSubdirectory(matterId: string, name: "工作稿" | "已入卷") {
  return path.join(await requireMatterFolder(matterId), name);
}

export async function matterFolderState(matter: Matter) {
  const location = await registeredFolder(matter.id);
  let available = false;
  if (location && !location.stage) {
    try { await verifyBinding(location, matter.id); available = true; }
    catch (error) { if (!(error instanceof ActionError)) throw error; }
  }
  return { matterId: matter.id, path: location?.stage ? null : location?.path ?? null, available, copyStagePath: location?.copying ? path.join(path.dirname(location.path), location.stage!) : null, suggestedName: location?.stage ? path.basename(location.path) : suggestedName(matter) };
}

// The Personal runtime already holds the workspace's exclusive owner lock. Share
// the queue between its Next route bundles so first binding cannot miss an upload.
const owner = globalThis as typeof globalThis & { lexorderMatterFolderOps?: Map<string, Promise<unknown>> };
const operations = owner.lexorderMatterFolderOps ??= new Map();
function withMatterFolder<T>(matterId: string, work: () => Promise<T>) {
  const previous = operations.get(matterId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  operations.set(matterId, next);
  return next.finally(() => { if (operations.get(matterId) === next) operations.delete(matterId); });
}

async function checkedLocation(input: string) {
  if (!path.isAbsolute(input)) throw new ActionError("请填写本机已存在的绝对目录");
  const location = await fs.realpath(input);
  if (!(await fs.stat(location)).isDirectory()) throw new ActionError("请选择一个目录");
  const workspace = await fs.realpath(path.dirname(personalRuntime().manifestPath));
  if (contains(workspace, location)) throw new ActionError("请选择运行时私有工作区之外的案件目录");
  return location;
}

async function checkParents(location: string) {
  for (let current = location;; current = path.dirname(current)) {
    try { await fs.lstat(path.join(current, marker)); }
    catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
      if (current === path.dirname(current)) return;
      continue;
    }
    throw new ActionError("案件目录不能嵌套在另一个案目录中");
  }
}

async function flush(file: string, directory = false) {
  if (directory && process.platform === "win32") return;
  const handle = await fs.open(file, directory ? "r" : "r+");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeRecord(destination: string, contents: string) {
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = destination + "." + randomUUID();
  try {
    await fs.writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
    await flush(temporary);
    await flush(path.dirname(path.dirname(destination)), true);
    await fs.rename(temporary, destination);
    await flush(path.dirname(destination), true);
  } finally { await fs.rm(temporary, { force: true }); }
}

async function storeMapping(matterId: string, binding: Binding) {
  await writeRecord(registry(matterId), JSON.stringify({ workspaceId: personalRuntime().workspaceId, matterId, ...binding }));
}

// LocalStorageProvider publishes a complete immutable original using link(). A
// directory on FAT, a restricted share or read-only media must fail before it
// becomes the registered destination for uploads and editor returns.
async function verifyPublication(directory: string) {
  const probe = await fs.mkdtemp(path.join(directory, ".lexorder-volume-"));
  try {
    const source = path.join(probe, "source");
    await fs.writeFile(source, "", { flag: "wx", mode: 0o600 });
    try {
      await fs.link(source, path.join(probe, "published"));
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EINVAL"].some(code => hasCode(error, code))) {
        throw new ActionError("此目录无法创建硬链接，不能安全保存案件原件。请选择支持硬链接且允许写入的磁盘目录。");
      }
      throw error;
    }
  } finally { await fs.rm(probe, { recursive: true, force: true }); }
}

// During preparation only, resume an interrupted stream at its verified prefix.
async function stageOriginal(from: string, to: string, recovering: boolean) {
  const existing = recovering && await exists(to);
  const flags = existing ? constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW || 0) : "wx";
  if (existing && !(await fs.lstat(to)).isFile()) throw new ActionError("暂存原件位置已变化，已保留原件");
  const handle = await fs.open(to, flags, 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (existing && await fs.realpath(to) !== to)) throw new ActionError("暂存原件位置已变化，已保留原件");
    if (stat.size > 0 && (stat.size > (await fs.stat(from)).size || await fileDigest(to) !== await fileDigest(from, stat.size))) {
      throw new ActionError("暂存原件内容已变化，已保留本机与外盘原件");
    }
    for await (const chunk of createReadStream(from, { start: stat.size })) await handle.writeFile(chunk);
    await handle.sync();
  } finally { await handle.close(); }
}

async function prepareOriginals(source: string, destination: string, recovering: boolean) {
  if (!await exists(destination)) await fs.mkdir(destination, { mode: 0o700 });
  if (!(await fs.lstat(destination)).isDirectory()) throw new ActionError("暂存原件目录已变化");
  if (await exists(source)) {
    if (!(await fs.lstat(source)).isDirectory()) throw new ActionError("原件存储目录异常");
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name), to = path.join(destination, entry.name);
      if (entry.isDirectory()) await prepareOriginals(from, to, recovering);
      else if (entry.isFile()) await stageOriginal(from, to, recovering);
      else throw new ActionError("原件存储含有异常文件，绑定已停止");
    }
  }
  await flush(destination, true);
}

async function exists(file: string) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (hasCode(error, "ENOENT")) return false; throw error; }
}

async function fileDigest(file: string, prefix?: number) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file, prefix ? { end: prefix - 1 } : undefined)) digest.update(chunk);
  return digest.digest("hex");
}

// Before retiring a private original after a restart, check the corresponding
// bytes in the user-accessible directory. A changed copy leaves both sides intact.
async function verifyStagedOriginals(source: string, destination: string) {
  if (!await exists(source)) return;
  if (!(await fs.lstat(destination)).isDirectory()) throw new ActionError("绑定中断后的原件目录已变化");
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) await verifyStagedOriginals(from, to);
    else if (!entry.isFile() || !(await fs.lstat(to)).isFile() || await fileDigest(from) !== await fileDigest(to)) {
      throw new ActionError("绑定中断后的原件无法核对，已保留私有原件");
    }
  }
}

async function finishBinding(matter: Matter, pending: Binding, storageRoot: string, recovering: boolean) {
  const directory = pending.path, root = path.dirname(directory);
  const stage = path.join(root, pending.stage!);
  const prepared = path.join(stage, path.basename(directory));
  const source = path.join(storageRoot, "m_" + matter.id);
  const intakeSource = matter.intakeId ? path.join(storageRoot, "i_" + matter.intakeId) : null;
  if (pending.copying) {
    await verifyFolder(prepared, matter.id, pending.directoryKey!);
    await prepareOriginals(source, path.join(prepared, "已入卷"), recovering);
    if (intakeSource) await prepareOriginals(intakeSource, path.join(prepared, "已入卷", "收案原件"), recovering);
    pending = { path: directory, directoryKey: pending.directoryKey, stage: pending.stage };
    await storeMapping(matter.id, pending);
  }
  if (!await exists(directory)) {
    await verifyFolder(prepared, matter.id, pending.directoryKey!);
    // POSIX rename can replace an unrelated empty directory. Move the prepared
    // directory to its parent with no-clobber semantics. Windows refuses to
    // replace an existing directory through MoveFileEx.
    try {
      if (process.platform === "win32") await fs.rename(prepared, directory);
      else await promisify(execFile)("/bin/mv", ["-n", prepared, root]);
    } catch (error) {
      if (!await exists(directory)) throw error;
    }
  }
  // Release an empty reservation on a name collision. Populated or edited
  // staging stays registered so its contents cannot be silently orphaned.
  if (await exists(prepared)) {
    await verifyFolder(prepared, matter.id, pending.directoryKey!);
    const draft = path.join(prepared, "工作稿"), originals = path.join(prepared, "已入卷");
    const originalEntries = await fs.readdir(originals);
    const intake = path.join(originals, "收案原件");
    const emptyIntake = !!intakeSource && originalEntries.length === 1 && originalEntries[0] === "收案原件" &&
      (await fs.lstat(intake)).isDirectory() && !(await fs.readdir(intake)).length;
    const empty = (await fs.readdir(stage)).length === 1 && (await fs.readdir(prepared)).length === 3 &&
      !(await fs.readdir(draft)).length && (!originalEntries.length || emptyIntake) &&
      await fs.readFile(path.join(prepared, marker), "utf8") === JSON.stringify({ workspaceId: personalRuntime().workspaceId, matterId: matter.id });
    if (!empty) {
      await storeMapping(matter.id, { ...pending, copying: true });
      throw new ActionError("同名目录已存在。暂存材料已保留，可移开冲突目录再继续绑定，或停止复制：" + stage);
    }
    // Only our empty scaffolding remains. Release the journal first so a crash
    // during its non-recursive cleanup cannot strand the next choice of parent.
    await fs.unlink(registry(matter.id));
    await flush(path.dirname(registry(matter.id)), true);
    await fs.rmdir(draft);
    if (emptyIntake) await fs.rmdir(intake);
    await fs.rmdir(originals);
    await fs.unlink(path.join(prepared, marker));
    await fs.rmdir(prepared);
    await fs.rmdir(stage);
    throw new ActionError("同名目录已存在，请选择其他父目录");
  }
  await verifyFolder(directory, matter.id, pending.directoryKey!);
  await flush(root, true);
  if (recovering) {
    await verifyStagedOriginals(source, path.join(directory, "已入卷"));
    if (intakeSource) await verifyStagedOriginals(intakeSource, path.join(directory, "已入卷", "收案原件"));
  }
  try { await fs.rmdir(stage); }
  catch (error) {
    if (hasCode(error, "ENOTEMPTY") || hasCode(error, "EEXIST")) throw new ActionError("暂存目录中有其他文件，请移出保留后继续绑定：" + stage);
    if (!hasCode(error, "ENOENT")) throw error;
  }
  // Keep the durable reservation until both private trees are retired. A restart
  // verifies any remaining private originals against the published directory.
  await fs.rm(source, { recursive: true, force: true });
  if (intakeSource) await fs.rm(intakeSource, { recursive: true, force: true });
  await storeMapping(matter.id, { path: directory, directoryKey: pending.directoryKey });
}

async function bind(matter: Matter, root: string, storageRoot: string, old: Binding | null) {
  await checkParents(root);
  if (old) {
    if (path.relative(path.dirname(old.path), root) !== "") {
      throw new ActionError(old.stage ? "请重新选择原父目录以继续绑定：" + path.dirname(old.path) : "本案已绑定其他目录，请使用重新定位");
    }
    if (old.stage) await finishBinding(matter, old, storageRoot, true);
    else await verifyBinding(old, matter.id);
    return;
  }

  const directory = path.join(root, suggestedName(matter));
  if (await exists(directory)) throw new ActionError("同名目录已存在，请选择其他父目录");
  const stage = await fs.mkdtemp(path.join(root, ".lexorder-bind-"));
  const prepared = path.join(stage, path.basename(directory));
  let pending: Binding;
  try {
    await fs.mkdir(prepared, { mode: 0o700 });
    await verifyPublication(prepared);
    await fs.mkdir(path.join(prepared, "已入卷"), { mode: 0o700 });
    if (matter.intakeId) {
      const existing = await intakeMatter(matter.intakeId);
      if (existing && existing !== matter.id) throw new ActionError("收案材料已归属其他案件");
      if (!existing) await writeRecord(intakeLookup(matter.intakeId), matter.id);
    }
    await fs.mkdir(path.join(prepared, "工作稿"), { mode: 0o700 });
    await fs.writeFile(path.join(prepared, marker), JSON.stringify({ workspaceId: personalRuntime().workspaceId, matterId: matter.id }), { flag: "wx", mode: 0o600 });
    await flush(path.join(prepared, marker));
    await flush(prepared, true);
    await flush(stage, true);
    await flush(root, true);
    pending = { path: directory, directoryKey: await directoryKey(prepared), stage: path.basename(stage), copying: true };
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
  // Register the physical staging directory before the first original is copied.
  // Pending mappings also prevent uploads from racing the prepared snapshot after restart.
  await storeMapping(matter.id, pending);
  await finishBinding(matter, pending, storageRoot, false);
}

async function verifyMovedOriginals(matter: Matter, directory: string, documents: MovedOriginal[]) {
  for (const doc of documents) {
    const [scope, ...parts] = doc.path.split("/");
    const intake = matter.intakeId && scope === "i_" + matter.intakeId;
    if (!intake && scope !== "m_" + matter.id) continue;
    if (!parts.length || parts.some(part => !part || part === "." || part === ".." || /[:\\/\0]/.test(part))) throw new ActionError("登记的原件路径异常");
    const file = path.join(directory, "已入卷", ...(intake ? ["收案原件"] : []), ...parts);
    try {
      if (path.relative(file, await fs.realpath(file)) || !(await fs.lstat(file)).isFile()) throw new Error();
      let original: Buffer = await fs.readFile(file);
      if (doc.encrypted) {
        if (!doc.iv || !doc.authTag) throw new Error();
        original = decryptBuffer(original, doc.iv, doc.authTag);
      }
      if ((doc.size !== null && original.length !== doc.size) ||
          (doc.sha256 ? sha256(original) !== doc.sha256 : !doc.encrypted)) throw new Error();
    } catch { throw new ActionError("新位置的已入卷版本不完整或内容无法核对，请选择包含本案完整原件的目录"); }
  }
}

export async function changeMatterFolder(matter: Matter, change: Change, storageRoot: string, documents?: MovedOriginal[]) {
  const update = () => withMatterFolder(matter.id, async () => {
    const old = await registeredFolder(matter.id);
    if (change.action === "cancel-copy") {
      if (!old?.copying || !old.stage || path.join(path.dirname(old.path), old.stage) !== change.stagePath) {
        throw new ActionError("本次复制已变化，请重新读取目录");
      }
      // In this phase every original is still private. Detach atomically and
      // keep a private record of the external copy even when its disk is offline.
      const record = registry(matter.id);
      await fs.rename(record, record + ".retained-" + randomUUID());
      await flush(path.dirname(record), true);
    } else if (change.action === "bind") {
      await bind(matter, await checkedLocation(change.root), storageRoot, old);
    } else {
      if (!old) throw new ActionError("本案尚未绑定目录");
      if (old.stage) throw new ActionError("请重新选择原父目录以继续绑定");
      const moved = await checkedLocation(change.path);
      await checkParents(path.dirname(moved));
      await verifyFolder(moved, matter.id);
      if (path.relative(old.path, moved)) {
        let originalExists = true;
        try { await fs.lstat(old.path); }
        catch (error) { if (hasCode(error, "ENOENT")) originalExists = false; else throw error; }
        if (originalExists) throw new ActionError("原目录仍然存在，请先确认移动的是原案目录");
      }
      await verifyPublication(path.join(moved, "已入卷"));
      if (await directoryKey(moved) !== old.directoryKey) {
        if (!documents) throw new ActionError("需核对转移的案件原件");
        await verifyMovedOriginals(matter, moved, documents);
      }
      await storeMapping(matter.id, { path: moved, directoryKey: await directoryKey(moved) });
    }
    return matterFolderState(matter);
  });
  return matter.intakeId ? withMatterFolder("i_" + matter.intakeId, update) : update();
}

function intakeLookup(intakeId: string) {
  return path.join(path.dirname(registry(intakeId)), "intake-" + intakeId);
}

async function intakeMatter(intakeId: string) {
  try { return await fs.readFile(intakeLookup(intakeId), "utf8"); }
  catch (error) { if (hasCode(error, "ENOENT")) return null; throw error; }
}

// A registered case must never read from the private staging location when its
// volume goes offline. Exact historical keys resolve against the same case.
export function withPersonalOriginal<T>(scope: string, storageRoot: string, parts: string[], work: (directory: string, file: string) => Promise<T>) {
  const intake = scope.startsWith("i_");
  const id = scope.slice(2);
  async function access(matterId: string | null) {
    const bound = matterId && await registeredFolder(matterId);
    let base = path.join(storageRoot, scope);
    if (bound && matterId) {
      await verifyBinding(bound, matterId);
      base = path.join(bound.path, "已入卷");
      if (intake) {
        base = path.join(base, "收案原件");
        if (!(await fs.lstat(base)).isDirectory()) throw new ActionError("收案原件目录已变化");
      }
    }
    let destination = base;
    for (const component of parts) {
      if (!component || component === "." || component === ".." || /[:\\/\0]/.test(component)) throw new ActionError("非法原件路径");
      destination = path.join(destination, component);
      try {
        const stat = await fs.lstat(destination);
        if (stat.isSymbolicLink()) throw new ActionError("原件目录或文件指向了其他位置");
      } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
    }
    return work(base, destination);
  }
  if (!intake) return withMatterFolder(id, () => access(id));
  return withMatterFolder(scope, async () => {
    const matterId = await intakeMatter(id);
    return matterId ? withMatterFolder(matterId, () => access(matterId)) : access(null);
  });
}
