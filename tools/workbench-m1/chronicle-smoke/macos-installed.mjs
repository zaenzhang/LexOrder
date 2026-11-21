import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import sharp from 'sharp';
import { bytesPerFile, fileCount, hasPerformancePdfMarker, syntheticImportFiles } from './desktop-performance-fixture.mjs';
import { processTable, processTree } from './webkit-process-memory.mjs';
import { readPublishedBatch } from './release-parse-proof.mjs';

const [bundle, workspace, mode] = process.argv.slice(2);
assert(process.platform === 'darwin' && path.isAbsolute(bundle ?? '') && bundle.endsWith('.app')
  && path.isAbsolute(workspace ?? ''), 'Supply a mounted macOS .app and an absolute seeded smoke workspace');
assert.notEqual(workspace, process.env.LEXORDER_DESKTOP_WORKSPACE, 'Use a separate smoke workspace');

const binary = path.join(bundle, 'Contents/MacOS/lexorder-chronicle-preview');
const runtime = path.join(bundle, 'Contents/Resources/lexorder-runtime');
const owner = path.join(workspace, '.owner');
await access(binary);
await access(path.join(workspace, 'workspace.json'));
await assert.rejects(lstat(owner), { code: 'ENOENT' });
const script = fileURLToPath(new URL('./macos-installed.applescript', import.meta.url));
const run = promisify(execFile);
const diagnosticsDir = process.env.LEXORDER_MACOS_DIAGNOSTICS_DIR;
const fixture = (mode === '--case-flow' || mode === '--batch')
  ? JSON.parse(await readFile(path.join(workspace, 'chronicle-performance-fixture.json'), 'utf8')) : null;

async function probe(pid, action, label = '') {
  const timeout = action === 'inspect' ? 20_000 : 8000;
  const { stdout } = await run('/usr/bin/osascript', [script, String(pid), action, label], { timeout });
  return stdout.trim();
}

async function waitFor(pid, action, label, expected, timeout = 18_000) {
  const deadline = performance.now() + timeout;
  do {
    if (await probe(pid, action, label) === expected) return;
    await delay(250);
  } while (performance.now() < deadline);
  const state = await probe(pid, 'inspect').catch(error => error.message);
  throw new Error(action + ' ' + label + ' unavailable in the installed window\n' + state);
}

async function measureCases(pid, round) {
  const press = label => waitFor(pid, 'press', label, 'pressed');
  const heading = label => waitFor(pid, 'heading', label, 'found');
  const [a, b] = fixture.cases;
  await press('切换案件：个人工作区');
  await press(a.title);
  await heading(a.title);

  const switchCaseMs = [];
  for (const [from, to] of [[a, b], [b, a], [a, b], [b, a]]) {
    await press('切换案件：' + from.title);
    const started = performance.now();
    await press(to.title);
    await heading(to.title);
    switchCaseMs.push(Math.round(performance.now() - started));
  }

  const bounds = await probe(pid, 'bounds');
  assert.match(bounds, /^-?\d+,-?\d+,\d+,\d+$/);
  const screenshot = path.join(workspace, 'chronicle-installed-pdf-' + round + '.png');
  await press('材料');
  const started = performance.now();
  await press('材料目录');
  for (const deadline = started + 12_000; performance.now() < deadline;) {
    await run('/usr/sbin/screencapture', ['-x', '-R' + bounds, screenshot], { timeout: 5000 });
    const pixels = await sharp(screenshot).ensureAlpha().raw().toBuffer();
    if (hasPerformancePdfMarker(pixels)) return { switchCaseMs, pdfFirstVisibleMs: Math.round(performance.now() - started) };
    await delay(180);
  }
  throw new Error('The installed macOS window did not paint the fixed PDF marker');
}

async function measureImport(pid, existingPids) {
  const press = label => waitFor(pid, 'press', label, 'pressed');
  const textVisible = (label, timeout) => waitFor(pid, 'text', label, '1', timeout);
  const [a, b] = fixture.cases;
  await press('切换案件：' + (mode === '--batch' ? '个人工作区' : a.title));
  await press(b.title);
  await waitFor(pid, 'heading', b.title, 'found');
  if (await probe(pid, 'press', '材料目录') !== 'pressed') {
    await press('材料');
    await press('材料目录');
  }
  await press('批量导入');

  const tag = randomUUID().slice(0, 8);
  const folder = path.join(path.dirname(workspace), 'desktop-uploads-' + tag);
  const files = syntheticImportFiles(tag);
  await mkdir(folder, { mode: 0o700 });
  await Promise.all(files.map(file => writeFile(path.join(folder, file.name), file.buffer)));
  await press('no files selected');
  await waitFor(pid, 'open-panel', '', 'open');

  const baseline = processTree(pid, existingPids);
  assert(baseline.processes && baseline.bytes > 0, 'No desktop process tree at baseline');
  const samples = [];
  const sample = () => samples.push({ at: Date.now(), ...processTree(pid, existingPids) });
  sample();
  const sampler = setInterval(sample, 125);
  const startedAt = Date.now();
  const started = performance.now();
  try {
    assert.equal(await probe(pid, 'go-to-folder', folder + '/'), 'navigated');
    await delay(700);
    assert.equal(await probe(pid, 'select-files'), 'submitted');
    await textVisible('已入卷 0 件，待处理 ' + fileCount + ' 件，失败 0 件');
    const names = files.map(file => file.name).sort();
    const queuedFiles = (await probe(pid, 'queued-files')).split(', ').sort();
    assert.deepEqual(queuedFiles, names, 'Only this round’s synthetic files may be imported');
    await press('导入待处理文件');
    await textVisible('已入卷 ' + fileCount + ' 件，待处理 0 件，失败 0 件', 90_000);
    const receiptAt = Date.now();
    const importMs = Math.round(performance.now() - started);
    console.log('CHRONICLE_MACOS_IMPORT_RECEIPT ' + JSON.stringify({ fileCount, ms: importMs }));

    // Cover the worker without querying the running workspace directly. After
    // shutdown, verify that the real completion timestamp fell within this interval.
    await delay(18_000);
    sample();
    return { names, matterId: b.id, baseline, samples, startedAt, receiptAt, importMs };
  } finally {
    clearInterval(sampler);
  }
}

async function confirmImportedBatch(batch) {
  const { names, matterId, baseline, samples, startedAt, receiptAt, importMs } = batch;
  const { parseStates, firstFinishedMs, lastFinishedMs } = await readPublishedBatch(runtime, workspace, matterId, names);
  const endOfActivity = Math.max(receiptAt, lastFinishedMs);
  assert(firstFinishedMs >= startedAt && endOfActivity < samples.at(-1).at, 'The published batch must finish while the running app is sampled');
  const lastSample = samples.findIndex(row => row.at > endOfActivity);
  const intake = samples.filter(row => row.at <= receiptAt);
  assert(intake.length && lastSample > 0, 'Missing import or parsing memory samples');
  const peak = samples.slice(0, lastSample + 1).reduce((largest, current) => current.bytes > largest.bytes ? current : largest);
  return {
    fileCount, inputBytes: fileCount * bytesPerFile, parseStates, importMs, parsedMs: lastFinishedMs - startedAt,
    baselineBytes: baseline.bytes, intakePeakBytes: Math.max(...intake.map(row => row.bytes)),
    peakBytes: peak.bytes, observedProcesses: peak.processes, xpcProcesses: peak.xpcProcesses, samplingCount: lastSample + 1,
  };
}

async function measure(round) {
  const env = { ...process.env, LEXORDER_DESKTOP_WORKSPACE: workspace };
  delete env.LEXORDER_DESKTOP_ROOT;
  delete env.NEXT_DIST_DIR;
  delete env.LEXORDER_MACOS_SMOKE_PORT;
  const existingPids = fixture ? new Set(processTable().map(row => row.pid)) : null;
  const started = performance.now();
  const child = spawn(binary, { cwd: path.dirname(binary), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '';
  let hostOutput = '';
  child.stdout.on('data', chunk => { hostOutput = (hostOutput + chunk).slice(-2000); });
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });
  const closed = new Promise(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  try {
    assert(child.pid, 'Could not start the bundled Tauri binary');
    let size;
    for (const deadline = started + 60_000; performance.now() < deadline;) {
      assert.equal(child.exitCode, null, 'Bundled Tauri process exited before the home page');
      assert.equal(child.signalCode, null, 'Bundled Tauri process was terminated before the home page');
      size = await probe(child.pid, 'page');
      if (/^\d+ \d+$/.test(size)) break;
      await delay(250);
    }
    if (!/^\d+ \d+$/.test(size ?? '')) {
      const structure = await probe(child.pid, 'inspect').catch(error => error.message);
      throw new Error('The installed window did not expose the loaded 今日办理 date: ' + size + '\n' + structure);
    }
    assert.match(hostOutput, /LEXORDER_DESKTOP_READY http:\/\/127\.0\.0\.1:\d+/);
    const startMs = Math.round(performance.now() - started);
    assert((await lstat(owner)).isSymbolicLink(), 'Expected the running macOS workspace owner marker');

    const caseMetrics = mode === '--case-flow' ? await measureCases(child.pid, round) : {};

    const batch = fixture ? await measureImport(child.pid, existingPids) : null;

    const closeAt = performance.now();
    assert.equal(await probe(child.pid, 'close'), 'pressed', 'Could not close the installed window');
    const exit = await Promise.race([closed, delay(45_000, null, { ref: false })]);
    assert.deepEqual(exit, { code: 0, signal: null }, 'The installed window did not shut down cleanly');
    await assert.rejects(lstat(owner), { code: 'ENOENT' });
    const closeMs = Math.round(performance.now() - closeAt);
    const importMetrics = batch ? await confirmImportedBatch(batch) : {};
    console.log('CHRONICLE_MACOS_INSTALLED ' + JSON.stringify({
      round, ...caseMetrics, ...importMetrics, startMs, closeMs, window: size.split(' ').map(Number),
    }));
  } catch (error) {
    if (hostOutput) console.error(hostOutput);
    if (diagnostic) console.error(diagnostic);
    if (diagnosticsDir) {
      try {
        await mkdir(diagnosticsDir, { recursive: true });
        await run('/usr/sbin/screencapture', ['-x', path.join(diagnosticsDir, 'round-' + round + '.png')], { timeout: 8000 });
      } catch (captureError) { console.error('Status after screenshot request:', captureError.message); }
    }
    throw error;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}

for (let round = 1; round <= 3; round++) await measure(round);
