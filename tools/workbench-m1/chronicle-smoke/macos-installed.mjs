import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { access, lstat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const [bundle, workspace] = process.argv.slice(2);
assert(process.platform === 'darwin' && path.isAbsolute(bundle ?? '') && bundle.endsWith('.app')
  && path.isAbsolute(workspace ?? ''), 'Supply a mounted macOS .app and an absolute seeded smoke workspace');
assert.notEqual(workspace, process.env.LEXORDER_DESKTOP_WORKSPACE, 'Use a separate smoke workspace');

const binary = path.join(bundle, 'Contents/MacOS/lexorder-chronicle-preview');
const owner = path.join(workspace, '.owner');
await access(binary);
await access(path.join(workspace, 'workspace.json'));
await assert.rejects(lstat(owner), { code: 'ENOENT' });
const script = fileURLToPath(new URL('./macos-installed.applescript', import.meta.url));
const run = promisify(execFile);

async function probe(pid, action) {
  const { stdout } = await run('/usr/bin/osascript', [script, String(pid), action], { timeout: 6000 });
  return stdout.trim();
}

async function measure(round) {
  const env = { ...process.env, LEXORDER_DESKTOP_WORKSPACE: workspace };
  delete env.LEXORDER_DESKTOP_ROOT;
  delete env.NEXT_DIST_DIR;
  delete env.LEXORDER_MACOS_SMOKE_PORT;
  const started = performance.now();
  const child = spawn(binary, { cwd: path.dirname(binary), env, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostic = '';
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });
  const closed = new Promise(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  try {
    assert(child.pid, 'Could not start the bundled Tauri binary');
    let size;
    for (const deadline = started + 60_000; performance.now() < deadline;) {
      assert.equal(child.exitCode, null, 'Bundled Tauri process exited before the home page');
      assert.equal(child.signalCode, null, 'Bundled Tauri process was terminated before the home page');
      size = await probe(child.pid, 'page');
      if (size) break;
      await delay(250);
    }
    assert.match(size ?? '', /^\d+ \d+$/, 'The installed window did not expose the loaded 今日办理 date');
    const startMs = Math.round(performance.now() - started);
    await access(owner);

    const closeAt = performance.now();
    assert.equal(await probe(child.pid, 'close'), 'pressed', 'Could not close the installed window');
    const exit = await Promise.race([closed, delay(45_000, null, { ref: false })]);
    assert.deepEqual(exit, { code: 0, signal: null }, 'The installed window did not shut down cleanly');
    await assert.rejects(lstat(owner), { code: 'ENOENT' });
    console.log('CHRONICLE_MACOS_INSTALLED ' + JSON.stringify({
      round, startMs, closeMs: Math.round(performance.now() - closeAt), window: size.split(' ').map(Number),
    }));
  } catch (error) {
    if (diagnostic) console.error(diagnostic);
    throw error;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}

for (let round = 1; round <= 3; round++) await measure(round);
