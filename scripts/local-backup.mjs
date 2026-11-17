#!/usr/bin/env node
// Server local backup format. Restore only into an empty, stopped instance.
import { spawn } from 'node:child_process';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env');
const tar = require('tar-stream');
loadEnvConfig(process.cwd(), false);
process.umask(0o077);

const FORMAT = 'lexorder-local-backup-v1';
const REQUIRED_CONFIG = ['DATABASE_URL', 'APP_STORAGE_DIR', 'STORAGE_ENCRYPTION_KEY', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL'];
const ENCRYPTION = { cipher: 'aes-256-cbc', digest: 'sha256', pbkdf2Iterations: 200000 };
const PARTS = ['database.dump', 'storage.tar.gz'];

function fail(message) { throw new Error(message); }
function below(candidate, parent) { return candidate === parent || candidate.startsWith(parent + path.sep); }
async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function privateOutput(text) {
  let output = String(text);
  for (const name of ['DATABASE_URL', 'STORAGE_ENCRYPTION_KEY', 'NEXTAUTH_SECRET', 'BACKUP_PASSPHRASE']) {
    const value = process.env[name];
    if (value) output = output.split(value).join('[已隐藏]');
  }
  return output.slice(-1800);
}
function command(bin, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + String(chunk)).slice(-16384); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16384); });
    child.once('error', error => reject(new Error(`${bin} 无法执行：${error.code ?? error.message}`)));
    child.once('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${bin} 失败（${code}）：${privateOutput(stderr)}`)));
  });
}

function configuration(restore) {
  if ((process.env.STORAGE_PROVIDER ?? 'local') !== 'local') fail('此备份格式仅支持 local 存储；未备份 S3 对象，不能报告完整恢复。');
  if (!process.env.DATABASE_URL) fail('DATABASE_URL 未设置。');
  const connection = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || connection.pathname.length < 2) fail('DATABASE_URL 必须指向 PostgreSQL 数据库。');
  if (connection.searchParams.has('password') || connection.searchParams.has('sslpassword')) fail('数据库密码须使用 DATABASE_URL 的用户信息部分，不能放入查询参数。');
  const schema = connection.searchParams.get('schema');
  if (schema && schema !== 'public') fail('当前恢复合同只支持应用的 public schema。');
  // These Prisma-only options are not accepted by PostgreSQL command-line tools.
  for (const key of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer']) connection.searchParams.delete(key);
  const password = decodeURIComponent(connection.password);
  connection.password = '';
  const key = process.env.STORAGE_ENCRYPTION_KEY;
  if (!key || Buffer.from(key, 'base64').length !== 32) fail('STORAGE_ENCRYPTION_KEY 必须为原 32 字节主密钥的 base64；密钥须独立保管。');
  for (const name of ['NEXTAUTH_SECRET', 'NEXTAUTH_URL']) if (!process.env[name]) fail(`${name} 未设置；先从独立私有配置副本恢复必要配置。`);
  if (restore && !process.env.APP_STORAGE_DIR) fail('恢复必须显式设置 APP_STORAGE_DIR，指向隔离实例的空原件目录。');
  return {
    dbArgs: ['--no-password', '--dbname', connection.toString()],
    dbEnv: { PGPASSWORD: password },
    database: decodeURIComponent(connection.pathname.slice(1)),
    storage: path.resolve(process.env.APP_STORAGE_DIR || './storage'),
    // Use the exact configuration string: blind indexes also derive from this string.
    keyFingerprint: createHmac('sha256', key).update('lexorder-local-backup-master-key-v1').digest('hex')
  };
}

async function regularFile(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`备份文件必须是普通文件：${path.basename(file)}`);
  return stat;
}
async function digest(file) {
  const hash = createHash('sha256');
  for await (const data of createReadStream(file, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) hash.update(data);
  return hash.digest('hex');
}
async function crypt(input, output, decrypt = false) {
  if (!process.env.BACKUP_PASSPHRASE) fail('加密备份需要原 BACKUP_PASSPHRASE；它不是文件主密钥。');
  await command('openssl', ['enc', ...(decrypt ? ['-d'] : []), '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-md', 'sha256', '-salt', '-in', input, '-out', output, '-pass', 'env:BACKUP_PASSPHRASE']);
}

async function archiveStorage(root, output) {
  const pack = tar.pack();
  const result = pipeline(pack, createGzip(), createWriteStream(output, { flags: 'wx', mode: 0o600 }));
  // Observe pipeline failure immediately, even while the tree is being walked.
  result.catch(error => pack.destroy(error));
  async function add(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (name.includes('\\')) fail('本地原件名称含反斜线，不能形成安全归档。');
      const stat = await lstat(full);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) fail(`原件包含不支持的链接或特殊文件：${name}`);
      if (stat.isDirectory()) {
        await new Promise((resolve, reject) => pack.entry({ name, type: 'directory', mode: 0o700, mtime: stat.mtime }, error => error ? reject(error) : resolve()));
        await add(full, name);
      } else {
        const item = pack.entry({ name, type: 'file', size: stat.size, mode: 0o600, mtime: stat.mtime });
        await pipeline(createReadStream(full, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }), item);
      }
    }
  }
  try { await add(root); pack.finalize(); await result; }
  catch (error) { pack.destroy(error); await result.catch(() => {}); throw error; }
}

async function extractStorage(archive, target) {
  await mkdir(target, { mode: 0o700 });
  const unpack = tar.extract();
  const names = new Set();
  unpack.on('entry', (header, stream, next) => {
    (async () => {
      const name = header.name;
      if (!name || name.includes('\\') || name.includes('\0') || path.posix.isAbsolute(name) || name.split('/').includes('..')) fail('原件归档含不安全路径。');
      const relative = path.posix.normalize(name).replace(/\/$/, '');
      if (names.has(relative)) fail('原件归档含重复成员。');
      names.add(relative);
      if (!['file', 'directory'].includes(header.type)) fail('原件归档含链接或特殊文件。');
      if (relative === '.' && header.type !== 'directory') fail('原件归档根不能是文件。');
      const output = path.join(target, ...relative.split('/'));
      if (!below(output, target)) fail('原件归档路径超出目标。');
      if (header.type === 'directory') {
        await mkdir(output, { recursive: true, mode: 0o700 });
        stream.resume();
      } else {
        await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
        await pipeline(stream, createWriteStream(output, { flags: 'wx', mode: 0o600 }));
      }
    })().then(() => next(), error => unpack.destroy(error));
  });
  await pipeline(createReadStream(archive, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }), createGunzip(), unpack);
}

async function backup(baseDirectory) {
  const config = configuration(false);
  const sourceStat = await lstat(config.storage).catch(error => error.code === 'ENOENT' ? fail('APP_STORAGE_DIR 不存在；不生成缺原件的成功备份。') : Promise.reject(error));
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) fail('APP_STORAGE_DIR 必须是实际本地目录，不能是链接。');
  const storage = await realpath(config.storage);
  const base = path.resolve(baseDirectory || process.env.BACKUP_DIR || './backups');
  await mkdir(base, { recursive: true, mode: 0o700 });
  const resolvedBase = await realpath(base);
  if (below(resolvedBase, storage)) fail('备份输出目录不能位于原件目录中。');
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const output = path.join(resolvedBase, timestamp);
  if (await exists(output)) fail('同一秒已有备份；稍后重试，不覆盖既有备份。');
  await command('pg_dump', ['--version']);
  const encrypted = Boolean(process.env.BACKUP_PASSPHRASE);
  if (encrypted) await command('openssl', ['version']);
  const temporary = await mkdtemp(path.join(resolvedBase, `.${timestamp}-`));
  try {
    await command('pg_dump', [...config.dbArgs, '--format=custom', '--compress=6', '--file', path.join(temporary, PARTS[0])], config.dbEnv);
    await archiveStorage(storage, path.join(temporary, PARTS[1]));
    const files = [];
    for (const plainName of PARTS) {
      const name = plainName + (encrypted ? '.enc' : '');
      if (encrypted) { await crypt(path.join(temporary, plainName), path.join(temporary, name)); await rm(path.join(temporary, plainName)); }
      const file = path.join(temporary, name);
      const stat = await regularFile(file);
      files.push({ name, bytes: stat.size, sha256: await digest(file) });
    }
    const manifest = {
      format: FORMAT, createdAt: new Date().toISOString(), database: config.database,
      storageProvider: 'local', encrypted, encryption: encrypted ? ENCRYPTION : null,
      storageKeyFingerprint: config.keyFingerprint, files,
      recovery: { requiredConfig: REQUIRED_CONFIG, privateConfigIncluded: false, requiresStoppedWrites: true }
    };
    await writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, output);
    console.log(`备份产物已生成：${output}`);
    if (!encrypted && process.env.BACKUP_ALLOW_PLAINTEXT !== 'true') console.log('未设置 BACKUP_PASSPHRASE：产物未整体加密，须按私有备份保管。');
    console.log('一致性要求：源实例停止相关写入及 worker；另存原主密钥和必要私有配置，隔离恢复验证后才能确认可恢复。');
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
}

async function readManifest(backupPath, config) {
  const file = path.join(backupPath, 'manifest.json');
  const stat = await regularFile(file);
  if (stat.size > 65536) fail('备份清单过大。');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  if (manifest.format !== FORMAT || manifest.storageProvider !== 'local' || typeof manifest.encrypted !== 'boolean') fail('不是现行 local 备份格式；不猜测或转换旧备份。');
  if (JSON.stringify(manifest.encryption) !== JSON.stringify(manifest.encrypted ? ENCRYPTION : null)) fail('备份加密参数与现行格式不符。');
  if (manifest.recovery?.privateConfigIncluded !== false || manifest.recovery?.requiresStoppedWrites !== true || JSON.stringify(manifest.recovery?.requiredConfig) !== JSON.stringify(REQUIRED_CONFIG)) fail('备份缺少独立配置与停机恢复要求。');
  if (typeof manifest.storageKeyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.storageKeyFingerprint) || !timingSafeEqual(Buffer.from(manifest.storageKeyFingerprint, 'hex'), Buffer.from(config.keyFingerprint, 'hex'))) fail('STORAGE_ENCRYPTION_KEY 与备份不匹配；未修改目标。');
  if (!Array.isArray(manifest.files) || manifest.files.length !== PARTS.length) fail('备份清单必须同时包含数据库与本地原件。');
  for (let i = 0; i < PARTS.length; i++) {
    const expected = PARTS[i] + (manifest.encrypted ? '.enc' : '');
    const item = manifest.files[i];
    if (!item || item.name !== expected || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) fail('备份清单文件信息不完整。');
    const actual = path.join(backupPath, expected);
    const actualStat = await regularFile(actual);
    if (actualStat.size !== item.bytes) fail(`备份文件大小与清单不符：${expected}；未修改目标。`);
  }
  return manifest;
}

/** Pin the exact verified bytes before a human confirmation can leave the source
 * directory unattended. Each component is hashed once, while copying it. */
async function stageVerifiedFile(backupPath, temporary, item) {
  const staged = path.join(temporary, item.name);
  const hash = createHash('sha256');
  let bytes = 0;
  await pipeline(
    createReadStream(path.join(backupPath, item.name), { flags: constants.O_RDONLY | constants.O_NOFOLLOW }),
    async function* (source) {
      for await (const chunk of source) {
        bytes += chunk.length;
        if (bytes > item.bytes) fail(`备份文件大小与清单不符：${item.name}；未修改目标。`);
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(staged, { flags: 'wx', mode: 0o600 })
  );
  if (bytes !== item.bytes || hash.digest('hex') !== item.sha256) fail(`备份文件校验失败：${item.name}；未修改目标。`);
  return staged;
}

async function emptyStorage(target) {
  if (!await exists(target)) return;
  const stat = await lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(target)).length !== 0) fail('恢复目标 APP_STORAGE_DIR 必须不存在或是空的实际目录；不覆盖既有原件。');
}
async function emptyDatabase(config) {
  const sql = `SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    UNION ALL SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema','public')
  );`;
  const output = await command('psql', [...config.dbArgs, '--no-psqlrc', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', sql], config.dbEnv);
  if (output !== 'f') fail('恢复目标数据库不是空库；只向隔离新实例恢复，不清理或覆盖已有业务。');
}

async function restore(directory) {
  if (!directory) fail('用法：restore.sh <现行备份目录>');
  const config = configuration(true);
  const backupPath = await realpath(path.resolve(directory));
  const manifest = await readManifest(backupPath, config);
  await emptyStorage(config.storage);
  await mkdir(path.dirname(config.storage), { recursive: true, mode: 0o700 });
  const parent = await realpath(path.dirname(config.storage));
  const target = path.join(parent, path.basename(config.storage));
  if (below(target, backupPath) || below(backupPath, target)) fail('备份与恢复目标目录不能互相包含。');
  await command('pg_restore', ['--version']);
  await command('psql', ['--version']);
  const temporary = await mkdtemp(path.join(parent, '.lexorder-restore-'));
  let databaseRestored = false, published = false;
  try {
    const inputs = [];
    for (let index = 0; index < PARTS.length; index++) {
      const input = await stageVerifiedFile(backupPath, temporary, manifest.files[index]);
      const output = manifest.encrypted ? path.join(temporary, PARTS[index]) : input;
      if (manifest.encrypted) await crypt(input, output, true);
      inputs.push(output);
    }
    const originals = path.join(temporary, 'originals');
    await extractStorage(inputs[1], originals);
    await command('pg_restore', ['--list', inputs[0]]);
    await emptyDatabase(config);
    console.log(`目标数据库：${config.database}；目标原件：${target}`);
    console.log('仅向隔离空实例恢复。确认备份来自停止写入的时点、目标 Web/worker 已停止，且原主密钥和必要私有配置已独立恢复。');
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    let answer;
    try { answer = await readline.question('输入 YES 开始恢复：'); } finally { readline.close(); }
    if (answer.trim() !== 'YES') fail('恢复已取消，未修改目标数据库。');
    await emptyStorage(target);
    await emptyDatabase(config);
    await command('pg_restore', [...config.dbArgs, '--no-owner', '--single-transaction', '--exit-on-error', inputs[0]], config.dbEnv);
    databaseRestored = true;
    // The PostgreSQL transaction is finished. Files are published afterwards;
    // this deliberately makes no claim of a transaction spanning DB and files.
    if (await exists(target)) await rmdir(target);
    await rename(originals, target);
    published = true;
    console.log('\n数据库及本地原件已恢复。保持 Web/worker 停止，核验解密、权限和固定引用后再开放业务及检索。');
    console.log('本命令不恢复私有配置，不代表容器发行、升级或完整业务验收通过。');
  } catch (error) {
    if (databaseRestored && !published) fail(`数据库已恢复但原件未发布；实例必须继续停止，不能开放业务。原件暂存于 ${temporary}。原因：${error.message}`);
    throw error;
  } finally {
    if (!databaseRestored || published) await rm(temporary, { recursive: true, force: true });
  }
}

const [action, directory, ...extra] = process.argv.slice(2);
try {
  if (extra.length || !['backup', 'restore'].includes(action)) fail('用法：local-backup.mjs backup [目录] | restore <目录>');
  if (action === 'backup') await backup(directory); else await restore(directory);
} catch (error) {
  console.error(`备份/恢复失败：${privateOutput(error.message)}`);
  process.exitCode = 1;
}
