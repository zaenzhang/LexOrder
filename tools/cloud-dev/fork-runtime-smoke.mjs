// Optional real-process checks for the fork integration. Only an isolated _test DB is accepted.
// WORKBENCH_QA_SCRIPT=tools/cloud-dev/fork-runtime-smoke.mjs node tools/cloud-dev/run.mjs verify
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

assert(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'), 'Runtime smoke requires an isolated test database');
const db = new PrismaClient();
const children = new Set();
const checks = [];
function launch(args, extraEnv = {}) {
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; });
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { children.delete(child); resolveDone({ code, signal }); });
  });
  return { child, done, output: () => output };
}
async function waitUntil(predicate, description, milliseconds = 15_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
async function finish(process, expectedCode, description) {
  const deadline = setTimeout(() => process.child.kill('SIGKILL'), 40_000);
  try {
    const result = await process.done;
    assert.equal(result.code, expectedCode, `${description}: unexpected exit (${result.code ?? result.signal})`);
  } finally { clearTimeout(deadline); }
}
let temporary;
try {
  const before = await db.documentTemplate.findMany({ orderBy: { id: 'asc' }, select: { id: true, docxBlobId: true, enabled: true } });
  const beforeSettings = await db.systemSetting.findMany({ orderBy: { key: 'asc' } });
  const sync = launch(['--import', 'tsx', 'scripts/sync-document-templates.ts']);
  await finish(sync, 0, 'template sync');
  assert.deepEqual(await db.documentTemplate.findMany({ orderBy: { id: 'asc' }, select: { id: true, docxBlobId: true, enabled: true } }), before);
  assert.deepEqual(await db.systemSetting.findMany({ orderBy: { key: 'asc' } }), beforeSettings);
  checks.push('Template sync exits successfully and preserves existing template files, states, and system settings');

  const worker = launch(['--import', 'tsx', 'src/server/cron/standalone.ts']);
  await waitUntil(() => worker.output().includes('[cron-worker] starting'), 'standalone worker startup');
  worker.child.kill('SIGTERM');
  await finish(worker, 0, 'worker shutdown');
  checks.push('Standalone worker starts and exits cleanly on SIGTERM');

  temporary = await mkdtemp(resolve('.runtime/fork-backup-smoke-'));
  const invalidDirectory = resolve(temporary, 'is-a-file');
  await writeFile(invalidDirectory, 'Synthetic preflight failure fixture');
  const failureFilter = { action: 'DATABASE_BACKUP_FAILED_CRON', targetId: 'database-backup-cli' };
  const beforeFailures = await db.auditLog.count({ where: failureFilter });
  const backup = launch(['--import', 'tsx', 'scripts/run-database-backup.ts'], { BACKUP_DIR: invalidDirectory, BACKUP_CRON_ENABLED: 'false' });
  await finish(backup, 1, 'backup preflight');
  assert.equal(await db.auditLog.count({ where: failureFilter }), beforeFailures + 1);
  checks.push('Explicit backup runs preflight despite the automatic-backup switch, exits 1, and persists a failure audit for an invalid destination');

  const port = 3001;
  const supervisor = launch(['scripts/run-with-cron.mjs'], { PORT: String(port), LEXORDER_HOST: '127.0.0.1', NEXTAUTH_URL: `http://127.0.0.1:${port}`, BACKUP_CRON_ENABLED: 'false' });
  await waitUntil(async () => supervisor.output().includes('[cron-worker] starting') && await fetch(`http://127.0.0.1:${port}/api/health`).then(response => response.ok).catch(() => false), 'supervised Web and worker readiness');
  supervisor.child.kill('SIGTERM');
  await finish(supervisor, 0, 'supervisor shutdown');
  await waitUntil(() => fetch(`http://127.0.0.1:${port}/api/health`).then(() => false).catch(() => true), 'Web shutdown');
  checks.push('Supervisor starts healthy Web plus worker and stops both on SIGTERM');
  console.log(JSON.stringify({ forkRuntimeSmoke: 'passed', checks }, null, 2));
} finally {
  for (const child of children) child.kill('SIGTERM');
  if (temporary) await rm(temporary, { recursive: true, force: true });
  await db.$disconnect();
}
