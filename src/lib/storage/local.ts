import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { StorageProvider } from "./provider";
import { ActionError } from "@/lib/action-error";

const STORAGE_ROOT = process.env.APP_STORAGE_DIR
  ? path.resolve(process.env.APP_STORAGE_DIR)
  : path.resolve(process.cwd(), "storage");

// ---------------------------------------------------------------------------
// Class-based provider (implements the abstraction)
// ---------------------------------------------------------------------------

export class LocalStorageProvider implements StorageProvider {
  private resolvePath(relPath: string): string {
    const resolved = path.resolve(STORAGE_ROOT, relPath);
    if (!relPath || path.isAbsolute(relPath) || relPath.includes("\\") ||
        !resolved.startsWith(`${STORAGE_ROOT}${path.sep}`)) throw new ActionError("非法路径");
    return resolved;
  }

  async writeFileAt(relPath: string, data: Buffer): Promise<void> {
    const destination = this.resolvePath(relPath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.upload`;
    const file = await fs.open(temporary, "wx", 0o600);
    try {
      try {
        await file.writeFile(data);
        await file.sync();
      } finally { await file.close(); }
      // link publishes a complete file atomically and fails if the target exists.
      await fs.link(temporary, destination);
      // Persist the published directory entry and newly created scope directories.
      // Windows directory fsync is unavailable; its physical acceptance remains separate.
      if (process.platform !== "win32") {
        for (let directory = path.dirname(destination);; directory = path.dirname(directory)) {
          const handle = await fs.open(directory, "r");
          try { await handle.sync(); } finally { await handle.close(); }
          if (directory === path.dirname(STORAGE_ROOT) || directory === path.dirname(directory)) break;
        }
      }
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
  /**
   * 写入文件到 storage/<scope>/<yyyymm>/<uuid>.bin
   * 返回相对 STORAGE_ROOT 的 path（存到数据库）
   */
  async writeFile(scope: string, data: Buffer): Promise<string> {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const safeScope = scope.split("/").filter(Boolean).map(part => part.replace(/[^a-zA-Z0-9_-]/g, "_")).join("/");
    if (!safeScope) throw new ActionError("存储范围不能为空");
    const dir = path.join(STORAGE_ROOT, safeScope, yyyymm);
    await fs.mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}.bin`;
    const relPath = path.posix.join(safeScope, yyyymm, filename);
    await this.writeFileAt(relPath, data);
    return relPath;
  }

  async readFile(relPath: string): Promise<Buffer> {
    const resolved = this.resolvePath(relPath);
    return fs.readFile(resolved);
  }

  async deleteFile(relPath: string): Promise<void> {
    const resolved = this.resolvePath(relPath);
    try {
      await fs.unlink(resolved);
    } catch (err) {
      // 容忍文件已不存在
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton used by backward-compatible standalone exports
// ---------------------------------------------------------------------------

const _instance = new LocalStorageProvider();

// ---------------------------------------------------------------------------
// Legacy standalone function exports (backward compatibility)
// ---------------------------------------------------------------------------

export function writeFile(scope: string, data: Buffer): Promise<string> {
  return _instance.writeFile(scope, data);
}

export function readFile(relPath: string): Promise<Buffer> {
  return _instance.readFile(relPath);
}

/** @deprecated Use storage.deleteFile() instead. Kept for backward compat. */
export function deleteStoredFile(relPath: string): Promise<void> {
  return _instance.deleteFile(relPath);
}

export function getStorageRoot() {
  return STORAGE_ROOT;
}
