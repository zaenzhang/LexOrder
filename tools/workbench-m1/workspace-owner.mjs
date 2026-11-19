import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readlink, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';

async function staleMarker(marker) {
  const stat = await lstat(marker);
  // New owners hold the directory flock, including any surviving app child.
  if (stat.isSymbolicLink()) return /^\/proc\/[1-9]\d*$/.test(await readlink(marker));
  // A previous runtime wrote its PID to a regular file. An old fixture owner
  // used an empty file; its lifetime cannot be proved, so leave it alone.
  if (!stat.isFile() || stat.size > 20) return false;
  const old = await open(marker, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const value = await old.readFile('utf8');
    if (!/^[1-9]\d{0,9}$/.test(value)) return false;
    try { process.kill(Number(value), 0); }
    catch (error) { return error.code === 'ESRCH'; }
    return false;
  } finally { await old.close(); }
}

export async function acquireWorkspaceOwner(workspace) {
  const directory = await open(workspace, constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const marker = path.join(workspace, '.owner');
  try {
    // flock(1) locks the inherited open file description. The kernel releases
    // it when the last owner/child descriptor closes, including on SIGKILL.
    const result = spawnSync('flock', ['-n', '-E', '75', '3'], { stdio: ['ignore', 'ignore', 'pipe', directory.fd] });
    if (result.error) throw result.error;
    if (result.status === 75) throw new Error('WORKSPACE_BUSY');
    if (result.status !== 0) throw new Error('WORKSPACE_LOCK_FAILED');
    const target = '/proc/' + process.pid;
    try { await symlink(target, marker); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!await staleMarker(marker)) throw new Error('WORKSPACE_BUSY');
      await unlink(marker);
      await symlink(target, marker);
    }
    return {
      fd: directory.fd,
      async close() {
        try { await unlink(marker); } finally { await directory.close(); }
      },
    };
  } catch (error) {
    await directory.close();
    throw error;
  }
}
