// Isolated acceptance helper. It runs only while the application owner is stopped.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { acquireWorkspaceOwner } from './workspace-owner.mjs';
import { startPrivatePostgres } from './private-pg.mjs';

const workspace = process.env.M1_WORKSPACE;
if (process.env.M1_ACCEPTANCE !== '1' || !workspace || !process.env.M1_BUSINESS_RESULT) throw new Error('ISOLATED_ACCEPTANCE_REQUIRED');
const owner = await acquireWorkspaceOwner(workspace);
let database, socket, prisma;
try {
  const manifest = JSON.parse(await readFile(path.join(workspace, 'workspace.json'), 'utf8'));
  const key = (await readFile(path.join(workspace, 'storage-key'), 'utf8')).trim();
  database = await PGlite.create(path.join(workspace, 'data'));
  const credential = randomBytes(32).toString('hex');
  socket = await startPrivatePostgres(database, credential, () => { throw new Error('ACCEPTANCE_DATABASE_FAILED'); });
  Object.assign(process.env, {
    DATABASE_URL: `postgresql://postgres:${credential}@127.0.0.1:${socket.port}/postgres?schema=public&connection_limit=1&sslmode=disable&statement_cache_size=0`,
    LEXORDER_RUNTIME_MODE: 'PERSONAL', LEXORDER_PERSONAL_ORIGIN: 'http://127.0.0.1:4173',
    LEXORDER_PERSONAL_CHANNEL_TOKEN: randomBytes(32).toString('hex'), LEXORDER_PERSONAL_WORKSPACE_ID: manifest.workspaceId,
    LEXORDER_PERSONAL_ACTOR_ID: manifest.actorId, LEXORDER_PERSONAL_MANIFEST: path.join(workspace, 'workspace.json'),
    STORAGE_PROVIDER: 'local', APP_STORAGE_DIR: path.join(workspace, 'storage'), STORAGE_ENCRYPTION_KEY: key, DISABLE_CRON: '1',
  });
  ({ prisma } = await import('../../src/lib/prisma.ts'));
  const { resolvePersonalActor } = await import('../../src/server/runtime/personal.ts');
  const actor = await resolvePersonalActor(prisma);
  assert.equal(actor.id, manifest.actorId);
  assert.equal(actor.systemRole, 'NONE');
  assert.equal(await prisma.user.count(), 1);
  assert.equal(await prisma.matter.count(), 0);
  assert.equal(await prisma.client.count(), 0);
  const client = await prisma.client.create({ data: { name: 'M1 合成验收客户', type: 'ORGANIZATION', ownerUserId: actor.id, tags: [] } });
  const matter = await prisma.matter.create({ data: { internalCode: 'M1-ACCEPTANCE-001', title: 'M1 合成业务连续性验证',
    category: 'CIVIL_COMMERCIAL', ownerId: actor.id, registeredById: actor.id, primaryClientId: client.id, claimAmount: '120000.01' } });
  const { encryptBuffer, sha256 } = await import('../../src/lib/storage/crypto.ts');
  const { writeFile: writeOriginal, readFile: readOriginal } = await import('../../src/lib/storage/local.ts');
  const original = Buffer.from('M1 合成材料：合同标的 120000.01 元。此文本仅用于工程验收。', 'utf8');
  const enc = encryptBuffer(original);
  const storedPath = await writeOriginal('m1-acceptance', enc.ciphertext);
  assert.notDeepEqual(await readOriginal(storedPath), original);
  const document = await prisma.document.create({ data: { matterId: matter.id, name: 'M1 合成合同.txt', path: storedPath,
    mimeType: 'text/plain', size: original.length, sha256: sha256(original), encrypted: true, algorithm: enc.algorithm,
    iv: enc.iv.toString('base64'), authTag: enc.authTag.toString('base64'), tags: ['合成验收'], uploadedById: actor.id } });
  const { registerReceiptTx, confirmReceiptTx } = await import('../../src/server/finance/ledger-registration.ts');
  const transaction = callback => prisma.$transaction(callback, { isolationLevel: 'Serializable', timeout: 20000 });
  const receipt = await transaction(tx => registerReceiptTx(tx, actor.id, { matterId: matter.id, amount: '40000.01',
    moneyKind: 'LAWYER_FEE', occurredAt: new Date('2026-01-01T00:00:00Z'), payerOrPayee: '合成验收客户' }));
  assert.equal((await prisma.feeEntry.findUnique({ where: { id: receipt.id } })).confirmState, 'PENDING');
  assert.equal(await prisma.payment.count({ where: { matterId: matter.id } }), 0);
  assert.equal(await prisma.timelineEvent.count({ where: { matterId: matter.id, eventType: 'FEE_RECEIVED' } }), 0);
  const confirmations = await Promise.allSettled([
    transaction(tx => confirmReceiptTx(tx, actor.id, receipt.id)),
    transaction(tx => confirmReceiptTx(tx, actor.id, receipt.id)),
  ]);
  assert.equal(confirmations.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await prisma.payment.count({ where: { matterId: matter.id } }), 1);
  const payment = await prisma.payment.findFirst({ where: { matterId: matter.id } });
  assert.equal(payment.amount.toFixed(2), '40000.01');
  assert.equal(await prisma.timelineEvent.count({ where: { matterId: matter.id, eventType: 'FEE_RECEIVED' } }), 1);
  const audit = await prisma.auditLog.findFirst({ where: { targetId: receipt.id, action: 'FEE_ENTRY_CONFIRM' } });
  assert.equal(audit.userId, actor.id);
  assert.equal(audit.detail.runtimeMode, 'PERSONAL');
  assert.equal(audit.detail.decisionPolicy, 'PERSONAL_SELF');
  await assert.rejects(prisma.auditLog.delete({ where: { id: audit.id } }));
  assert.equal(await prisma.auditLog.count({ where: { id: audit.id } }), 1);
  await assert.rejects(resolvePersonalActor(prisma, 'cother000000000000000000001'));
  await writeFile(process.env.M1_BUSINESS_RESULT, JSON.stringify({ actorId: actor.id, matterId: matter.id, matterCode: matter.internalCode,
    clientId: client.id, documentId: document.id, originalSha256: sha256(original), receiptId: receipt.id }), { mode: 0o600 });
  console.log('PASS real_shared_services_pending_manual_confirmation_money_guard_and_encrypted_original');
} finally {
  await prisma?.$disconnect(); await socket?.stop(); await database?.close();
  await owner.close();
}
