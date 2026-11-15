// Adapter for the managed preview daemon; it owns the Web and PostgreSQL processes.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
function option(name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}
const port = option('--port') || process.env.PORT || '3000';
const host = option('--host') || '127.0.0.1';
const child = spawn(process.execPath, [resolve(root, 'tools/cloud-dev/run.mjs'), 'serve'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: port,
    LEXORDER_HOST: host,
    LEXORDER_RUNTIME_DIR: process.env.LEXORDER_RUNTIME_DIR || '.runtime/managed-preview',
    NEXTAUTH_URL: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`
  }
});
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
