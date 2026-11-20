import { access, cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const host = path.join(root, 'desktop/personal-chronicle/desktop-preview');
const output = path.join(host, 'runtime-payload');
const dist = process.env.NEXT_DIST_DIR ?? '.next-personal';
if (path.basename(dist) !== dist || !dist.startsWith('.next-personal')) {
  throw new Error('NEXT_DIST_DIR must name a .next-personal build directory');
}
const app = path.join(root, dist, 'standalone');
await access(path.join(app, 'public/_chronicle/index.html'));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const runtime = path.join(output, 'tools/workbench-m1');
const targetApp = path.join(output, '.next-personal/standalone');
await mkdir(runtime, { recursive: true });
await mkdir(targetApp, { recursive: true });
for (const name of ['server.js', 'package.json', dist, 'node_modules', 'public']) {
  await cp(path.join(app, name), path.join(targetApp, name), { recursive: true, dereference: true });
}
for (const name of ['prisma/schema.prisma', 'prisma/migrations', 'prisma.config.ts', 'LICENSE']) {
  await cp(path.join(root, name), path.join(output, name), { recursive: true });
}
for (const name of ['exit-with-owner.mjs']) {
  await cp(path.join(import.meta.dirname, name), path.join(runtime, name));
}
for (const [source, target] of [
  ['tools/workbench-m1/personal-runtime.mjs', 'tools/workbench-m1/personal-runtime.mjs'],
  ['prisma/seed.ts', 'prisma/seed.ts'],
]) {
  const result = await Bun.build({ entrypoints: [path.join(root, source)], target: 'bun',
    packages: 'external', outdir: path.dirname(path.join(output, target)), naming: path.basename(target) });
  if (!result.success) throw new AggregateError(result.logs, 'Desktop runtime build failed');
}

const packaged = new Set();
async function copyDependency(name, from, optional = false) {
  let current = from;
  let directory;
  let metadata;
  for (;;) {
    directory = path.join(current, 'node_modules', name);
    try {
      metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (current === root) {
        if (optional) return;
        throw new Error('Desktop dependency is missing: ' + name);
      }
      current = path.dirname(current);
    }
  }
  if (packaged.has(directory)) return;
  packaged.add(directory);
  await cp(directory, path.join(output, path.relative(root, directory)), {
    recursive: true, dereference: true,
    filter: file => file === directory || !path.relative(directory, file).split(path.sep).includes('node_modules'),
  });
  for (const [dependency, isOptional] of Object.entries({
    ...Object.fromEntries(Object.keys(metadata.dependencies ?? {}).map(key => [key, false])),
    ...Object.fromEntries(Object.keys(metadata.optionalDependencies ?? {}).map(key => [key, true])),
  })) {
    await copyDependency(dependency, directory, isOptional);
  }
}
for (const packageName of ['prisma', 'tsx', '@prisma/client', '@prisma/adapter-pg', 'bcryptjs', 'dotenv']) {
  await copyDependency(packageName, root);
}
await copyDependency('@electric-sql/pglite', import.meta.dirname);
await cp(path.join(root, 'node_modules/.prisma'), path.join(output, 'node_modules/.prisma'), { recursive: true });
console.log('Staged standalone desktop runtime');
