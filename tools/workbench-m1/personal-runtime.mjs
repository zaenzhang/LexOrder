// M1 Linux owner for the shared LawLink/LexOrder app. Windows delivery is verified separately.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { open, mkdir, readdir, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { startPrivatePostgres } from './private-pg.mjs';
import { PrismaClient } from '@prisma/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const workspace = process.env.M1_WORKSPACE && path.resolve(process.env.M1_WORKSPACE);
if (process.platform !== 'linux' || !workspace) throw new Error('M1_REQUIRES_LINUX_AND_EXPLICIT_WORKSPACE');
await mkdir(workspace, { recursive: true, mode: 0o700 });
const info = await lstat(workspace);
if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error('WORKSPACE_MUST_BE_PRIVATE');
const manifestPath = path.join(workspace, 'workspace.json');
const existing = await readdir(workspace);
const hasManifest = existing.includes('workspace.json');
if (!hasManifest && existing.some(name => name !== '.owner')) throw new Error('WORKSPACE_INCOMPLETE');
if (hasManifest && !existing.includes('data')) throw new Error('WORKSPACE_INCOMPLETE');
let lock;
try { lock = await open(path.join(workspace, '.owner'), 'wx', 0o600); await lock.writeFile(String(process.pid)); }
catch { throw new Error('WORKSPACE_BUSY'); }
let database, socket, prisma, child, migration, childExit;
let childEnded = false;
let stopping = false, runtimeFailed = false;
const terminate = () => { stopping = true; migration?.kill('SIGTERM'); child?.kill('SIGTERM'); };
process.on('SIGTERM', terminate); process.on('SIGINT', terminate);
const command = (file, args, env, cwd = path.join(here, '.runtime')) => new Promise((resolve, reject) => {
  if (stopping) { reject(new Error('M1_CANCELLED')); return; }
  const proc = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  migration = proc;
  const timer = setTimeout(() => proc.kill('SIGKILL'), 90_000);
  let output = ''; proc.stdout.on('data', chunk => { output += chunk; }); proc.stderr.on('data', chunk => { output += chunk; });
  proc.once('error', error => { clearTimeout(timer); migration = undefined; reject(error); });
  proc.once('exit', code => {
    clearTimeout(timer); migration = undefined;
    if (code === 0) resolve(output);
    else reject(new Error('M1_INITIALIZATION_COMMAND_FAILED'));
  });
});
async function stopChild() {
  if (!child || childEnded) return;
  child.kill('SIGTERM');
  let timer;
  await Promise.race([childExit, new Promise(resolve => { timer = setTimeout(resolve, 10_000); })]);
  clearTimeout(timer);
  if (!childEnded) {
    child.kill('SIGKILL');
    await Promise.race([childExit, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
    clearTimeout(timer);
  }
  if (!childEnded) throw new Error('M1_OWNER_STOP_FAILED');
}
try {
  const keyPath = path.join(workspace, 'storage-key');
  if (hasManifest && !existing.includes('storage-key')) throw new Error('WORKSPACE_KEY_MISSING');
  if (!hasManifest) await writeFile(keyPath, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
  const keyInfo = await lstat(keyPath);
  if (!keyInfo.isFile() || keyInfo.isSymbolicLink() || (keyInfo.mode & 0o077)) throw new Error('WORKSPACE_KEY_NOT_PRIVATE');
  const storageKey = (await readFile(keyPath, 'utf8')).trim();
  if (Buffer.from(storageKey, 'base64').length !== 32) throw new Error('WORKSPACE_KEY_INVALID');
  await mkdir(path.join(workspace, 'storage'), { recursive: true, mode: 0o700 });
  database = await PGlite.create(path.join(workspace, 'data'));
  const dbCredential = randomBytes(32).toString('hex');
  socket = await startPrivatePostgres(database, dbCredential, () => { runtimeFailed = true; terminate(); });
  const url = `postgresql://postgres:${dbCredential}@127.0.0.1:${socket.port}/postgres?schema=public&connection_limit=1&sslmode=disable&statement_cache_size=0&connect_timeout=10&pool_timeout=10`;
  const env = { ...process.env, DATABASE_URL: url };
  delete env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK;
  await command(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(here, '.runtime/prisma/schema.prisma')], env);
  prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
  let manifest;
  if (hasManifest) {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const saved = (await prisma.systemSetting.findUnique({ where: { key: 'personal-workspace' } }))?.value;
    if (!saved || ['version', 'mode', 'workspaceId', 'actorId'].some(key => saved[key] !== manifest[key]) || manifest.mode !== 'PERSONAL' || manifest.version !== 2) throw new Error('WORKSPACE_MISMATCH');
  } else {
    if (await prisma.user.count() || await prisma.systemSetting.count()) throw new Error('WORKSPACE_INCOMPLETE');
    manifest = { version: 2, mode: 'PERSONAL', workspaceId: randomUUID() };
    await prisma.$transaction(async tx => {
      const created = await tx.user.create({ data: { name: '本机操作者', email: manifest.workspaceId + '@personal.invalid',
        passwordHash: '!personal-no-login', role: 'INDEPENDENT_LAWYER', systemRole: 'NONE', managerAuthorized: false } });
      manifest.actorId = created.id;
      await tx.systemSetting.create({ data: { key: 'personal-workspace', value: manifest } });
    });
    await writeFile(manifestPath + '.new', JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
    await rename(manifestPath + '.new', manifestPath);
  }
  const actor = await prisma.user.findUnique({ where: { id: manifest.actorId } });
  if (!actor || !/^c[a-z0-9]{24,}$/.test(actor.id) || !actor.active || actor.role !== 'INDEPENDENT_LAWYER' || actor.systemRole !== 'NONE' || actor.managerAuthorized || actor.passwordHash !== '!personal-no-login' || actor.roleDefinitionId || actor.totpEnabled || actor.totpEnforced) throw new Error('WORKSPACE_MISMATCH');
  const referencesReady = (await prisma.systemSetting.findUnique({ where: { key: 'personal-reference-data' } }))?.value?.version === 1;
  await prisma.$disconnect(); prisma = undefined;
  const port = Number(process.env.M1_PORT) || await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => {
      const number = probe.address().port; probe.close(() => resolve(number));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const token = randomBytes(32).toString('hex');
  Object.assign(env, {
    LEXORDER_RUNTIME_MODE: 'PERSONAL', LEXORDER_PERSONAL_ORIGIN: origin, LEXORDER_PERSONAL_CHANNEL_TOKEN: token,
    LEXORDER_PERSONAL_WORKSPACE_ID: manifest.workspaceId, LEXORDER_PERSONAL_ACTOR_ID: manifest.actorId,
    LEXORDER_PERSONAL_MANIFEST: manifestPath,
    APP_STORAGE_DIR: path.join(workspace, 'storage'), STORAGE_PROVIDER: 'local', STORAGE_ENCRYPTION_KEY: storageKey,
    DISABLE_CRON: '1',
  });
  if (!referencesReady) {
    await command(process.execPath, ['--import', 'tsx', path.join(root, 'prisma/seed.ts')], env, root);
    prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
    await prisma.systemSetting.upsert({ where: { key: 'personal-reference-data' }, update: { value: { version: 1 } }, create: { key: 'personal-reference-data', value: { version: 1 } } });
    await prisma.$disconnect(); prisma = undefined;
  }
  const app = path.join(root, '.next-personal/standalone');
  if (stopping) throw new Error('M1_CANCELLED');
  child = spawn(process.execPath, [path.join(app, 'server.js')], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port), NEXT_TELEMETRY_DISABLED: '1',
    M1_WORKSPACE: workspace,
  } });
  // Forward startup diagnostics only; the channel token is never written to stdout.
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  childExit = new Promise(resolve => {
    child.once('error', () => { childEnded = true; resolve({ code: 1 }); });
    child.once('exit', (code, signal) => { childEnded = true; resolve({ code, signal }); });
  });
  let ready = false;
  for (let attempt = 0; attempt < 120 && !childEnded && !stopping; attempt++) {
    try {
      const response = await fetch(origin + '/api/health', { headers: { Cookie: `lexorder_local_channel=${token}` }, signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* bounded local startup polling */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) { await stopChild(); throw new Error('M1_START_FAILED'); }
  if (process.env.M1_READY_FILE) await writeFile(process.env.M1_READY_FILE, JSON.stringify({ origin, openUrl: origin + '/api/personal/open?token=' + token, token, pid: process.pid }), { mode: 0o600 });
  console.log('READY ' + origin);
  const exit = await childExit;
  if (runtimeFailed) throw new Error('M1_DATABASE_RUNTIME_FAILED');
  if (!stopping && exit.code !== 0) throw new Error('M1_RUNTIME_FAILED');
} catch (error) {
  if (!stopping || runtimeFailed) throw error;
} finally {
  await stopChild();
  await prisma?.$disconnect();
  await socket?.stop();
  await database?.close();
  await lock.close(); await rm(path.join(workspace, '.owner'), { force: true });
  if (process.env.M1_READY_FILE) await rm(process.env.M1_READY_FILE, { force: true });
}
