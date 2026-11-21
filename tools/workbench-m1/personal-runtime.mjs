// Own the private workspace and shared LawLink/LexOrder app for this session.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { startPrivatePostgres } from './private-pg.mjs';
import { acquireWorkspaceOwner } from './workspace-owner.mjs';
import { createPrismaClient } from '../../src/lib/prisma-client.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const workspace = process.env.M1_WORKSPACE && path.resolve(process.env.M1_WORKSPACE);
if (!workspace) throw new Error('M1_REQUIRES_EXPLICIT_WORKSPACE');
const desktop = process.argv[2] === '--desktop';
const desktopToken = desktop && process.env.LEXORDER_DESKTOP_TOKEN;
if (desktop) delete process.env.LEXORDER_DESKTOP_TOKEN;
if (desktop && !/^[a-f0-9]{64}$/.test(desktopToken ?? '')) throw new Error('M1_DESKTOP_REQUIRES_HOST');
const windows = process.platform === 'win32';
let stopping = false, runtimeFailed = false;
let signalStopped;
const stopped = new Promise(resolve => { signalStopped = resolve; });
function requestStop() {
  stopping = true;
  signalStopped();
}
if (desktop) {
  // The host closes its end of this pipe even if the desktop process crashes.
  process.stdin.once('data', requestStop);
  process.stdin.once('end', requestStop);
  process.stdin.resume();
}
const createdWorkspace = await mkdir(workspace, { recursive: true, mode: 0o700 });
function checkWindowsPrivacy(target, initialize = false) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$current = [Security.Principal.WindowsIdentity]::GetCurrent().User
$allowed = @($current.Value, 'S-1-5-18', 'S-1-5-32-544')
$target = $env:LEXORDER_PRIVATE_PATH
if ($env:LEXORDER_INITIALIZE_ACL -eq '1') {
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in $allowed) {
    $id = [Security.Principal.SecurityIdentifier]::new($sid)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $id, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  [IO.Directory]::SetAccessControl($target, $acl)
}
$acl = if ([IO.Directory]::Exists($target)) {
  [IO.Directory]::GetAccessControl($target)
} else {
  [IO.File]::GetAccessControl($target)
}
foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed) { exit 1 }
}
`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, stdio: 'ignore',
      env: { ...process.env, LEXORDER_PRIVATE_PATH: target, LEXORDER_INITIALIZE_ACL: initialize ? '1' : '0' },
    });
  } catch (cause) {
    throw new Error('WORKSPACE_MUST_BE_PRIVATE', { cause });
  }
}
const info = await lstat(workspace);
if (!info.isDirectory() || info.isSymbolicLink() || (!windows && (info.mode & 0o077))) throw new Error('WORKSPACE_MUST_BE_PRIVATE');
if (windows) checkWindowsPrivacy(workspace, Boolean(createdWorkspace));
const manifestPath = path.join(workspace, 'workspace.json');
const lock = await acquireWorkspaceOwner(workspace);
const childOptions = { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] };
if (lock.fd !== undefined) childOptions.stdio.push(lock.fd);
const ownerGuard = ['--require', fileURLToPath(new URL('./exit-with-owner.mjs', import.meta.url))];
let database, socket, prisma, child, migration;
const terminate = () => { requestStop(); migration?.kill('SIGTERM'); };
process.on('SIGTERM', terminate); process.on('SIGINT', terminate);
const command = (file, args, env, cwd = path.join(here, '.runtime')) => new Promise((resolve, reject) => {
  if (stopping && !desktop) { reject(new Error('M1_CANCELLED')); return; }
  const proc = spawn(file, [...ownerGuard, ...args], { cwd, env, ...childOptions });
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
function startChild(args, cwd, env) {
  const proc = spawn(process.execPath, [...ownerGuard, ...args], { cwd, ...childOptions, env });
  const owned = { proc, ended: false };
  owned.exit = new Promise(resolve => {
    proc.once('error', () => { owned.ended = true; resolve({ code: 1 }); });
    proc.once('exit', (code, signal) => { owned.ended = true; resolve({ code, signal }); });
  });
  // Keep the host's stdout reserved for the readiness protocol.
  proc.stdout.pipe(desktop ? process.stderr : process.stdout, { end: false });
  proc.stderr.pipe(process.stderr, { end: false });
  return owned;
}
async function stopChild(owned) {
  if (!owned || owned.ended) return;
  for (const [signal, timeout] of [['SIGTERM', 10_000], ['SIGKILL', 5000]]) {
    if (desktop && signal === 'SIGTERM') {
      // A Windows process.kill('SIGTERM') terminates the process immediately.
      owned.proc.send('lexorder:quit', error => { if (error && !owned.ended) owned.proc.kill(signal); });
    } else {
      owned.proc.kill(signal);
    }
    let timer;
    await Promise.race([owned.exit, new Promise(resolve => { timer = setTimeout(resolve, timeout); })]);
    clearTimeout(timer);
    if (owned.ended) return;
  }
  throw new Error('M1_OWNER_STOP_FAILED');
}

try {
  if (!desktop && process.env.M1_READY_FILE) await rm(process.env.M1_READY_FILE, { force: true });
  const existing = await readdir(workspace);
  const hasManifest = existing.includes('workspace.json');
  if (!hasManifest && existing.some(name => name !== '.owner')) throw new Error('WORKSPACE_INCOMPLETE');
  if (hasManifest && !existing.includes('data')) throw new Error('WORKSPACE_INCOMPLETE');
  const keyPath = path.join(workspace, 'storage-key');
  if (hasManifest && !existing.includes('storage-key')) throw new Error('WORKSPACE_KEY_MISSING');
  if (!hasManifest) await writeFile(keyPath, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
  const keyInfo = await lstat(keyPath);
  if (!keyInfo.isFile() || keyInfo.isSymbolicLink() || (!windows && (keyInfo.mode & 0o077))) throw new Error('WORKSPACE_KEY_NOT_PRIVATE');
  if (windows) checkWindowsPrivacy(keyPath);
  const storageKey = (await readFile(keyPath, 'utf8')).trim();
  if (Buffer.from(storageKey, 'base64').length !== 32) throw new Error('WORKSPACE_KEY_INVALID');
  await mkdir(path.join(workspace, 'storage'), { recursive: true, mode: 0o700 });
  database = await PGlite.create(path.join(workspace, 'data'));
  const dbCredential = randomBytes(32).toString('hex');
  socket = await startPrivatePostgres(database, dbCredential, () => { runtimeFailed = true; terminate(); });
  const url = `postgresql://postgres:${dbCredential}@127.0.0.1:${socket.port}/postgres?schema=public&connection_limit=1&sslmode=disable&statement_cache_size=0&connect_timeout=10&pool_timeout=10`;
  const env = { ...process.env, DATABASE_URL: url };
  delete env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK;
  await command(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', path.join(root, 'prisma.config.ts')], env, root);
  prisma = createPrismaClient(url);
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
  const port = (!desktop && Number(process.env.M1_PORT)) || await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => {
      const number = probe.address().port; probe.close(() => resolve(number));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const token = desktopToken || randomBytes(32).toString('hex');
  Object.assign(env, {
    LEXORDER_RUNTIME_MODE: 'PERSONAL', LEXORDER_DESKTOP_WEB: (desktop || process.env.M1_WORKBENCH_WEB === '1') ? '1' : '0', LEXORDER_PERSONAL_ORIGIN: origin, LEXORDER_PERSONAL_CHANNEL_TOKEN: token,
    LEXORDER_PERSONAL_WORKSPACE_ID: manifest.workspaceId, LEXORDER_PERSONAL_ACTOR_ID: manifest.actorId,
    LEXORDER_PERSONAL_MANIFEST: manifestPath,
    APP_STORAGE_DIR: path.join(workspace, 'storage'), STORAGE_PROVIDER: 'local', STORAGE_ENCRYPTION_KEY: storageKey,
    // Give shared signed cursors a stable, workspace-scoped key, distinct from file encryption and the rotating channel.
    NEXTAUTH_SECRET: createHmac('sha256', Buffer.from(storageKey, 'base64'))
      .update('lexorder/personal/pagination/v1:' + manifest.workspaceId).digest('base64url'),
    DISABLE_CRON: '1',
  });
  if (!referencesReady) {
    await command(process.execPath, ['--import', 'tsx', path.join(root, 'prisma/seed.ts')], env, root);
    prisma = createPrismaClient(url);
    await prisma.systemSetting.upsert({ where: { key: 'personal-reference-data' }, update: { value: { version: 1 } }, create: { key: 'personal-reference-data', value: { version: 1 } } });
    await prisma.$disconnect(); prisma = undefined;
  }
  const app = path.join(root, process.env.NEXT_DIST_DIR ?? '.next-personal', 'standalone');
  if (stopping) throw new Error('M1_CANCELLED');
  child = startChild([path.join(app, 'server.js')], app, {
    ...env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port), NEXT_TELEMETRY_DISABLED: '1',
    M1_WORKSPACE: workspace,
  });
  let ready = false;
  for (let attempt = 0; attempt < 120 && !child.ended && !stopping; attempt++) {
    try {
      const response = await fetch(origin + '/api/health', { headers: { Cookie: `lexorder_local_channel=${token}` }, signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* bounded local startup polling */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('M1_START_FAILED');
  if (desktop) {
    const shell = await fetch(origin, { signal: AbortSignal.timeout(8000) });
    await shell.body?.cancel();
    if (!shell.ok || !shell.headers.get('content-type')?.startsWith('text/html')) throw new Error('M1_DESKTOP_UI_NOT_READY');
    console.log('LEXORDER_READY ' + origin);
  } else {
    if (process.env.M1_READY_FILE) await writeFile(process.env.M1_READY_FILE, JSON.stringify({ origin, openUrl: origin + '/api/personal/open?token=' + token, token, pid: process.pid }), { mode: 0o600 });
    console.log('READY ' + origin);
  }
  await Promise.race([child.exit, stopped]);
  if (runtimeFailed) throw new Error('M1_DATABASE_RUNTIME_FAILED');
  if (!stopping) throw new Error('M1_RUNTIME_FAILED');
} catch (error) {
  if (!stopping || runtimeFailed) throw error;
} finally {
  if (desktop) process.stdin.pause();
  await stopChild(child);
  await prisma?.$disconnect();
  await socket?.stop();
  await database?.close();
  if (!desktop && process.env.M1_READY_FILE) await rm(process.env.M1_READY_FILE, { force: true });
  await lock.close();
}
