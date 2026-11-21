import { spawn } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dist = process.env.NEXT_DIST_DIR ?? '.next-personal';
const desktop = process.argv[2] === '--desktop';
const chronicle = path.join(root, 'desktop/personal-chronicle');
const run = (args, cwd, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error('Build failed (' + code + '): ' + args.join(' '))));
});
if (desktop) await run([path.join(chronicle, 'node_modules/vite/bin/vite.js'), 'build'], chronicle);
await mkdir(path.join(here, '.runtime/prisma'), { recursive: true });
await cp(path.join(root, 'prisma/schema.prisma'), path.join(here, '.runtime/prisma/schema.prisma'));
await cp(path.join(root, 'prisma/migrations'), path.join(here, '.runtime/prisma/migrations'), { recursive: true });
await run([path.join(root, 'node_modules/next/dist/bin/next'), 'build', root], root, {
  ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  NEXT_DIST_DIR: dist, LEXORDER_STANDALONE: '1', LEXORDER_RUNTIME_MODE: 'SERVER', DISABLE_CRON: '1',
});
const output = path.join(root, dist, 'standalone');
await cp(path.join(root, dist, 'static'), path.join(output, dist, 'static'), { recursive: true });
await cp(path.join(root, 'public'), path.join(output, 'public'), { recursive: true });
if (desktop) {
  await cp(path.join(chronicle, 'dist'), path.join(output, 'public/_chronicle'), { recursive: true });
  const licenses = path.join(output, 'public/_chronicle/licenses');
  await mkdir(licenses, { recursive: true });
  for (const [name, module] of [['Hanken-Grotesk', '@fontsource-variable/hanken-grotesk'], ['JetBrains-Mono', '@fontsource/jetbrains-mono']]) {
    await cp(path.join(chronicle, 'node_modules', module, 'LICENSE'), path.join(licenses, name + '.txt'));
  }
}
console.log('PASS standalone business runtime and static assets');
