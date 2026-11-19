import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

type Subscription = { file: string; directory: string; watcher: FSWatcher; timer?: NodeJS.Timeout };
const registry = globalThis as typeof globalThis & { lexorderDraftWatches?: Map<string, Subscription> };
const subscriptions = registry.lexorderDraftWatches ??= new Map();

export function unwatchWorkingFile(workspaceId: string, sessionId: string) {
  const key = workspaceId + "/" + sessionId;
  const row = subscriptions.get(key);
  if (!row) return;
  subscriptions.delete(key);
  clearTimeout(row.timer);
  row.watcher.close();
}

/** Watch the parent so Word's replace-by-rename saves survive inode replacement.
 * Only an exact registered file name wakes a return. Periodic reconciliation
 * in the desktop shell also recovers missed events, removable drives and restarts.
 */
export function watchWorkingFile(workspaceId: string, sessionId: string, file: string, directory: string, sync: () => Promise<void>) {
  const key = workspaceId + "/" + sessionId;
  const previous = subscriptions.get(key);
  if (previous?.file === file && previous.directory === directory) return;
  unwatchWorkingFile(workspaceId, sessionId);
  try {
    const watcher = watch(path.dirname(file), { persistent: false }, (_type, name) => {
      if (name && name !== path.basename(file)) return;
      const row = subscriptions.get(key);
      if (!row) return;
      clearTimeout(row.timer);
      row.timer = setTimeout(() => { void sync().catch(() => {}); }, 200);
      row.timer.unref();
    });
    subscriptions.set(key, { file, directory, watcher });
    watcher.on("error", () => unwatchWorkingFile(workspaceId, sessionId));
  } catch {
    // Filesystems without notifications still use the same durable reconciliation.
  }
}
