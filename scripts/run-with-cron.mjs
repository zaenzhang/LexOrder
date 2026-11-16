// 生产进程监督：同一目录下运行 Web + 唯一调度 worker，不包含数据库启动/迁移。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvConfig(root, false);
const env = { ...process.env, NODE_ENV: 'production', NEXT_DIST_DIR: '.next-build' };
const children = new Set();
let stopping = false;
let forceTimer;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) child.kill('SIGTERM');
  forceTimer = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 31_000);
  forceTimer.unref();
}
function launch(args, childEnv) {
  const child = spawn(process.execPath, args, { cwd: root, env: childEnv, stdio: 'inherit' });
  children.add(child);
  child.on('error', error => { console.error('[lexorder-supervisor]', error.message); children.delete(child); stop(1); });
  child.on('exit', code => {
    children.delete(child);
    if (!stopping) stop(code || 1);
    if (!children.size) clearTimeout(forceTimer);
  });
}
launch([require.resolve('next/dist/bin/next'), 'start', '--hostname', env.LEXORDER_HOST || '127.0.0.1', '--port', env.PORT || '3000'], { ...env, DISABLE_CRON: '1' });
launch(['--import', 'tsx', 'src/server/cron/standalone.ts'], { ...env, DISABLE_CRON: '0' });
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
