import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// Inspect a stopped synthetic workspace without starting another parsing worker.
export async function readPublishedBatch(runtime, workspace, matterId, names) {
  await assert.rejects(lstat(path.join(workspace, '.owner')), { code: 'ENOENT' });
  const require = createRequire(path.join(runtime, 'tools/workbench-m1/personal-runtime.mjs'));
  const { PGlite } = require('@electric-sql/pglite');
  const db = await PGlite.create(path.join(workspace, 'data'));
  try {
    await db.exec('BEGIN READ ONLY');
    const result = await db.query(`
      SELECT d.name, d.version, r.state, d.sha256 = r."sourceSha256" AS "sameSource",
             d."textContent" IS NOT NULL AS "publishedText", jsonb_array_length(r.anchors) AS "anchorCount",
             EXTRACT(epoch FROM r."finishedAt") * 1000 AS "finishedMs"
      FROM "Document" d
      LEFT JOIN "DocumentParseRun" r
        ON r."documentId" = d.id AND r.generation = d."parseGeneration"
      WHERE d."matterId" = $1 AND d.name = ANY($2::text[]) AND d."deletedAt" IS NULL
    `, [matterId, names]);
    assert.deepEqual(result.rows.map(row => row.name).sort(), [...names].sort(), 'The fixed batch documents must match the selected files');
    for (const row of result.rows) {
      assert.equal(row.version, 1);
      assert.equal(row.state, 'READY', row.name + ' has not published parsed text');
      assert(row.sameSource && row.publishedText && row.anchorCount > 0 && row.finishedMs, row.name + ' has no published anchor for its fixed version');
    }
    const finished = result.rows.map(row => Number(row.finishedMs));
    return { parseStates: result.rows.map(row => row.state), firstFinishedMs: Math.min(...finished), lastFinishedMs: Math.max(...finished) };
  } finally {
    await db.close();
  }
}
