// Isolated compatibility evidence, not a production database or application launcher.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { pgDump } from '@electric-sql/pglite-tools';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(process.env.LEXORDER_SOURCE || path.join(here, '../..'));
const work = await mkdtemp(path.join(tmpdir(), 'lexorder-personal-compat-'));
const cli = path.join(here, 'node_modules/prisma/build/index.js');
const report = { node: process.version, platform: `${process.platform}/${process.arch}`, migrationAdvisoryLock: 'enabled', versions: {}, migrations: [], checks: [], limits: ['Synthetic database only; no app authentication, UI, production data, Windows packaging, multi-client isolation, process-kill recovery, or performance acceptance tested.'] };
let db, server, prisma, restored;

async function command(args, env = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env };
    delete childEnv.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK;
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 90000);
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}
async function check(name, fn) {
  const detail = await fn();
  report.checks.push({ name, status: 'PASS', ...(detail === undefined ? {} : { detail }) });
  console.log(`PASS ${name}`);
}
async function catalog(pg) {
  return (await pg.query(`SELECT
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')) AS functions,
    (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) AS triggers,
    (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='c') AS checks,
    (SELECT count(*)::int FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND i.indisunique AND i.indpred IS NOT NULL) AS partial_unique`)).rows[0];
}

try {
  for (const name of ['@electric-sql/pglite', '@electric-sql/pglite-socket', '@electric-sql/pglite-tools', '@prisma/client', 'prisma']) {
    report.versions[name] = JSON.parse(await readFile(path.join(here, 'node_modules', name, 'package.json'), 'utf8')).version;
  }
  // Copy only the schema and migration chain, never application environment files or seed data.
  await mkdir(path.join(work, 'prisma'));
  await cp(path.join(source, 'prisma/schema.prisma'), path.join(work, 'prisma/schema.prisma'));
  await cp(path.join(source, 'prisma/migrations'), path.join(work, 'prisma/migrations'), { recursive: true });
  const schema = await readFile(path.join(work, 'prisma/schema.prisma'), 'utf8');
  report.schemaSha256 = createHash('sha256').update(schema).digest('hex');
  const generated = path.join(here, '.runtime/generated');
  await writeFile(path.join(work, 'prisma/schema.prisma'), schema.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = ${JSON.stringify(generated)}`));
  for (const name of (await readdir(path.join(work, 'prisma/migrations'))).sort()) {
    if (name === 'migration_lock.toml') continue;
    const sql = await readFile(path.join(work, 'prisma/migrations', name, 'migration.sql'));
    report.migrations.push({ name, sha256: createHash('sha256').update(sql).digest('hex') });
  }
  const generatedResult = await command(['generate', '--schema', 'prisma/schema.prisma'], { DATABASE_URL: 'postgresql://unused@127.0.0.1:1/unused' });
  assert.equal(generatedResult.code, 0, generatedResult.output);
  const { PrismaClient, Prisma } = await import(pathToFileURL(path.join(generated, 'index.js')).href);
  assert.equal(Prisma.prismaVersion.client, report.versions['@prisma/client']);
  db = await PGlite.create(path.join(work, 'data'));
  server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 });
  await server.start();
  // Dummy URL credentials are local protocol placeholders, never a user account.
  const url = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?schema=public&connection_limit=1&sslmode=disable&statement_cache_size=0&connect_timeout=10&pool_timeout=10`;
  await check('prisma_migrate_deploy_existing_chain', async () => {
    const result = await command(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { DATABASE_URL: url });
    assert.equal(result.code, 0, result.output);
    const applied = (await db.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
    assert.deepEqual(applied.map(x => x.migration_name), report.migrations.map(x => x.name));
    return applied.map(x => x.migration_name);
  });
  await check('migration_second_run_is_noop', async () => {
    const result = await command(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { DATABASE_URL: url });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /No pending migrations/);
  });
  report.database = (await db.query('SELECT version() AS version, current_database() AS database')).rows[0];
  const guards = await catalog(db);
  await check('database_guard_catalog', () => { assert.deepEqual(guards, { functions: 5, triggers: 10, checks: 25, partial_unique: 8 }); return guards; });
  prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  await check('prisma_types_and_crud', async () => {
    await prisma.user.create({ data: { id: 'spike-owner', name: '合成操作者', email: 'spike@example.invalid', passwordHash: '!not-a-login-hash', role: 'INDEPENDENT_LAWYER' } });
    await prisma.client.create({ data: { id: 'spike-client', name: '合成客户', type: 'INDIVIDUAL', ownerUserId: 'spike-owner', tags: ['合同', '待核实'] } });
    await prisma.matter.create({ data: { id: 'spike-matter', internalCode: 'SPIKE-001', title: '合成事项', ownerId: 'spike-owner', claimAmount: new Prisma.Decimal('123456789012.34') } });
    await prisma.systemSetting.create({ data: { key: 'spike-json', value: { enabled: true, source: ['synthetic'], revision: 1 } } });
    assert.deepEqual((await prisma.client.findUniqueOrThrow({ where: { id: 'spike-client' } })).tags, ['合同', '待核实']);
    assert.equal((await prisma.matter.findUniqueOrThrow({ where: { id: 'spike-matter' } })).claimAmount.toFixed(2), '123456789012.34');
    assert.deepEqual((await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'spike-json' } })).value, { enabled: true, source: ['synthetic'], revision: 1 });
  });
  await check('transaction_commit_rollback_and_advisory_lock', async () => {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('spike', 0))`;
      await tx.systemSetting.create({ data: { key: 'committed', value: { ok: true } } });
    });
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.systemSetting.create({ data: { key: 'rolled-back', value: true } });
      throw new Error('deliberate rollback');
    }), /deliberate rollback/);
    assert.equal(await prisma.systemSetting.count({ where: { key: 'rolled-back' } }), 0);
    assert.equal(await prisma.systemSetting.count({ where: { key: 'committed' } }), 1);
  });
  await check('responsibility_triggers_and_owner_guard', async () => {
    await prisma.task.create({ data: { id: 'spike-task', matterId: 'spike-matter', title: '合成任务' } });
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: 'spike-task' } })).assigneeId, 'spike-owner');
    assert.equal((await prisma.workResponsibility.findUniqueOrThrow({ where: { taskId: 'spike-task' } })).assigneeId, 'spike-owner');
    await prisma.task.update({ where: { id: 'spike-task' }, data: { completed: true } });
    assert.equal((await prisma.workResponsibility.findUniqueOrThrow({ where: { taskId: 'spike-task' } })).state, 'DONE');
    await assert.rejects(prisma.task.update({ where: { id: 'spike-task' }, data: { assigneeId: 'other-owner' } }), /责任变更须经接收人确认/);
  });
  await check('audit_delete_guard_and_connection_after_sql_error', async () => {
    await prisma.auditLog.create({ data: { id: 'spike-audit', userId: 'spike-owner', action: 'SYNTHETIC_COMPATIBILITY' } });
    await assert.rejects(prisma.auditLog.delete({ where: { id: 'spike-audit' } }), /AuditLog 不允许删除/);
    assert.equal(await prisma.auditLog.count({ where: { id: 'spike-audit' } }), 1);
  });
  await check('partial_unique_index_and_soft_delete', async () => {
    const data = { name: '合成重复身份', type: 'INDIVIDUAL', tags: [], idType: 'ID_CARD', idNumberBlind: 'synthetic-blind-index' };
    // Read the enum from the generated client schema rather than assuming a production identity value.
    const enumMatch = schema.match(/enum ClientIdType\s*\{([\s\S]*?)\}/);
    data.idType = enumMatch[1].split('\n').map(x => x.trim()).find(x => x && !x.startsWith('//')).split(/\s/)[0];
    await prisma.client.create({ data: { ...data, id: 'unique-a' } });
    await assert.rejects(prisma.client.create({ data: { ...data, id: 'unique-b' } }), e => e.code === 'P2002');
    await prisma.client.update({ where: { id: 'unique-a' }, data: { deletedAt: new Date() } });
    await prisma.client.create({ data: { ...data, id: 'unique-b' } });
  });
  await check('check_constraint_and_foreign_key', async () => {
    await assert.rejects(prisma.user.update({ where: { id: 'spike-owner' }, data: { role: 'CUSTOM' } }), /User_custom_role_consistent/);
    await assert.rejects(prisma.matter.create({ data: { internalCode: 'BAD-FK', title: '合成无效事项', ownerId: 'missing-owner' } }), e => e.code === 'P2003');
  });
  await check('financial_balance_constraint', async () => {
    // Synthetic confirmed rows probe DB constraints only, not the app's human-confirmation workflow.
    await prisma.feeEntry.create({ data: { id: 'spike-fee', matterId: 'spike-matter', type: 'RECEIVED', moneyKind: 'LAWYER_FEE', amount: new Prisma.Decimal('100.01'), recordedById: 'spike-owner', confirmState: 'CONFIRMED', confirmedById: 'spike-owner', confirmedAt: new Date() } });
    await prisma.payment.create({ data: { id: 'spike-payment', matterId: 'spike-matter', feeEntryId: 'spike-fee', moneyKind: 'LAWYER_FEE', amount: new Prisma.Decimal('100.01') } });
    await assert.rejects(prisma.payment.update({ where: { id: 'spike-payment' }, data: { allocatedAmount: new Prisma.Decimal('100.02') } }), /Payment_balance_check/);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: 'spike-payment' } })).allocatedAmount.toFixed(2), '0.00');
  });
  await check('queue_claim_sql_single_owner', async () => {
    await prisma.jobQueue.create({ data: { id: 'spike-job', type: 'synthetic', payload: { document: 'synthetic' }, dedupeKey: 'spike-key', runAt: new Date(0) } });
    const queueSource = await readFile(path.join(source, 'src/server/cron/queue.ts'), 'utf8');
    const claimSql = queueSource.match(/const rows = await prisma\.\$queryRaw<JobQueue\[\]>\(Prisma\.sql`([\s\S]*?)`\);/)[1].replace('${limit}', '$1');
    const claimed = await prisma.$queryRawUnsafe(claimSql, 1);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].status, 'RUNNING');
    assert.equal((await prisma.$queryRawUnsafe(claimSql, 1)).length, 0);
  });
  await check('parallel_requests_single_prisma_pool', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => prisma.$queryRaw`SELECT ${i}::int AS value`));
    assert.deepEqual(results.map(x => x[0].value), Array.from({ length: 12 }, (_, i) => i));
    return { requests: 12, prismaClients: 1, connectionLimit: 1, maxConnections: 1 };
  });
  await prisma.$disconnect(); prisma = undefined;
  await server.stop(); server = undefined;
  await db.close(); db = undefined;
  db = await PGlite.create(path.join(work, 'data'));
  await check('clean_close_reopen_persistence', async () => {
    assert.equal((await db.query('SELECT "claimAmount"::text AS amount FROM "Matter" WHERE id=$1', ['spike-matter'])).rows[0].amount, '123456789012.34');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "AuditLog" WHERE id=$1', ['spike-audit'])).rows[0].n, 1);
    assert.deepEqual(await catalog(db), guards);
  });
  await check('quiesced_logical_dump_restore', async () => {
    const dump = await pgDump({ pg: db, args: ['--inserts', '--no-owner', '--no-acl'] });
    const sql = await dump.text();
    // pg_dump 18 emits psql-only restrict/unrestrict lines; PGlite.exec accepts SQL, not psql commands.
    const sqlOnly = sql.replace(/^\\(?:un)?restrict .*\r?\n/gm, '');
    assert.ok(!/^\\/m.test(sqlOnly), 'Unexpected psql-only meta-command');
    restored = await PGlite.create(path.join(work, 'restored'));
    await restored.exec(sqlOnly);
    // Dump SQL deliberately changes search_path; production clients must be re-established after restore.
    await restored.close();
    restored = await PGlite.create(path.join(work, 'restored'));
    assert.deepEqual(await catalog(restored), guards);
    assert.equal((await restored.query('SELECT "claimAmount"::text AS amount FROM "Matter" WHERE id=$1', ['spike-matter'])).rows[0].amount, '123456789012.34');
    assert.equal((await restored.query('SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).rows[0].n, report.migrations.length);
    return { bytes: dump.size, quiesced: true, sqlMetaCommandsRemoved: 'psql restrict/unrestrict only', scope: 'database only, same PGlite version' };
  });
  await check('sqlite_provider_only_swap_is_rejected', async () => {
    await writeFile(path.join(work, 'sqlite.prisma'), schema.replace('provider = "postgresql"', 'provider = "sqlite"').replace('url      = env("DATABASE_URL")', 'url      = "file:./sqlite.db"'));
    const result = await command(['validate', '--schema', 'sqlite.prisma']);
    assert.notEqual(result.code, 0);
    const count = result.output.match(/Validation Error Count: (\d+)/)?.[1];
    assert.match(result.output, /does not support|not supported/i);
    return { prisma: report.versions.prisma, validationErrors: count ? Number(count) : null, reason: 'Unchanged PostgreSQL schema is incompatible; no SQLite adapter or migration implemented.' };
  });
  report.status = 'PASS_WITH_STATED_LIMITS';
} catch (error) {
  report.status = 'FAILED';
  report.failure = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  for (const [name, close] of [
    ['client', () => prisma?.$disconnect()],
    ['socket', () => server?.stop()],
    ['restored_database', () => restored?.close()],
    ['database', () => db?.close()],
  ]) {
    try { await close(); }
    catch (error) { cleanupErrors.push({ name, error: String(error) }); }
  }
  if (!cleanupErrors.length) {
    try { await rm(work, { recursive: true, force: true }); }
    catch (error) { cleanupErrors.push({ name: 'temporary_directory', error: String(error) }); }
  }
  if (cleanupErrors.length) {
    report.cleanupErrors = cleanupErrors;
    report.retainedSyntheticDirectory = work;
    report.status = 'FAILED';
    process.exitCode = 1;
  }
  console.log(JSON.stringify(report, null, 2));
}
