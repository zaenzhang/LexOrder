// Development / acceptance only. Production uses the existing Docker deployment.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

process.umask(0o077);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2] || 'serve';
if (!['serve', 'test', 'verify'].includes(mode)) throw new Error('Usage: node tools/cloud-dev/run.mjs [serve|test|verify]');
const envFile = resolve(root, '.env');
if (!existsSync(envFile)) throw new Error('Create a private .env from .env.example before starting. See docs/CLOUD_SETUP.md.');
const env = { ...parseEnv(readFileSync(envFile, 'utf8')), ...process.env, DISABLE_CRON: '1', BACKUP_CRON_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1' };
const url = new URL(env.DATABASE_URL || 'invalid:');
if (url.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || !url.username || decodeURIComponent(url.password).length < 16) {
  throw new Error('This development runner requires an explicit loopback PostgreSQL URL and a random password of at least 16 characters.');
}
const database = url.pathname.slice(1);
if (!/^[a-z][a-z0-9_]{1,40}$/.test(database) || database.endsWith('_test')) throw new Error('Use a named development database of up to 41 characters, without the _test suffix.');
const testDatabase = `${database}_acceptance_test`;
const runtime = resolve(root, '.runtime/cloud');
mkdirSync(runtime, { recursive: true, mode: 0o700 });
chmodSync(runtime, 0o700);
const testKeyFile = resolve(runtime, 'acceptance-storage.key');
if (!existsSync(testKeyFile)) writeFileSync(testKeyFile, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 });
chmodSync(testKeyFile, 0o600);
const testStorage = resolve(runtime, 'acceptance-storage');
mkdirSync(testStorage, { recursive: true, mode: 0o700 });
const dataDir = resolve(runtime, 'pgdata');
const logFile = resolve(runtime, 'postgres.log');
const password = decodeURIComponent(url.password);
const log = line => appendFileSync(logFile, `${String(line).replaceAll(password, '[REDACTED]')}\n`, { mode: 0o600 });
const cluster = new EmbeddedPostgres({
  databaseDir: dataDir, user: decodeURIComponent(url.username), password, port: Number(url.port),
  persistent: true, createPostgresUser: false, authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories=', '-c', 'password_encryption=scram-sha-256'],
  onLog: log, onError: log
});
const children = new Set();
function command(executable, args, childEnv = env) {
  const child = spawn(executable, args, { cwd: root, env: childEnv, stdio: 'inherit' });
  children.add(child);
  const done = new Promise((resolveDone, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      children.delete(child);
      if (code === 0) resolveDone();
      else reject(new Error(`${executable} failed (${code ?? signal})`));
    });
  });
  return { child, done };
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  await cluster.stop();
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });

try {
  if (existsSync(resolve(dataDir, 'postmaster.pid'))) throw new Error('A database PID file exists. Stop the owning session gracefully before reusing this directory; this runner never removes a live lock file.');
  if (!existsSync(resolve(dataDir, 'PG_VERSION'))) await cluster.initialise();
  await cluster.start();
  const connection = new pg.Client({ host: '127.0.0.1', port: Number(url.port), user: decodeURIComponent(url.username), password, database: 'postgres' });
  await connection.connect();
  try {
    for (const name of [database, testDatabase]) {
      if ((await connection.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount === 0) await connection.query(`CREATE DATABASE "${name}"`);
    }
    console.log(`PostgreSQL ${(await connection.query('SHOW server_version')).rows[0].server_version} ready (loopback only).`);
  } finally { await connection.end(); }
  const testUrl = new URL(url); testUrl.pathname = `/${testDatabase}`;
  const testEnv = { ...env, DATABASE_URL: testUrl.toString(), WORKBENCH_TEST_DATABASE_URL: testUrl.toString(), STORAGE_ENCRYPTION_KEY: readFileSync(testKeyFile, 'utf8').trim(), APP_STORAGE_DIR: testStorage };

  if (mode !== 'serve') {
    await command('npx', ['prisma', 'migrate', 'deploy'], testEnv).done;
    await command('npx', ['prisma', 'migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], testEnv).done;
    await command('npm', ['run', 'test:run'], testEnv).done;
  }
  if (mode !== 'test') {
    const appEnv = mode === 'verify' ? testEnv : env;
    if (!appEnv.SEED_ADMIN_PASSWORD || appEnv.SEED_ADMIN_PASSWORD.length < 16) throw new Error('Configure a random SEED_ADMIN_PASSWORD of at least 16 characters.');
    await command('npx', ['prisma', 'migrate', 'deploy'], appEnv).done;
    // 官方 tsx Node loader；无需 CLI 的本地 IPC 监听，适用于限制 Unix socket 的环境。
    await command(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], appEnv).done;
    const app = command(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3000'], { ...appEnv, NEXT_DIST_DIR: '.next-build' });
    void app.done.catch(() => {}); // 就绪检查期间也登记退出处理；最终仍 await 同一结果。
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await fetch('http://127.0.0.1:3000/api/health').then(r => r.ok).catch(() => false)) { ready = true; break; }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
    }
    if (!ready) throw new Error('Application did not become ready.');
    console.log(`LexOrder ready at http://127.0.0.1:3000 in this execution session (${mode === 'verify' ? 'isolated test' : 'development'} database).`);
    if (mode === 'verify') await command(process.execPath, ['--import', 'tsx', 'tools/cloud-dev/smoke.mjs'], appEnv).done;
    if (mode === 'verify' && env.WORKBENCH_QA_SCRIPT) await command(process.execPath, [resolve(env.WORKBENCH_QA_SCRIPT)], appEnv).done;
    if (mode === 'serve') await app.done;
    else { app.child.kill('SIGTERM'); await app.done.catch(() => {}); }
  }
} finally { await stop(); }
