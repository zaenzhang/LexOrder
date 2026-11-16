import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const work = await mkdtemp(path.join(tmpdir(), 'lexorder-personal-m1-'));
const workspace = path.join(work, '含 空格的工作区');
const readyFile = path.join(work, 'ready.json');
let processHandle;
const checks = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
function launch(directory = workspace, ready = readyFile) {
  const child = spawn(process.execPath, [path.join(here, 'personal-runtime.mjs')], { cwd: here,
    env: { ...process.env, M1_WORKSPACE: directory, M1_READY_FILE: ready, M1_PORT: '0', M1_ACCEPTANCE: '1', M1_SAMPLE_DIR: '', M1_TESSDATA_DIR: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  return { child, exit, output: () => output };
}
async function start() {
  processHandle = launch();
  for (let i = 0; i < 480; i++) {
    if (processHandle.child.exitCode !== null) throw new Error(processHandle.output());
    try { return JSON.parse(await readFile(readyFile, 'utf8')); } catch { /* not ready */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('M1 ready timeout');
}
async function stop() {
  if (!processHandle) return;
  processHandle.child.kill('SIGTERM');
  let timer;
  const result = await Promise.race([processHandle.exit, new Promise(resolve => { timer = setTimeout(() => resolve(null), 15_000); })]);
  clearTimeout(timer);
  if (!result) { processHandle.child.kill('SIGKILL'); await processHandle.exit; throw new Error('Owner failed to stop cleanly'); }
  assert.equal(result.code, 0, processHandle.output()); processHandle = undefined;
  await assert.rejects(access(path.join(workspace, '.owner')));
}
async function pageRequest(ready, suffix = '/') {
  return fetch(ready.origin + suffix, { redirect: 'manual', headers: { Cookie: 'lexorder_local_channel=' + ready.token } });
}
async function verifyBusiness() {
  const resultPath = path.join(work, 'business.json');
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(here, 'verify-shared-business.mjs')], {
    cwd: path.resolve(here, '../..'), env: { ...process.env, M1_WORKSPACE: workspace, M1_ACCEPTANCE: '1', M1_BUSINESS_RESULT: resultPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, output);
  return JSON.parse(await readFile(resultPath, 'utf8'));
}
try {
  let ready = await start();
  const opened = await fetch(ready.openUrl, { redirect: 'manual' });
  assert.equal(opened.status, 303);
  assert.match(opened.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(opened.headers.get('set-cookie'), /SameSite=Strict/i);
  assert.equal(opened.headers.get('location'), ready.origin + '/');
  const page = await pageRequest(ready);
  assert.equal(page.status, 200);
  const html = await page.text();
  for (const label of ['工作台', '案件', '客户', '财务', '日程']) assert.ok(html.includes(label), label + ' original navigation is present');
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /载入诉讼样本/);
  const resources = [...html.matchAll(/(?:src|href)="([^\"]*\/_next\/static\/[^\"]+)"/g)].map(match => match[1]);
  assert.ok(resources.length > 0);
  for (const resource of new Set(resources)) assert.equal((await fetch(new URL(resource.replaceAll('&amp;', '&'), ready.origin))).status, 200);
  pass('bootstrap_private_cookie_and_original_shared_application_html_assets');
  const oldLogin = await pageRequest(ready, '/login');
  assert.equal(oldLogin.status, 307); assert.equal(oldLogin.headers.get('location'), ready.origin + '/');
  for (const route of ['/api/auth/session', '/admin/users', '/admin/roles', '/admin/teams', '/admin/approval-permissions']) {
    assert.equal((await pageRequest(ready, route)).status, 404, route);
  }
  assert.equal((await fetch(ready.origin + '/')).status, 403);
  assert.equal((await fetch(ready.origin + '/', { method: 'POST', headers: { Cookie: 'lexorder_local_channel=' + ready.token }, body: '{}' })).status, 403);
  assert.equal((await fetch(ready.origin + '/', { headers: { Cookie: 'lexorder_local_channel=' + ready.token, Origin: 'https://untrusted.invalid' } })).status, 403);
  pass('no_account_routes_and_local_channel_cross_origin_rejection');
  for (const route of ['/matters', '/intakes', '/clients', '/finance', '/finance/reconciliation', '/reports', '/approvals', '/schedule', '/contacts', '/settings/profile',
    '/admin', '/admin/ai', '/admin/templates', '/admin/document-templates', '/admin/archive-policy', '/admin/reminders', '/admin/import', '/admin/audit']) {
    const response = await pageRequest(ready, route);
    assert.equal(response.status, 200, route + ' remains available in the shared application');
  }
  pass('shared_business_navigation_profile_and_configuration_pages');
  assert.equal((await pageRequest(ready, '/api/imports/matters/template')).status, 200);
  assert.equal((await pageRequest(ready, '/api/reports/export')).status, 200);
  pass('shared_template_and_report_downloads_without_nextauth');
  const duplicate = launch(workspace, path.join(work, 'duplicate.json'));
  assert.notEqual((await duplicate.exit).code, 0); assert.match(duplicate.output(), /WORKSPACE_BUSY/);
  pass('second_workspace_owner_rejected');
  const manifest = await readFile(path.join(workspace, 'workspace.json'), 'utf8');
  const storageKey = await readFile(path.join(workspace, 'storage-key'), 'utf8');
  await stop();
  const business = await verifyBusiness();
  pass('real_shared_business_pending_self_confirmation_idempotency_decimal_and_guard');
  ready = await start();
  assert.equal(await readFile(path.join(workspace, 'workspace.json'), 'utf8'), manifest);
  assert.equal(await readFile(path.join(workspace, 'storage-key'), 'utf8'), storageKey);
  const matterPage = await pageRequest(ready, '/matters/' + business.matterId);
  assert.equal(matterPage.status, 200);
  assert.ok((await matterPage.text()).includes('M1 合成业务连续性验证'));
  const original = await pageRequest(ready, '/api/documents/' + business.documentId + '/download');
  assert.equal(original.status, 200);
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex'), business.originalSha256);
  pass('normal_close_reopen_preserves_actor_money_encryption_key_and_original_download');
  await stop();
  const changed = JSON.parse(manifest); changed.actorId = 'wrong-actor';
  await writeFile(path.join(workspace, 'workspace.json'), JSON.stringify(changed));
  const mismatch = launch(); assert.notEqual((await mismatch.exit).code, 0); assert.match(mismatch.output(), /WORKSPACE_MISMATCH/);
  pass('manifest_database_identity_mismatch_rejected');
  await writeFile(path.join(workspace, 'workspace.json'), manifest);
  await rm(path.join(workspace, 'storage-key'));
  const missingKey = launch(); assert.notEqual((await missingKey.exit).code, 0); assert.match(missingKey.output(), /WORKSPACE_KEY_MISSING/);
  assert.equal(await readFile(path.join(workspace, 'workspace.json'), 'utf8'), manifest);
  await writeFile(path.join(workspace, 'storage-key'), storageKey, { mode: 0o600 });
  pass('missing_storage_key_does_not_generate_a_replacement');
  const incomplete = path.join(work, 'incomplete'); await mkdir(incomplete, { mode: 0o700 }); await mkdir(path.join(incomplete, 'data'));
  const broken = launch(incomplete, path.join(work, 'broken.json'));
  assert.notEqual((await broken.exit).code, 0); assert.match(broken.output(), /WORKSPACE_INCOMPLETE/);
  pass('incomplete_workspace_not_reinitialized');
  const interruptedDir = path.join(work, 'interrupted'); const interrupted = launch(interruptedDir, path.join(work, 'interrupted.json'));
  for (let i = 0; i < 40; i++) { try { await access(path.join(interruptedDir, '.owner')); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
  interrupted.child.kill('SIGTERM');
  let interruptTimer;
  const interruptedExit = await Promise.race([interrupted.exit, new Promise(resolve => { interruptTimer = setTimeout(() => resolve(null), 15_000); })]);
  clearTimeout(interruptTimer);
  if (!interruptedExit) { interrupted.child.kill('SIGKILL'); await interrupted.exit; throw new Error('Initialization stop hung'); }
  await assert.rejects(access(path.join(interruptedDir, '.owner')));
  pass('shutdown_during_initialization_releases_owner_without_orphan');
  console.log(JSON.stringify({ status: 'PASS_WITH_LIMITS', checks: checks.length, runtime: 'NEXT_STANDALONE', platform: process.platform + '/' + process.arch,
    windows: 'NOT_TESTED', scope: 'shared LawLink app with Personal operator; selected real services and HTTP paths; not Windows or full release acceptance' }));
} finally { await stop(); await rm(work, { recursive: true, force: true }); }
