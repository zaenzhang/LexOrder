import { spawn } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dist = '.next-personal';
await mkdir(path.join(here, '.runtime/prisma'), { recursive: true });
await cp(path.join(root, 'prisma/schema.prisma'), path.join(here, '.runtime/prisma/schema.prisma'));
await cp(path.join(root, 'prisma/migrations'), path.join(here, '.runtime/prisma/migrations'), { recursive: true });
const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', root], {
  cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    NEXT_DIST_DIR: dist, LEXORDER_STANDALONE: '1', LEXORDER_RUNTIME_MODE: 'SERVER', DISABLE_CRON: '1' },
});
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
if (code !== 0) process.exitCode = code ?? 1;
else {
  // The shared root app is the only Personal UI. Standalone needs its public/static assets.
  const output = path.join(root, dist, 'standalone');
  await cp(path.join(root, dist, 'static'), path.join(output, dist, 'static'), { recursive: true });
  await cp(path.join(root, 'public'), path.join(output, 'public'), { recursive: true });
  console.log('PASS shared application standalone build and static assets');
}
