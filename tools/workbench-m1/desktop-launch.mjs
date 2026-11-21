import { cp, mkdir, access, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const host = path.join(root, 'desktop/personal-chronicle/desktop-preview');
const argument = process.argv[2];
const packageApp = argument === "--package";
const buildOnly = argument === '--build-only';
const macosWebDriver = buildOnly && process.platform === 'darwin' && process.argv[3] === '--macos-webdriver';
const workspace = buildOnly || packageApp ? undefined : argument;
if (process.argv.length > (macosWebDriver ? 4 : 3) || (workspace && !path.isAbsolute(workspace))) {
  throw new Error('Usage: bun run desktop [absolute workspace path | --build-only [--macos-webdriver] | --package]');
}
if (Bun.version !== '1.4.5') throw new Error('The desktop sidecar requires Bun 1.4.5');
const platform = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
const triple = /^host: (\S+)/m.exec(platform.stdout ?? '')?.[1];
if (platform.status !== 0 || !triple) throw new Error('Desktop requires the native Rust toolchain');
const exe = process.platform === 'win32' ? '.exe' : '';
const runtimeDist = process.env.NEXT_DIST_DIR ?? '.next-personal';
for (const artifact of [
  path.join(root, runtimeDist, 'standalone/server.js'),
  path.join(root, runtimeDist, 'standalone/public/_chronicle/index.html'),
]) {
  await access(artifact).catch(() => { throw new Error('Missing desktop build: ' + artifact); });
}
const binaries = path.join(host, 'binaries');
await mkdir(binaries, { recursive: true });
const sidecar = path.join(binaries, 'lexorder-bun-' + triple + exe);
const source = await stat(process.execPath);
const staged = await stat(sidecar).catch(error => {
  if (error.code !== 'ENOENT') throw error;
});
if (staged?.size !== source.size || Math.trunc(staged.mtimeMs / 1000) !== Math.trunc(source.mtimeMs / 1000)) {
  await cp(process.execPath, sidecar, { preserveTimestamps: true });
}

const target = path.resolve(process.env.CARGO_TARGET_DIR ?? path.join(host, 'target'));
const config = JSON.stringify({ bundle: { externalBin: ['binaries/lexorder-bun'] } });
if (packageApp) {
  const stage = spawnSync(process.execPath, [path.join(import.meta.dirname, 'desktop-stage.mjs')], { stdio: 'inherit' });
  if (stage.error) throw stage.error;
  if (stage.status !== 0) process.exit(stage.status ?? 1);
  const bundle = process.platform === 'win32' ? 'nsis' : process.platform === 'darwin' ? 'app,dmg' : 'deb';
  const packaged = spawnSync('node', [path.join(path.dirname(host), 'node_modules/@tauri-apps/cli/tauri.js'),
    'build', '--bundles', bundle, '--config', JSON.stringify({
      bundle: { active: true, externalBin: ['binaries/lexorder-bun'], resources: { 'runtime-payload/': 'lexorder-runtime/' } },
    }),
  ], { cwd: host, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target } });
  if (packaged.error) throw packaged.error;
  process.exit(packaged.status ?? 1);
}
const build = spawnSync('cargo', ['build', '--locked', '--manifest-path', path.join(host, 'Cargo.toml'),
  '--target-dir', target, ...(macosWebDriver ? ['--features', 'macos-webdriver-smoke'] : [])], {
  cwd: host, stdio: 'inherit', env: { ...process.env, TAURI_CONFIG: config },
});
if (build.error) throw build.error;
if (build.status !== 0 || buildOnly) process.exit(build.status ?? 1);
const desktop = spawnSync(path.join(target, 'debug', 'lexorder-chronicle-preview' + exe), [], {
  cwd: root, stdio: 'inherit', env: {
    ...process.env, LEXORDER_DESKTOP_ROOT: root, LEXORDER_DESKTOP_WORKSPACE: workspace,
    NEXT_DIST_DIR: runtimeDist,
  },
});
if (desktop.error) throw desktop.error;
process.exitCode = desktop.status ?? 1;
