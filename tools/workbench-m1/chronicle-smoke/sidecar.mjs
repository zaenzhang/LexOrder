import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { PDFDocument } from 'pdf-lib';
import { verifyFolderRelocation } from './sidecar-folder-relocation.mjs';

const [workspace, ...casebookRoots] = process.argv.slice(2);
assert(casebookRoots.length === 0 || casebookRoots.length === 2, 'Pass both casebook roots to verify cross-volume relocation.');
assert(path.isAbsolute(workspace ?? ''), 'Supply a new absolute synthetic workspace path');
const manifest = path.join(workspace, 'workspace.json');
await assert.rejects(readFile(manifest), { code: 'ENOENT' });
const script = process.env.LEXORDER_SMOKE_RUNTIME_ROOT
  ? path.join(process.env.LEXORDER_SMOKE_RUNTIME_ROOT, 'tools/workbench-m1/personal-runtime.mjs')
  : path.resolve(import.meta.dirname, '../personal-runtime.mjs');

function start() {
  const token = randomBytes(32).toString('hex');
  const child = spawn(process.env.LEXORDER_SMOKE_BUN ?? process.execPath, ['--no-env-file', '--no-install', script, '--desktop'], {
    env: { ...process.env, M1_WORKSPACE: workspace, LEXORDER_DESKTOP_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let diagnostic = '';
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-6000); });
  const lines = createInterface({ input: child.stdout });
  let ready;
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, diagnostic }));
  });
  const listening = new Promise(resolve => {
    lines.on('line', line => {
      const match = /^LEXORDER_READY (http:\/\/127\.0\.0\.1:\d+)$/.exec(line);
      if (match) resolve(match[1]);
    });
  });
  const launch = {
    token, exited,
    async url() {
      let timer;
      try {
        ready ??= await Promise.race([
          listening,
          exited.then(exit => { throw new Error(exit.diagnostic || 'Runtime exited early'); }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Sidecar timed out: ' + diagnostic)), 220_000);
          }),
        ]);
        return ready;
      } finally { clearTimeout(timer); }
    },
    close(command) { child.stdin.end(command); },
  };
  child.stdin.on('error', error => {
    if (error.code !== 'EPIPE') throw error;
  });
  return launch;
}

async function request(session, route, { body, token = session.token, status = 200 } = {}) {
  const origin = await session.url();
  const headers = { Origin: origin };
  if (token) headers.Cookie = 'lexorder_local_channel=' + token;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(origin + '/api/personal/' + route, {
    method: body ? 'POST' : 'GET', headers, body: body instanceof FormData ? body : body && JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== status) {
    throw new Error(route + ' returned ' + response.status + ': ' + (await response.text()).slice(0, 350));
  }
  if (status === 403 && !body) assert.equal(response.headers.get("X-Lexorder-Channel"), "required");
  return status === 200 || body ? response.json() : response.body?.cancel();
}

async function finish(session, command) {
  session.close(command);
  const exit = await session.exited;
  assert.equal(exit.code, 0, exit.diagnostic);
}

const first = start();
let reopened;
try {
  const origin = await first.url();
  const page = await fetch(origin + '/practice/today');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<script[^>]+src="\/_chronicle\/assets\//);
  const bundle = html.match(/src="(\/_chronicle\/assets\/[^"]+)"/)?.[1];
  assert(bundle);
  assert.equal((await fetch(origin + bundle)).status, 200);
  await request(first, 'practice?view=today', { token: '', status: 403 });

  const duplicate = start();
  const busy = await duplicate.exited;
  assert.equal(busy.code, 1);
  assert.match(busy.diagnostic, /WORKSPACE_BUSY|WORKSPACE_LOCK_FAILED_OR_BUSY/);

  const title = 'ChronicleSidecar合成案卷';
  const send = body => request(first, 'practice', { body });
  const client = await send({ action: 'create-client', input: { name: title, type: 'COMPANY' } });
  const { id } = await send({
    action: 'create-intake',
    input: { title, category: 'NON_LITIGATION', clientId: client.id, description: 'Sidecar acceptance' },
  });
  await send({ action: 'check-intake', id });
  const { check } = await request(first, 'practice?view=intake&id=' + id);
  await send({ action: 'decide-conflict', id: check.id, conclusion: 'DIFFERENT', note: 'Synthetic fixture checked' });
  await send({ action: 'submit-intake', id });
  const { matterId } = await send({ action: 'convert-intake', id });
  const identity = 'matter-workspace?section=identity&matter=' + matterId;
  assert.equal((await request(first, identity)).title, title);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const upload = new FormData();
  upload.set('file', new File([await pdf.save()], 'desktop-check.pdf', { type: 'application/pdf' }));
  upload.set('matterId', matterId);
  upload.set('name', 'Sidecar acceptance PDF');
  upload.set('category', 'EVIDENCE');
  upload.set('requestKey', randomUUID());
  assert.equal((await request(first, 'matter-workspace', { body: upload })).ok, true);
  const materials = 'matter-workspace?section=materials&matter=' + matterId;
  const { documents } = await request(first, materials);
  assert.equal(documents.length, 1);
  const document = documents[0];
  const uploadFixture = (session, { matterId, name, text, status, requestKey = randomUUID() }) => {
    const body = new FormData();
    body.set('file', new File([text], name, { type: 'text/plain' }));
    body.set('matterId', matterId);
    body.set('name', name);
    body.set('category', 'EVIDENCE');
    body.set('requestKey', requestKey);
    return request(session, 'matter-workspace', { body, status });
  };
  const downloadFixture = async (session, id) => fetch(await session.url() + '/api/documents/' + id + '/download', {
    headers: { Cookie: 'lexorder_local_channel=' + session.token }, signal: AbortSignal.timeout(8000),
  });
  const relocated = casebookRoots.length ? await verifyFolderRelocation({
    roots: casebookRoots, matterId,
    request: (route, options) => request(first, route, options),
    materials: async () => (await request(first, materials)).documents,
    upload: (name, text, status, requestKey) => uploadFixture(first, { matterId, name, text, status, requestKey }),
    download: id => downloadFixture(first, id),
  }) : null;
  const firstWorkspace = await readFile(manifest, 'utf8');
  await finish(first, 'quit\n');
  await assert.rejects(fetch(await first.url(), { signal: AbortSignal.timeout(3000) }));

  reopened = start();
  await request(reopened, identity, { token: first.token, status: 403 });
  assert.equal((await request(reopened, identity)).title, title);
  assert.equal(await readFile(manifest, 'utf8'), firstWorkspace);
  assert((await request(reopened, materials)).documents.some(row => row.id === document.id));
  if (relocated) {
    const state = await request(reopened, 'matter-folder?matter=' + matterId);
    assert.equal(state.available, true);
    assert.equal(path.relative(relocated.moved, state.path), '');
    const found = await downloadFixture(reopened, relocated.originalId);
    assert.equal(found.status, 200);
    assert.deepEqual(Buffer.from(await found.arrayBuffer()), relocated.expected);
    console.log('PASS unavailable directory blocks reads and keeps upload recoverable, rejects wrong marker and corrupt copy, rebinds across volumes, retries once and preserves original on reopen');
  }
  const url = await reopened.url() + '/api/documents/' + document.id + '/download?inline=1';
  assert.equal((await fetch(url, { signal: AbortSignal.timeout(8000) })).status, 403);
  const inline = await fetch(url, { headers: { Cookie: 'lexorder_local_channel=' + reopened.token }, signal: AbortSignal.timeout(8000) });
  assert.equal(inline.status, 200);
  assert.equal(inline.headers.get('content-type'), 'application/pdf');
  assert.match(inline.headers.get('content-disposition'), /^inline;/);
  assert.equal((await PDFDocument.load(await inline.arrayBuffer())).getPageCount(), 1);
  await finish(reopened); // Closing stdin models the Tauri process disappearing.
  await assert.rejects(lstat(path.join(workspace, '.owner')), { code: 'ENOENT' });
  console.log('PASS static UI, authenticated case creation, fixed PDF reopen, duplicate owner rejection, shutdown, case reopen, stale session rejection and owner pipe EOF');
} finally {
  first.close();
  reopened?.close();
  await Promise.all([first.exited, reopened?.exited]);
}
