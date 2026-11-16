// Real HTTP authentication + server-rendered workflow check, not browser visual QA.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { saveClientActivity } from '../../src/server/clients/relationship-service.ts';
import { readFile } from '../../src/lib/storage/local.ts';
import { decryptBuffer, sha256 } from '../../src/lib/storage/crypto.ts';
import { runWeeklyReportPush } from '../../src/server/reports/weekly-push-core.ts';
import { prisma as appDb } from '../../src/lib/prisma.ts';

const db = new PrismaClient();
const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
const checks = [];
let clientId, otherId;
assert(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'), 'HTTP smoke requires an isolated _test database');

function httpSession() {
  const jar = new Map();
  return async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, { ...options, redirect: 'manual', headers: { ...options.headers, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';', 1)[0], at = first.indexOf('=');
      jar.set(first.slice(0, at), first.slice(at + 1));
    }
    return response;
  };
}

async function signIn(request, email, password) {
  const csrf = await request('/api/auth/csrf').then(r => r.json());
  assert(csrf.csrfToken);
  await request('/api/auth/callback/credentials', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password, callbackUrl: `${base}/clients`, json: 'true' })
  });
  const session = await request('/api/auth/session').then(r => r.json());
  assert.equal(session.user?.email, email, 'Real credentials login failed');
}

try {
  const templates = await db.documentTemplate.findMany({ where: { isBuiltIn: true }, select: { docxBlobId: true, category: true } });
  assert(templates.length > 0, 'Built-in templates missing');
  assert.equal(templates.filter(template => template.category === 'EXECUTION').length, 3, 'Execution templates missing from fresh install');
  for (const template of templates) {
    const doc = await db.document.findUniqueOrThrow({ where: { id: template.docxBlobId } });
    const file = await readFile(doc.path);
    const plain = doc.encrypted ? decryptBuffer(file, doc.iv, doc.authTag) : file;
    assert.equal(sha256(plain), doc.sha256, 'Persisted template failed decryption/checksum');
  }
  checks.push(`${templates.length} persisted built-in templates decrypt and match their checksums`);
  const owner = await db.user.findUniqueOrThrow({ where: { email: process.env.SEED_ADMIN_EMAIL } });
  const user = { id: owner.id, role: owner.role };
  const request = httpSession();
  await signIn(request, owner.email, process.env.SEED_ADMIN_PASSWORD);
  checks.push('Credentials login, CSRF and session verified through HTTP');
  const list = await request('/clients');
  assert.equal(list.status, 200); assert((await list.text()).includes('新建客户'));
  const marker = `合成HTTP验收-${randomUUID()}`;
  const client = await db.client.create({ data: { name: marker, type: 'INDIVIDUAL', cooperationStatus: 'POTENTIAL', tags: [], ownerUserId: owner.id } });
  clientId = client.id;
  const payload = extra => ({ clientId, requestKey: randomUUID(), channel: 'PHONE', content: '合成验收：确认材料清单', occurredAt: new Date().toISOString(), ...extra });
  await saveClientActivity(db, user, payload({ nextFollowUp: { title: '合成验收：核对合同材料', dueAt: new Date(Date.now() + 86400000).toISOString() } }));
  const detail = await request(`/clients/${clientId}`);
  assert.equal(detail.status, 200);
  const detailText = await detail.text();
  assert(detailText.includes(marker)); assert(detailText.includes('确认材料清单')); assert(detailText.includes('核对合同材料'));
  checks.push('Unassociated owned client and new activity/follow-up render in authenticated customer page');
  const task = await db.clientFollowUp.findFirstOrThrow({ where: { clientId, status: 'OPEN' } });
  await saveClientActivity(db, user, payload({ followUpId: task.id, content: '合成验收：材料已齐备', nextFollowUp: { title: '合成验收：讨论办理方案', dueAt: new Date(Date.now() + 172800000).toISOString() } }));
  const refreshed = await request(`/clients/${clientId}`).then(r => r.text());
  assert(refreshed.includes('材料已齐备')); assert(refreshed.includes('已完成')); assert(refreshed.includes('讨论办理方案'));
  checks.push('Atomic completion and next follow-up visible in refreshed server-rendered page');
  const password = randomBytes(24).toString('base64url');
  const other = await db.user.create({ data: { name: '合成HTTP隔离用户', email: `${randomUUID()}@example.invalid`, passwordHash: await bcrypt.hash(password, 12), role: 'LAWYER' } });
  otherId = other.id;
  const otherRequest = httpSession();
  await signIn(otherRequest, other.email, password);
  const blocked = await otherRequest(`/clients/${clientId}`).then(r => r.text());
  assert(!blocked.includes(marker)); assert(!blocked.includes('材料已齐备'));
  const anonymous = await fetch(`${base}/clients/${clientId}`, { redirect: 'manual' });
  assert([302, 303, 307, 308].includes(anonymous.status));
  checks.push('Unrelated account receives no customer content; anonymous request redirects to login');
  const pushes = await Promise.all([runWeeklyReportPush(owner.id), runWeeklyReportPush(null)]);
  for (const push of pushes) assert.deepEqual(push.failed, [], 'Weekly push failed in the real database');
  assert.equal(await db.notification.count({ where: { userId: otherId, refType: 'WeeklyReport', refId: pushes[0].weekLabel } }), 1, 'Concurrent manual/cron calls must persist exactly one weekly notification');
  checks.push('Concurrent manual and cron weekly pushes persist exactly one notification per recipient/week in PostgreSQL');
  console.log(JSON.stringify({ httpSmoke: 'passed', checks, browserVisualQA: 'not performed by this script' }, null, 2));
} finally {
  if (clientId) await db.client.update({ where: { id: clientId }, data: { deletedAt: new Date() } });
  if (otherId) await db.user.update({ where: { id: otherId }, data: { active: false } });
  await db.$disconnect();
  await appDb.$disconnect();
}
