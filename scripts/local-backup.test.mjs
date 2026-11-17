// CLI boundary tests: PostgreSQL executables are stubs. Archive, encryption,
// checksums, environment loading and filesystem operations are real.
// These tests do not prove a real database restore or M4 release acceptance.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tar = require('tar-stream');
const candidate = path.dirname(fileURLToPath(import.meta.url));
const workspace = await mkdtemp(path.join(os.tmpdir(), 'lexorder-backup-cli-'));
after(() => rm(workspace, { recursive: true, force: true }));
let counter = 0;

async function fixture() {
  const root = path.join(workspace, String(++counter));
  const bin = path.join(root, 'bin'), storage = path.join(root, 'source-originals');
  await mkdir(bin, { recursive: true });
  await mkdir(path.join(storage, 'matter'), { recursive: true });
  await writeFile(path.join(storage, 'matter', 'original.bin'), Buffer.from('合成原件\0固定字节'));
  const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CLI_LOG, JSON.stringify({name,args}) + '\\n');
if(args.includes('--version')) {console.log(name+' synthetic-stub'); process.exit(0);}
if(name==='pg_dump') fs.writeFileSync(args[args.indexOf('--file')+1], 'PGDMP synthetic; not a PostgreSQL archive');
if(name==='psql') {
  console.log(process.env.CLI_NONEMPTY_DB==='1'?'t':'f');
  if(process.env.CLI_REPLACE_SOURCE_DUMP) fs.writeFileSync(process.env.CLI_REPLACE_SOURCE_DUMP,'replaced after validation');
}
if(name==='pg_restore' && (args.includes('--list') || args.includes('--single-transaction'))) {
  if(!fs.readFileSync(args[args.length-1],'utf8').startsWith('PGDMP')) process.exit(2);
  if(args.includes('--list')) console.log('; synthetic archive list');
}
if(name==='pg_restore' && args.includes('--single-transaction')) {
  if(process.env.CLI_FAIL_RESTORE==='1') {console.error('synthetic restore failure');process.exit(3);}
  if(process.env.CLI_STORAGE_RACE==='1') {fs.mkdirSync(process.env.APP_STORAGE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.APP_STORAGE_DIR,'late-write'),'synthetic');}
}
`;
  for (const name of ['pg_dump', 'pg_restore', 'psql']) { const file = path.join(bin, name); await writeFile(file, stub); await chmod(file, 0o700); }
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, DATABASE_URL: 'postgresql://synthetic:synthetic%40password@127.0.0.1:55499/synthetic_source?schema=public',
    APP_STORAGE_DIR: storage, STORAGE_PROVIDER: 'local', STORAGE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    NEXTAUTH_SECRET: 'synthetic-auth-secret', NEXTAUTH_URL: 'http://127.0.0.1:3999',
    BACKUP_ALLOW_PLAINTEXT: 'true', BACKUP_PASSPHRASE: '', CLI_LOG: path.join(root, 'calls.jsonl')
  };
  return { root, storage, env, target: path.join(root, 'restored-under-new-name') };
}

function run(f, action, directory, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(candidate, 'local-backup.mjs'), action, directory], {
      cwd: f.root, env: { ...f.env, ...overrides }, stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', data => { output += String(data); });
    child.stderr.on('data', data => { output += String(data); });
    child.once('error', reject);
    child.once('close', code => resolve({ code, output }));
    child.stdin.end('YES\n');
  });
}
async function makeBackup(f, overrides = {}) {
  const base = path.join(f.root, 'backups');
  const result = await run(f, 'backup', base, overrides);
  assert.equal(result.code, 0, result.output);
  const directories = (await readdir(base)).filter(name => /^\d{8}_\d{6}$/.test(name));
  assert.equal(directories.length, 1);
  return path.join(base, directories[0]);
}
async function calls(f) {
  try { return (await readFile(f.env.CLI_LOG, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function mutations(f) { return (await calls(f)).filter(call => call.name === 'pg_restore' && call.args.includes('--single-transaction')); }
async function restore(f, backup, overrides = {}) {
  return run(f, 'restore', backup, { DATABASE_URL: f.env.DATABASE_URL.replace('synthetic_source', 'synthetic_empty_target'), APP_STORAGE_DIR: f.target, ...overrides });
}
async function replaceArchive(backup, entries) {
  const archive = path.join(backup, 'storage.tar.gz');
  const pack = tar.pack();
  const finished = pipeline(pack, createGzip(), createWriteStream(archive));
  for (const entry of entries) await new Promise((resolve, reject) => pack.entry(entry.header, entry.body ?? '', error => error ? reject(error) : resolve()));
  pack.finalize(); await finished;
  const manifestPath = path.join(backup, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const bytes = await readFile(archive);
  manifest.files[1].bytes = bytes.length; manifest.files[1].sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(manifestPath, JSON.stringify(manifest));
}

test('plain archive restores bytes into the precise new target; DB call requires one transaction', async () => {
  const f = await fixture(), backup = await makeBackup(f);
  const result = await restore(f, backup);
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(await readFile(path.join(f.target, 'matter', 'original.bin')), await readFile(path.join(f.storage, 'matter', 'original.bin')));
  const mutation = (await mutations(f))[0];
  assert.ok(mutation.args.includes('--exit-on-error'));
  assert.ok(!mutation.args.includes('--clean'));
  assert.ok(mutation.args.includes('--no-owner'));
  assert.ok(mutation.args.find(value => value.includes('synthetic_empty_target')));
  assert.ok(mutation.args.every(value => !value.includes('synthetic%40password')));
});

test('real encryption roundtrip uses the supplied passphrase and preserves exact file bytes', async () => {
  const f = await fixture(), pass = 'synthetic-independent-backup-passphrase';
  const backup = await makeBackup(f, { BACKUP_PASSPHRASE: pass });
  const manifest = JSON.parse(await readFile(path.join(backup, 'manifest.json'), 'utf8'));
  assert.equal(manifest.encrypted, true);
  assert.deepEqual(manifest.files.map(file => file.name), ['database.dump.enc', 'storage.tar.gz.enc']);
  assert.equal(manifest.recovery.privateConfigIncluded, false);
  assert.ok(!(await readFile(path.join(backup, 'manifest.json'), 'utf8')).includes(f.env.STORAGE_ENCRYPTION_KEY));
  const result = await restore(f, backup, { BACKUP_PASSPHRASE: pass });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(await readFile(path.join(f.target, 'matter', 'original.bin')), await readFile(path.join(f.storage, 'matter', 'original.bin')));
});

test('verified plain components are pinned in private staging before confirmation, even if source changes', async () => {
  const f = await fixture(), backup = await makeBackup(f);
  const sourceDump = path.join(backup, 'database.dump');
  const result = await restore(f, backup, { CLI_REPLACE_SOURCE_DUMP: sourceDump });
  assert.equal(result.code, 0, result.output);
  assert.equal(await readFile(sourceDump, 'utf8'), 'replaced after validation');
  const mutation = (await mutations(f))[0];
  assert.notEqual(mutation.args.at(-1), sourceDump);
  assert.ok(mutation.args.at(-1).includes('.lexorder-restore-'));
  assert.deepEqual(await readFile(path.join(f.target, 'matter', 'original.bin')), await readFile(path.join(f.storage, 'matter', 'original.bin')));
});

test('explicit target environment wins over local .env and .env is not executed as shell', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, '.env'), 'DATABASE_URL="postgresql://wrong:wrong@127.0.0.1:1/wrong_target"\nAPP_STORAGE_DIR="/does-not-exist"\nNOT_SHELL="$(touch should-not-exist)"\n');
  const backup = await makeBackup(f);
  assert.equal((await restore(f, backup)).code, 0);
  assert.ok((await calls(f)).every(call => call.args.every(arg => !arg.includes('wrong_target'))));
  assert.ok(!(await readdir(f.root)).includes('should-not-exist'));
});

test('missing original directory fails before dump and cannot publish a success backup', async () => {
  const f = await fixture();
  const result = await run(f, 'backup', path.join(f.root, 'backups'), { APP_STORAGE_DIR: path.join(f.root, 'missing') });
  assert.equal(result.code, 1); assert.match(result.output, /不存在/);
  assert.equal((await calls(f)).length, 0);
});

test('missing or changed backup components fail before any restore mutation', async t => {
  for (const kind of ['missing', 'changed']) await t.test(kind, async () => {
    const f = await fixture(), backup = await makeBackup(f);
    if (kind === 'missing') await rm(path.join(backup, 'database.dump'));
    else await writeFile(path.join(backup, 'storage.tar.gz'), 'changed bytes');
    const result = await restore(f, backup);
    assert.equal(result.code, 1); assert.equal((await mutations(f)).length, 0);
    assert.ok(!result.output.includes('数据库及本地原件已恢复'));
  });
});

test('wrong master key, missing private config and old manifest are rejected before mutation', async t => {
  for (const kind of ['key', 'config', 'old-format']) await t.test(kind, async () => {
    const f = await fixture(), backup = await makeBackup(f);
    const overrides = kind === 'key' ? { STORAGE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') } : kind === 'config' ? { NEXTAUTH_SECRET: '' } : {};
    if (kind === 'old-format') await writeFile(path.join(backup, 'manifest.json'), JSON.stringify({ encrypted: 'false', files: [] }));
    const result = await restore(f, backup, overrides);
    assert.equal(result.code, 1); assert.equal((await mutations(f)).length, 0);
  });
});

test('wrong or absent backup passphrase never reaches PostgreSQL restore', async t => {
  for (const pass of ['', 'wrong-synthetic-passphrase']) await t.test(pass ? 'wrong' : 'absent', async () => {
    const f = await fixture(), backup = await makeBackup(f, { BACKUP_PASSPHRASE: 'synthetic-correct-passphrase' });
    const result = await restore(f, backup, { BACKUP_PASSPHRASE: pass });
    assert.equal(result.code, 1); assert.equal((await mutations(f)).length, 0);
  });
});

test('parent paths, links and duplicate archive entries cannot be extracted or reach DB mutation', async t => {
  const cases = {
    traversal: [{ header: { name: '../outside', type: 'file' }, body: 'synthetic' }],
    absolute: [{ header: { name: '/outside', type: 'file' }, body: 'synthetic' }],
    symlink: [{ header: { name: 'link', type: 'symlink', linkname: '../outside' } }],
    duplicate: [{ header: { name: 'same', type: 'file' }, body: 'first' }, { header: { name: 'same', type: 'file' }, body: 'second' }]
  };
  for (const [name, entries] of Object.entries(cases)) await t.test(name, async () => {
    const f = await fixture(), backup = await makeBackup(f);
    await replaceArchive(backup, entries);
    const result = await restore(f, backup);
    assert.equal(result.code, 1, result.output); assert.equal((await mutations(f)).length, 0);
    assert.ok(!(await readdir(f.root)).includes('outside'));
  });
});

test('nonempty database, nonempty storage and a symlink target are refused', async t => {
  for (const kind of ['database', 'storage', 'symlink']) await t.test(kind, async () => {
    const f = await fixture(), backup = await makeBackup(f);
    if (kind === 'storage') { await mkdir(f.target); await writeFile(path.join(f.target, 'existing-original'), 'keep'); }
    if (kind === 'symlink') await symlink(f.storage, f.target);
    const result = await restore(f, backup, kind === 'database' ? { CLI_NONEMPTY_DB: '1' } : {});
    assert.equal(result.code, 1); assert.equal((await mutations(f)).length, 0);
  });
});

test('failed PostgreSQL restore does not publish originals or announce success', async () => {
  const f = await fixture(), backup = await makeBackup(f);
  const result = await restore(f, backup, { CLI_FAIL_RESTORE: '1' });
  assert.equal(result.code, 1); assert.equal((await mutations(f)).length, 1);
  assert.ok(!(await readdir(f.root)).includes(path.basename(f.target)));
  assert.ok(!result.output.includes('数据库及本地原件已恢复'));
});

test('a storage publication failure after DB restore is explicit and preserves staged originals', async () => {
  const f = await fixture(), backup = await makeBackup(f);
  const result = await restore(f, backup, { CLI_STORAGE_RACE: '1' });
  assert.equal(result.code, 1); assert.match(result.output, /数据库已恢复但原件未发布/);
  assert.ok(!result.output.includes('数据库及本地原件已恢复'));
  const staged = (await readdir(f.root)).find(name => name.startsWith('.lexorder-restore-'));
  assert.ok(staged);
  assert.deepEqual(await readFile(path.join(f.root, staged, 'originals', 'matter', 'original.bin')), await readFile(path.join(f.storage, 'matter', 'original.bin')));
});

test('S3 cannot be reported as covered by local backup', async () => {
  const f = await fixture();
  const result = await run(f, 'backup', path.join(f.root, 'backups'), { STORAGE_PROVIDER: 's3' });
  assert.equal(result.code, 1); assert.match(result.output, /仅支持 local/); assert.equal((await calls(f)).length, 0);
});
