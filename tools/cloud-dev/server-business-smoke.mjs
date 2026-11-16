// Server-only acceptance extension. Run from the application repository root:
// WORKBENCH_QA_SCRIPT=/absolute/path/to/this/file node tools/cloud-dev/run.mjs verify
// The runner owns PostgreSQL/Web; this child inherits the same network namespace.
// Fixtures use Prisma; authentication and download/export checks use real HTTP.
// Finance writes call the existing transaction services, not a simulated session
// or an invented REST endpoint. This is not browser interaction verification.
import assert, { AssertionError } from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.cwd();
assert.equal((process.env.LEXORDER_RUNTIME_MODE || 'SERVER').trim().toUpperCase(), 'SERVER', 'Server smoke refuses another runtime mode');
const database = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(database.protocol, 'postgresql:', 'Server smoke requires PostgreSQL');
assert(['127.0.0.1', 'localhost'].includes(database.hostname) && database.pathname.endsWith('_test'), 'Server smoke requires an isolated loopback _test database');
assert.equal(process.env.STORAGE_PROVIDER || 'local', 'local', 'Server smoke uses isolated local storage');
const storageRoot = resolve(process.env.APP_STORAGE_DIR || 'missing');
assert(storageRoot.startsWith(`${resolve(root, '.runtime')}${sep}`) && storageRoot.endsWith(`${sep}acceptance-storage`), 'Use the runner acceptance storage directory');

// WORKBENCH_QA_SCRIPT is launched with plain Node. Keep the parent runner intact.
if (process.env.LEXORDER_SERVER_SMOKE_CHILD !== '1') {
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
    cwd: root, env: { ...process.env, LEXORDER_SERVER_SMOKE_CHILD: '1' }, stdio: 'inherit',
  });
  const forward = () => child.kill('SIGTERM');
  process.once('SIGTERM', forward);
  process.once('SIGINT', forward);
  const code = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (status) => done(status ?? 1));
  });
  process.exit(code);
}

// Resolve sources from the running application, so the QA script may stay in a
// separate worktree while the runner validates its own build and services.
const source = file => import(pathToFileURL(resolve(root, file)).href);
const [{ PrismaClient }, { default: bcrypt }, { default: ExcelJS }, { default: PizZip },
  { registerReceiptTx, confirmReceiptTx }, { encryptBuffer, sha256 }, { storage }, { prisma: appDb }] = await Promise.all([
  import('@prisma/client'), import('bcryptjs'), import('exceljs'), import('pizzip'),
  source('src/server/finance/ledger-registration.ts'), source('src/lib/storage/crypto.ts'),
  source('src/lib/storage/index.ts'), source('src/lib/prisma.ts'),
]);
const db = new PrismaClient();
const port = Number(process.env.PORT || 3000);
assert(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid runner port');
const base = `http://127.0.0.1:${port}`;
const checks = [];
const ids = { users: [], roles: [], matters: [], documents: [], files: [] };
const tag = `server-smoke-${randomUUID()}`;
let phase = 'fixture setup';

function httpSession() {
  const jar = new Map();
  return async (path, options = {}) => {
    assert(path.startsWith('/') && !path.startsWith('//'), 'Only local HTTP routes are allowed');
    const response = await fetch(`${base}${path}`, {
      ...options, redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: { ...options.headers, cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';', 1)[0], at = first.indexOf('=');
      jar.set(first.slice(0, at), first.slice(at + 1));
    }
    return response;
  };
}

async function signIn(request, user, password) {
  const csrfResponse = await request('/api/auth/csrf');
  assert.equal(csrfResponse.status, 200, 'Credentials CSRF endpoint must be available');
  const csrf = await csrfResponse.json();
  assert(csrf.csrfToken, 'CSRF token missing');
  await request('/api/auth/callback/credentials', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: user.email, password, callbackUrl: `${base}/matters`, json: 'true' }),
  });
  const response = await request('/api/auth/session');
  assert.equal(response.status, 200, 'Session endpoint failed');
  const session = await response.json();
  assert.equal(session.user?.id, user.id, 'Real credentials login did not resolve the fixture user');
  assert.equal(session.user?.role, user.role, 'Login must retain the real Server business role');
  assert.notEqual(session.user?.runtimeMode, 'PERSONAL', 'Server login returned a different actor mode');
  return session.user.id;
}

async function expectStatus(request, path, status, description) {
  const response = await request(path);
  assert.equal(response.status, status, description);
  await response.arrayBuffer();
}

async function expectUnauthenticated(request, path) {
  const response = await request(path);
  if (response.status !== 401) {
    assert([302, 303, 307, 308].includes(response.status), 'Unauthenticated API must reject or redirect to login');
    const location = new URL(response.headers.get('location'), base);
    assert.equal(location.origin, base, 'Login redirect must stay local');
    assert.equal(location.pathname, '/login', 'Unauthenticated API redirected to an unexpected page');
  }
  await response.arrayBuffer();
}

const transaction = work => db.$transaction(work, { isolationLevel: 'Serializable', timeout: 20_000 });
async function changeFixtureRole(work) {
  await transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
    await work(tx);
  });
}

async function csvReceipt(request, marker) {
  const response = await request('/api/finance/export');
  assert.equal(response.status, 200, 'Finance CSV endpoint failed');
  assert(response.headers.get('content-type')?.startsWith('text/csv'), 'Finance export must be CSV');
  const text = await response.text();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rows = lines.filter(line => line.includes(marker));
  assert.equal(rows.length, 1, 'Finance CSV must contain exactly one synthetic receipt row');
  // This fixture deliberately has no comma, quote or newline in its text cells.
  return { text, row: Object.fromEntries(lines[0].split(',').map((column, index) => [column, rows[0].split(',')[index]])) };
}

async function verifyBundle(request, matter, doc, plain, exporter) {
  const response = await request(`/api/matters/${matter.id}/export-bundle`);
  assert.equal(response.status, 200, 'Authorized complete matter bundle must succeed');
  assert(response.headers.get('content-type')?.startsWith('application/zip'), 'Matter bundle must be ZIP');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(sha256(bytes), response.headers.get('x-bundle-sha256'), 'Bundle transport checksum mismatch');
  const zip = new PizZip(bytes);
  const manifestFiles = Object.keys(zip.files).filter(name => name.endsWith('/manifest.json'));
  assert.equal(manifestFiles.length, 1, 'Bundle manifest missing or ambiguous');
  const manifest = JSON.parse(zip.file(manifestFiles[0]).asText());
  assert.equal(manifest.exportedBy, exporter, 'Bundle must record the authenticated exporter');
  assert.equal(manifest.matter.title, matter.title, 'Bundle returned a different matter');
  assert.equal(manifest.documents.length, 1, 'Unexpected synthetic matter document count');
  assert.equal(manifest.documents[0].sha256, doc.sha256, 'Manifest must retain the source document checksum');
  const entries = Object.keys(zip.files).filter(name => name.endsWith(`_${doc.name}`));
  assert.equal(entries.length, 1, 'Bundle must contain the material, not a read-failure placeholder');
  assert.deepEqual(zip.file(entries[0]).asNodeBuffer(), plain, 'Bundle material differs from the original');
}

async function run() {
  const seedAdmin = await db.user.findUniqueOrThrow({
    where: { email: process.env.SEED_ADMIN_EMAIL },
    select: { id: true, role: true, systemRole: true, roleDefinitionId: true, managerAuthorized: true },
  });
  const password = randomBytes(32).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);
  async function user(label, role, extra = {}) {
    const created = await db.user.create({ data: {
      name: `合成部署验收-${label}`, email: `${tag}-${label}@example.invalid`, passwordHash,
      role, systemRole: 'NONE', managerAuthorized: false, active: true, ...extra,
    } });
    ids.users.push(created.id);
    return created;
  }
  const role = await db.roleDefinition.create({ data: {
    name: tag.slice(0, 60), normalizedName: tag.slice(0, 60),
    permissions: { create: [
      { permissionKey: 'matters.read', scope: 'ALL' }, { permissionKey: 'matters.export', scope: 'OWN' },
      { permissionKey: 'documents.read', scope: 'OWN' }, { permissionKey: 'documents.download', scope: 'OWN' },
      { permissionKey: 'finance.read', scope: 'OWN' }, { permissionKey: 'reports.export', scope: 'OWN' },
    ] },
  } });
  ids.roles.push(role.id);
  const owner = await user('owner', 'LAWYER');
  // These are synthetic real roles, not a modification of the seed administrator.
  const systemManager = await user('system-manager', 'LAWYER', { systemRole: 'SUPER_ADMIN', managerAuthorized: true });
  const finance = await user('finance', 'FINANCE');
  const custom = await user('custom', 'CUSTOM', { roleDefinitionId: role.id });
  const principal = await user('principal', 'PRINCIPAL_LAWYER');
  const main = await db.matter.create({ data: { internalCode: `${tag}-main`.toUpperCase(), title: `${tag}-本人事项`, ownerId: owner.id } });
  ids.matters.push(main.id);
  const foreign = await db.matter.create({ data: { internalCode: `${tag}-foreign`.toUpperCase(), title: `${tag}-其他事项`, ownerId: systemManager.id } });
  ids.matters.push(foreign.id);
  const plain = Buffer.from(`Synthetic Server acceptance material. ${tag}\n`, 'utf8');
  const encrypted = encryptBuffer(plain);
  const path = await storage.writeFile('server-business-smoke', encrypted.ciphertext);
  ids.files.push(path);
  assert.notDeepEqual(await storage.readFile(path), plain, 'Synthetic document must be encrypted at rest');
  const document = await db.document.create({ data: {
    matterId: main.id, uploadedById: owner.id, name: 'synthetic-server-material.txt',
    path, mimeType: 'text/plain', size: plain.length, sha256: sha256(plain), tags: [], status: 'DRAFT',
    encrypted: true, algorithm: encrypted.algorithm, iv: encrypted.iv.toString('base64'), authTag: encrypted.authTag.toString('base64'),
  } });
  ids.documents.push(document.id);
  const sessions = new Map();
  for (const actor of [owner, systemManager, finance, custom, principal]) {
    const request = httpSession();
    assert.equal(await signIn(request, actor, password), actor.id);
    sessions.set(actor.id, request);
  }
  const owned = sessions.get(owner.id), managed = sessions.get(systemManager.id), financed = sessions.get(finance.id);
  const customized = sessions.get(custom.id), partnered = sessions.get(principal.id);
  checks.push('Five isolated Server users authenticate through real credentials, CSRF and session endpoints with their unchanged business roles');

  phase = 'HTTP matter and material authorization';
  const matterPage = await owned(`/matters/${encodeURIComponent(main.internalCode)}`);
  assert.equal(matterPage.status, 200, 'Owned matter page failed');
  assert((await matterPage.text()).includes(main.title), 'Owned matter is not rendered');
  const downloadPath = `/api/documents/${document.id}/download`;
  const download = await owned(downloadPath);
  assert.equal(download.status, 200, 'Owner material download failed');
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert(download.headers.get('content-disposition')?.startsWith('attachment;'));
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), plain, 'HTTP download did not decrypt the original material');
  await expectUnauthenticated(httpSession(), downloadPath);
  await expectStatus(managed, downloadPath, 403, 'System identity and business management rights must not grant unrelated material access');
  await expectStatus(financed, downloadPath, 403, 'Finance role must not grant unrelated material access');
  await expectStatus(customized, downloadPath, 403, 'CUSTOM ALL matter overview must not grant unrelated material download');
  await expectStatus(partnered, downloadPath, 200, 'Actual principal business role must retain its material read rule');
  checks.push('Owned encrypted material downloads as original bytes; anonymous, unrelated finance, system/manager and CUSTOM overview access cannot read it');

  phase = 'HTTP complete matter export';
  await verifyBundle(owned, main, document, plain, owner.id);
  await verifyBundle(partnered, main, document, plain, principal.id);
  const bundlePath = `/api/matters/${main.id}/export-bundle`;
  await expectStatus(managed, bundlePath, 403, 'System/manager identity must not grant unrelated complete bundles');
  await expectStatus(customized, bundlePath, 403, 'CUSTOM ALL overview is not complete bundle authorization');
  await expectStatus(financed, bundlePath, 403, 'Finance role must use financial export');
  const workbookResponse = await owned('/api/matters/export?tab=all');
  assert.equal(workbookResponse.status, 200, 'Owner matter workbook failed');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await workbookResponse.arrayBuffer()));
  const cellTexts = [];
  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => cellTexts.push(cell.text))));
  assert(cellTexts.includes(main.title), 'Owned matter missing from workbook');
  assert(!cellTexts.includes(foreign.title), 'Unrelated matter leaked into workbook');
  checks.push('Complete bundles preserve manifest, original bytes and checksums for owner/principal; broad overview roles are denied and the workbook retains own-matter scope');

  phase = 'current role revocation on an existing HTTP session';
  await db.matterMember.create({ data: { matterId: main.id, userId: custom.id, role: 'ASSISTANT' } });
  await expectStatus(customized, downloadPath, 200, 'Actual CUSTOM member with a download grant must be able to download');
  await verifyBundle(customized, main, document, plain, custom.id);
  await changeFixtureRole(tx => tx.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: 'documents.download' } } }));
  await expectStatus(customized, downloadPath, 403, 'Revoking documents.download must apply to the existing session');
  await expectStatus(customized, bundlePath, 403, 'Revoking documents.download must also block a complete bundle');
  await changeFixtureRole(async tx => {
    await tx.rolePermission.create({ data: { roleId: role.id, permissionKey: 'documents.download', scope: 'OWN' } });
    await tx.rolePermission.delete({ where: { roleId_permissionKey: { roleId: role.id, permissionKey: 'finance.read' } } });
  });
  await expectStatus(customized, downloadPath, 200, 'An independent finance grant must not change authorized material downloads');
  await expectStatus(customized, bundlePath, 403, 'A complete bundle includes financial data and requires finance.read');
  await expectStatus(customized, '/api/finance/export', 403, 'Financial export requires a current finance.read grant');
  await changeFixtureRole(tx => tx.roleDefinition.update({ where: { id: role.id }, data: { active: false } }));
  await expectUnauthenticated(customized, downloadPath);
  checks.push('The same real session observes membership, download-grant revocation, independent finance authorization and role disabling without re-login');

  phase = 'real PostgreSQL pending receipt and unauthorized confirmation';
  await db.commissionPlan.create({ data: { matterId: main.id, userId: owner.id, percent: '25.00', active: true } });
  const receiptMarker = `${tag}-receipt`, foreignMarker = `${tag}-foreign-receipt`;
  const receipt = await transaction(tx => registerReceiptTx(tx, owner.id, {
    matterId: main.id, amount: '12345.67', moneyKind: 'LAWYER_FEE', occurredAt: new Date(), note: receiptMarker,
  }));
  await transaction(tx => registerReceiptTx(tx, systemManager.id, {
    matterId: foreign.id, amount: '1.23', moneyKind: 'LAWYER_FEE', occurredAt: new Date(), note: foreignMarker,
  }));
  assert.equal((await db.feeEntry.findUniqueOrThrow({ where: { id: receipt.id } })).confirmState, 'PENDING');
  assert.equal(await db.payment.count({ where: { feeEntryId: receipt.id } }), 0, 'Pending registration must not create a Payment');
  assert.equal(await db.feeEntry.count({ where: { parentFeeEntryId: receipt.id } }), 0, 'Pending registration must not derive commissions');
  assert.equal(await db.timelineEvent.count({ where: { matterId: main.id, refId: receipt.id, eventType: 'FEE_RECEIVED' } }), 0, 'Pending registration must not add a receipt timeline event');
  const pendingCsv = await csvReceipt(owned, receiptMarker);
  assert.equal(pendingCsv.row['确认状态'], '待确认');
  assert.equal(pendingCsv.row['已确认净实收'], '', 'Pending CSV must not claim confirmed proceeds');
  assert.equal(pendingCsv.row['金额'], '12345.67');
  assert(!pendingCsv.text.includes(foreignMarker), 'Financial CSV leaked an unrelated matter');
  for (const actor of [owner, systemManager, principal]) {
    await assert.rejects(transaction(tx => confirmReceiptTx(tx, actor.id, receipt.id)), /确认实收到账/, 'Only finance.confirm authorization permits receipt confirmation');
  }
  assert.equal((await db.feeEntry.findUniqueOrThrow({ where: { id: receipt.id } })).confirmState, 'PENDING', 'Unauthorized attempts must leave the receipt pending');
  assert.equal(await db.payment.count({ where: { feeEntryId: receipt.id } }), 0);
  checks.push('Real Server registration stays PENDING without Payment, commission or timeline; CSV excludes it from confirmed proceeds and owner/system-manager/principal cannot confirm without finance authority');

  phase = 'concurrent authorized receipt confirmation';
  const attempts = await Promise.allSettled([
    transaction(tx => confirmReceiptTx(tx, finance.id, receipt.id)),
    transaction(tx => confirmReceiptTx(tx, finance.id, receipt.id)),
  ]);
  assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1, 'Concurrent confirmations must commit exactly once');
  const rejected = attempts.find(attempt => attempt.status === 'rejected');
  assert(rejected && (rejected.reason?.code === 'P2034'
    || (rejected.reason?.code === 'P2010' && rejected.reason?.meta?.code === '40001')
    || /已被处理/.test(rejected.reason?.message || '')), 'The losing confirmation must fail on state or serialization protection');
  const confirmed = await db.feeEntry.findUniqueOrThrow({ where: { id: receipt.id } });
  assert.equal(confirmed.confirmState, 'CONFIRMED');
  assert.equal(confirmed.recordedById, owner.id);
  assert.equal(confirmed.confirmedById, finance.id);
  assert(confirmed.amount.eq('12345.67'), 'Receipt Decimal amount changed');
  const payments = await db.payment.findMany({ where: { feeEntryId: receipt.id } });
  assert.equal(payments.length, 1);
  assert(payments[0].amount.eq('12345.67'), 'Payment Decimal amount changed');
  assert.equal(await db.timelineEvent.count({ where: { matterId: main.id, refId: receipt.id, eventType: 'FEE_RECEIVED' } }), 1);
  const commissions = await db.feeEntry.findMany({ where: { parentFeeEntryId: receipt.id, type: 'COMMISSION' } });
  assert.equal(commissions.length, 1, 'Confirmation must derive the plan exactly once');
  assert(commissions[0].amount.eq('3086.42'), 'Persisted commission must preserve the existing cent rounding');
  const audits = await db.auditLog.findMany({ where: { targetType: 'FeeEntry', targetId: receipt.id, action: { in: ['FEE_ENTRY_SUBMIT', 'FEE_ENTRY_CONFIRM'] } } });
  assert.equal(audits.filter(event => event.action === 'FEE_ENTRY_SUBMIT').length, 1);
  const confirmations = audits.filter(event => event.action === 'FEE_ENTRY_CONFIRM');
  assert.equal(confirmations.length, 1, 'Confirmation audit must be committed exactly once');
  assert.equal(confirmations[0].userId, finance.id);
  assert.notEqual(confirmations[0].detail?.decisionPolicy, 'PERSONAL_SELF', 'Server confirmation must not be labelled as local self-confirmation');
  const confirmedCsv = await csvReceipt(owned, receiptMarker);
  assert.equal(confirmedCsv.row['确认状态'], '已确认');
  assert.equal(confirmedCsv.row['已确认净实收'], '12345.67');
  const financeCsv = await csvReceipt(financed, receiptMarker);
  assert(financeCsv.text.includes(foreignMarker), 'Actual FINANCE role must retain its global financial view');
  checks.push('Two real Serializable confirmations commit one Payment, one commission, one timeline event and one finance-actor audit; HTTP CSV then reports the exact confirmed amount');

  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: seedAdmin.id }, select: { id: true, role: true, systemRole: true, roleDefinitionId: true, managerAuthorized: true } }), seedAdmin, 'The seed administrator business privileges must remain unchanged');
}

try {
  await run();
} catch (error) {
  console.error(JSON.stringify({ serverBusinessSmoke: 'failed', phase, checks,
    error: error instanceof AssertionError ? error.message : 'The isolated HTTP/database operation failed; response bodies and credentials are not logged.' }, null, 2));
  process.exitCode = 1;
} finally {
  // Keep accounting history and audits; hide/deactivate only this run's fixtures.
  // Do not delete confirmed receipts, payments, financial history or AuditLog.
  try {
    await db.$transaction(async tx => {
      if (ids.documents.length) await tx.document.updateMany({ where: { id: { in: ids.documents } }, data: { deletedAt: new Date() } });
      if (ids.matters.length) await tx.matter.updateMany({ where: { id: { in: ids.matters } }, data: { deletedAt: new Date() } });
      if (ids.roles.length) await tx.roleDefinition.updateMany({ where: { id: { in: ids.roles } }, data: { active: false } });
      if (ids.users.length) await tx.user.updateMany({ where: { id: { in: ids.users } }, data: { active: false, sessionVersion: { increment: 1 } } });
    });
    for (const path of ids.files) await storage.deleteFile(path);
  } catch {
    console.error(JSON.stringify({ serverBusinessSmoke: 'cleanup-failed', message: 'Synthetic fixtures could not all be hidden or deactivated in the isolated acceptance database.' }));
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
    await appDb.$disconnect();
  }
}
if (!process.exitCode) console.log(JSON.stringify({ serverBusinessSmoke: 'passed', runtimeMode: 'SERVER', checks,
  coverage: { http: 'Real credentials, material download, complete bundle, matter workbook and financial CSV', financeWrites: 'Existing Server transaction services against real PostgreSQL; no HTTP Server Action invocation', browserVisualQA: 'not performed' },
  cleanup: 'Synthetic documents/matters soft-deleted, synthetic roles/users disabled, synthetic ciphertext removed; finance history and audits retained' }, null, 2));
