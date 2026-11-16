// The platform preview daemon owns this launcher; no Site is published.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.env.SITES_MANAGED_LINUX_CONTAINER !== '1') throw new Error('MANAGED_PREVIEW_REQUIRED');
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf('--port');
const port = (at >= 0 ? args[at + 1] : args.find(arg => arg.startsWith('--port='))?.slice(7)) || process.env.PORT;
if (!port || !/^\d+$/.test(port)) throw new Error('PREVIEW_PORT_REQUIRED');
const child = spawn(process.execPath, [resolve(here, 'personal-runtime.mjs')], {
  cwd: here, stdio: 'inherit', env: { ...process.env,
    M1_PORT: port,
    M1_WORKSPACE: resolve(here, '.runtime/shared-personal-preview'),
    M1_READY_FILE: resolve(here, '.runtime/preview-ready.json'),
    M1_SAMPLE_DIR: resolve(here, '.runtime/preview-samples'),
    M1_TESSDATA_DIR: resolve(here, '.runtime/tessdata'),
  },
});
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
child.once('error', () => { process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
