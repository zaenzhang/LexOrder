/**
 * Migration-only synthetic fixture, not a claim of browser or professional acceptance.
 * Run with WORKBENCH_TEST_DATABASE_URL pointing to the authorized isolated PostgreSQL.
 * Creates two uniquely named databases, applies the exact preceding migration chain,
 * and leaves both databases available for inspection. Never touches the input database.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(resolve(repo, 'package.json'));
const { Client } = require('pg');
const rawUrl = process.env.WORKBENCH_TEST_DATABASE_URL;
assert(rawUrl, 'WORKBENCH_TEST_DATABASE_URL is required');
const baseUrl = new URL(rawUrl);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname), 'Use loopback PostgreSQL only');
assert(baseUrl.pathname.endsWith('_test'), 'The input must identify an isolated _test database');
const migrationName = '20261117122000_research_issue_snapshot';
const migrationRoot = resolve(repo, 'prisma/migrations');
const directories = (await readdir(migrationRoot, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort();
assert(directories.includes(migrationName));
const preceding = directories.filter(name => name < migrationName);
assert.equal(preceding.length, 16, 'Review the migration baseline if the preceding chain changes');
const upgradeSql = await readFile(resolve(migrationRoot, migrationName, 'migration.sql'), 'utf8');
const token = randomBytes(6).toString('hex');
const databaseNames = {
  valid: `lexorder_issue_upgrade_${token}_valid_test`,
  invalid: `lexorder_issue_upgrade_${token}_invalid_test`,
};
const admin = new Client({ connectionString: new URL('/postgres', baseUrl).href });
await admin.connect();
const connections = [];
const fixtureId = () => `c${randomBytes(12).toString('hex')}`;

async function createDatabase(name) {
  assert(/^lexorder_issue_upgrade_[a-f0-9]+_(valid|invalid)_test$/.test(name));
  await admin.query(`CREATE DATABASE "${name}"`);
  const db = new Client({ connectionString: new URL(`/${name}`, baseUrl).href });
  await db.connect(); connections.push(db);
  await db.query("SET TIME ZONE 'UTC'");
  for (const name of preceding) await db.query(await readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8'));
  return db;
}

async function insertResearch(db, { id, matterId, issueId, revisionId, authorId, requestKey, createdAt, checked = false }) {
  await db.query(`INSERT INTO "ResearchRevision" (
    id, "matterId", "seriesId", version, "issueId", "issueRevisionId", question, purpose, jurisdiction,
    "researchedAt", scope, "queryLog", rule, exceptions, "supportingAnalysis", "opposingAnalysis", conclusion,
    unresolved, "nextSteps", "authorId", "requestKey", "requestHash", "createdAt", "checkedAt", "checkedById", "checkNote"
  ) VALUES ($1,$2,$3,1,$4,$5,'合成旧研究问题','仅迁移夹具','合成法域',$6,'迁移范围','[]','旧规则','旧例外',
    '支持资料','反向资料','待专业核对的旧结论','未知项','后续核对',$7,$8,'synthetic-upgrade-fixture',$6,
    $9,$10,$11)`, [id, matterId, randomUUID(), issueId, revisionId, createdAt, authorId, requestKey,
      checked ? '2026-05-03T03:04:05.234Z' : null, checked ? authorId : null, checked ? '合成旧核对记录' : null]);
}

async function seedOldState(db, corrupt = false) {
  const authorId = fixtureId(), confirmerId = fixtureId(), matterId = fixtureId(), issueId = fixtureId(), otherIssueId = fixtureId();
  const oldDocumentId = fixtureId(), currentDocumentId = fixtureId(), oldSourceId = fixtureId(), currentSourceId = fixtureId();
  const revisionId = fixtureId(), researchId = fixtureId(), unlinkedResearchId = fixtureId();
  const oldConfirmedAt = '2026-05-01T01:02:03.123Z', createdAt = '2026-05-03T02:03:04.123Z';
  for (const [id, name] of [[authorId, '合成旧作者'], [confirmerId, '合成旧核对人']]) {
    await db.query(`INSERT INTO "User" (id,name,email,"passwordHash",role,"updatedAt") VALUES ($1,$2,$3,'disabled-test-only','LAWYER',NOW())`, [id, name, `${id}@example.invalid`]);
  }
  await db.query(`INSERT INTO "Matter" (id,"internalCode",title,"ownerId","updatedAt") VALUES ($1,$2,'合成迁移事项',$3,NOW())`, [matterId, `SYNTHETIC-UPGRADE-${matterId}`, authorId]);
  for (const [id, name, sha] of [[oldDocumentId, '合成旧来源', 'a'.repeat(64)], [currentDocumentId, '合成现来源', 'b'.repeat(64)]]) {
    await db.query(`INSERT INTO "Document" (id,"matterId",name,path,"uploadedById","updatedAt","familyId",sha256) VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7)`, [id, matterId, name, `synthetic-migration/${id}`, authorId, randomUUID(), sha]);
  }
  // The fixture models an existing revision saved on edit, followed by changed current content.
  await db.query(`INSERT INTO "EvidenceItem" (id,"matterId",title,content,kind,"createdById",revision,"confirmedById","confirmedAt","eventDatePrecision","eventDateStart")
    VALUES ($1,$2,'当前修订已改变','当前正文不同于旧历史','ISSUE',$3,2,$3,'2026-05-04T04:05:06.345Z','EXACT','2026-04-20')`, [issueId, matterId, authorId]);
  await db.query(`INSERT INTO "EvidenceItem" (id,"matterId",title,content,kind,"createdById") VALUES ($1,$2,'另一个争点','只用于不一致旧绑定夹具','ISSUE',$3)`, [otherIssueId, matterId, authorId]);
  const sourceSnapshot = [{ id: oldSourceId, documentId: oldDocumentId, documentSha256: 'a'.repeat(64), relation: 'CONTEXT', location: { kind: 'PAGE', page: 2 }, parseRunId: null, anchorId: null, legacy: false }];
  await db.query(`INSERT INTO "EvidenceSourceLink" (id,"evidenceItemId","documentId","documentSha256",relation,location,"locationKey","createdById","removedById","removedAt")
    VALUES ($1,$2,$3,$4,'CONTEXT',$5,'PAGE:2',$6,$6,'2026-05-02T02:03:04.123Z')`, [oldSourceId, issueId, oldDocumentId, 'a'.repeat(64), JSON.stringify(sourceSnapshot[0].location), authorId]);
  await db.query(`INSERT INTO "EvidenceSourceLink" (id,"evidenceItemId","documentId","documentSha256",relation,location,"locationKey","createdById")
    VALUES ($1,$2,$3,$4,'REBUTS',$5,'PAGE:1',$6)`, [currentSourceId, issueId, currentDocumentId, 'b'.repeat(64), JSON.stringify({ kind: 'PAGE', page: 1 }), authorId]);
  await db.query(`INSERT INTO "EvidenceItemRevision" (id,"evidenceItemId",revision,title,content,kind,"editedById","createdAt","sourceSnapshot","confirmedById","confirmedAt","eventDatePrecision","eventDateStart","eventDateEnd","eventDateText")
    VALUES ($1,$2,1,'真实旧修订标题','真实旧修订正文','ISSUE',$3,'2026-05-02T02:03:04.123Z',$4,$5,$6,'RANGE','2019-06-01','2019-06-03','旧材料记载的范围')`, [revisionId, issueId, authorId, JSON.stringify(sourceSnapshot), confirmerId, oldConfirmedAt]);
  await insertResearch(db, { id: researchId, matterId, issueId, revisionId, authorId, requestKey: randomUUID(), createdAt, checked: true });
  await insertResearch(db, { id: unlinkedResearchId, matterId, issueId: null, revisionId: null, authorId, requestKey: randomUUID(), createdAt });
  if (corrupt) await insertResearch(db, { id: fixtureId(), matterId, issueId: otherIssueId, revisionId, authorId, requestKey: randomUUID(), createdAt });
  return { authorId, matterId, issueId, revisionId, researchId, unlinkedResearchId, expected: {
    evidenceItemId: issueId, matterId, revision: 1, revisionId, title: '真实旧修订标题', content: '真实旧修订正文', kind: 'ISSUE',
    eventDate: { precision: 'RANGE', start: '2019-06-01', end: '2019-06-03', text: '旧材料记载的范围' }, sourceSnapshot,
    confirmedById: confirmerId, confirmedAt: oldConfirmedAt, capturedAt: createdAt, capturedById: authorId,
  } };
}

async function readState(db) {
  return (await db.query(`SELECT jsonb_build_object(
    'research', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM "ResearchRevision" r),
    'revisions', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM "EvidenceItemRevision" r),
    'current', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM "EvidenceItem" r),
    'sources', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM "EvidenceSourceLink" r)) AS state`)).rows[0].state;
}
async function triggerState(db) {
  return (await db.query(`SELECT tgenabled FROM pg_trigger WHERE tgrelid='"ResearchRevision"'::regclass AND tgname='research_revision_fixed'`)).rows[0].tgenabled;
}

try {
  const valid = await createDatabase(databaseNames.valid);
  const fixture = await seedOldState(valid);
  const before = await readState(valid);
  await valid.query(upgradeSql);
  const after = await readState(valid);
  const research = after.research.find(row => row.id === fixture.researchId);
  assert.deepEqual(research.issueSnapshot, fixture.expected, 'Old source/confirmation/date input must be copied exactly');
  assert.equal(after.research.find(row => row.id === fixture.unlinkedResearchId).issueSnapshot, null);
  assert.deepEqual(after.research.map(row => { const original = { ...row }; delete original.issueSnapshot; return original; }), before.research, 'Only the new snapshot column may change');
  for (const key of ['revisions', 'current', 'sources']) assert.deepEqual(after[key], before[key], `${key} must remain unchanged`);
  assert.equal(await triggerState(valid), 'O');
  await assert.rejects(valid.query(`UPDATE "ResearchRevision" SET "issueSnapshot"='{}' WHERE id=$1`, [fixture.researchId]), /immutable/);
  assert.deepEqual((await readState(valid)).research, after.research);

  const invalid = await createDatabase(databaseNames.invalid);
  const invalidFixture = await seedOldState(invalid, true);
  const invalidBefore = await readState(invalid);
  let rejection;
  try { await invalid.query(upgradeSql); } catch (error) { rejection = error; }
  assert(rejection, 'An inconsistent old binding must reject the migration');
  assert.equal(rejection.code, '23514', 'The expected failure is the explicit snapshot CHECK');
  assert.equal(rejection.constraint, 'ResearchRevision_issue_snapshot_check');
  await invalid.query('ROLLBACK');
  assert.equal((await invalid.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ResearchRevision' AND column_name='issueSnapshot'`)).rowCount, 0, 'The added column must roll back');
  assert.deepEqual(await readState(invalid), invalidBefore, 'Failed upgrade must not alter old research or evidence');
  assert.equal(await triggerState(invalid), 'O', 'Disabled immutable trigger must roll back to enabled');
  await assert.rejects(invalid.query(`UPDATE "ResearchRevision" SET question='覆盖尝试' WHERE id=$1`, [invalidFixture.researchId]), /immutable/);
  const report = { scope: 'synthetic migration-only fixture; not browser or professional acceptance', passed: true,
    precedingMigrations: preceding.length, migration: migrationName, databases: databaseNames,
    checks: ['exact historical input copied despite different current evidence', 'old research columns and evidence records unchanged', 'unlinked research remains unlinked',
      'immutable trigger enabled and enforced after success', 'inconsistent old binding rejected', 'failed migration rolled back column, copied rows and trigger state'],
    finishedAt: new Date().toISOString() };
  if (process.env.LEXORDER_MIGRATION_REPORT) await writeFile(process.env.LEXORDER_MIGRATION_REPORT, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + '\n');
} finally {
  for (const db of connections) await db.end();
  await admin.end();
}
