import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { bytesPerFile, fileCount, prepareCases, syntheticImportFiles, waitForImportParsing } from "./desktop-performance-fixture.mjs";
import { webViewRequest } from "./webview2-request.mjs";

const duration = start => Math.round(performance.now() - start);

async function hasPdfMarker(page, frame) {
  const png = await frame.screenshot({ animations: "disabled", timeout: 1500 });
  return page.evaluate(async (encoded) => {
    const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + encoded)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let matches = 0;
    for (let offset = 0; offset < rgba.length; offset += 16) {
      if (rgba[offset] >= 195 && rgba[offset + 1] <= 66 && rgba[offset + 2] >= 115 && rgba[offset + 2] <= 170) matches++;
    }
    return matches > 500;
  }, png.toString("base64"));
}

async function workingSetSampler(hostPid) {
  assert(Number.isSafeInteger(hostPid) && hostPid > 0);
  const script = `
$ErrorActionPreference='Stop'
$rootPid=${hostPid}
while (Get-Process -Id $rootPid -ErrorAction SilentlyContinue) {
  $rows = Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize
  $known = [Collections.Generic.HashSet[uint32]]::new()
  [void]$known.Add($rootPid)
  do {
    $before=$known.Count
    foreach ($row in $rows) {
      if ($known.Contains($row.ParentProcessId)) { [void]$known.Add($row.ProcessId) }
    }
  } while ($known.Count -ne $before)
  $sum = ($rows | Where-Object {$known.Contains($_.ProcessId)} | Measure-Object -Property WorkingSetSize -Sum).Sum
  [Console]::WriteLine(("{0} {1} {2}" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(),[int64]$sum,$known.Count))
  Start-Sleep -Milliseconds 100
}
`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    windowsHide: true, stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = once(child, "close");
  const lines = createInterface({ input: child.stdout });
  const samples = [];
  lines.on("line", line => {
    const [at, bytes, processes] = line.trim().split(" ").map(Number);
    if (at > 0 && bytes > 0 && processes > 0) samples.push({ at, bytes, processes });
  });
  try {
    const deadline = Date.now() + 10_000;
    while (!samples.length && child.exitCode === null && Date.now() < deadline) await delay(50);
    assert(samples.length, "Cannot sample the native process tree");
    return { samples, async stop() { child.kill(); await exited; } };
  } catch (error) {
    child.kill();
    await exited;
    throw error;
  }
}

export async function measureWebView2Performance(page, origin, { workspace, casebookRoot, hostPid, started, installed }) {
  await page.getByText(/ · 本机承办工作$/).waitFor();
  const startMs = duration(started);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { cases: [a, b], documentId } = await prepareCases(webViewRequest(page, origin), workspace, casebookRoot);
  const overview = title => page.getByRole("region", { name: "案件状态和期限" }).getByRole("heading", { name: title, exact: true });
  await page.goto(origin + "/matters/" + a.id + "/overview");
  await overview(a.title).waitFor({ timeout: 8000 }).catch(async error => {
    const main = await page.locator("main").first().innerText({ timeout: 2000 }).catch(() => "");
    throw new Error("Overview unavailable at " + new URL(page.url()).pathname + ": " + main.slice(0, 400), { cause: error });
  });
  const switchCaseMs = [];
  for (const [from, to] of [[a, b], [b, a], [a, b], [b, a]]) {
    await page.getByRole("button", { name: "切换案件：" + from.title, exact: true }).click();
    const link = page.getByRole("menuitem", { name: to.title, exact: true });
    await link.waitFor();
    const began = performance.now();
    await link.click();
    await overview(to.title).waitFor();
    switchCaseMs.push(duration(began));
  }

  const pdfStarted = performance.now();
  const pdfResponse = page.waitForResponse(response => response.url().endsWith("/" + documentId + "/download?inline=1") && response.status() === 200)
    .then(() => duration(pdfStarted));
  await page.goto(origin + "/matters/" + a.id + "/materials", { waitUntil: "domcontentloaded" });
  const pdfResponseMs = await pdfResponse;
  const frame = page.locator('iframe[title="选中材料固定版本"]');
  await frame.waitFor();
  let pdfFirstVisibleMs = null;
  const pdfDeadline = performance.now() + 8000;
  while (performance.now() < pdfDeadline) {
    if (await hasPdfMarker(page, frame)) { pdfFirstVisibleMs = duration(pdfStarted); break; }
    await delay(100);
  }

  await page.goto(origin + "/matters/" + b.id + "/materials");
  await page.getByRole("button", { name: "批量导入", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "批量导入材料", exact: true });
  const picker = sheet.locator('input[type="file"]').first();
  await picker.waitFor();
  const sampler = await workingSetSampler(hostPid);
  const tag = randomUUID().slice(0, 8);
  const importStarted = performance.now();
  const importStartedWall = Date.now();
  try {
    await picker.setInputFiles(syntheticImportFiles(tag));
    await sheet.getByRole("button", { name: "导入待处理文件", exact: true }).click();
    await sheet.getByRole("status").filter({ hasText: "已入卷 " + fileCount + " 件，待处理 0 件，失败 0 件" }).waitFor({ timeout: 90_000 });
    const importMs = duration(importStarted);
    const importFinishedWall = Date.now();
    const parseStates = await waitForImportParsing(webViewRequest(page, origin), b.id, tag);
    const parsedMs = duration(importStarted);
    const during = sampler.samples.filter(sample => sample.at >= importStartedWall);
    const intake = during.filter(sample => sample.at <= importFinishedWall);
    assert(during.some(sample => sample.at > importFinishedWall), "The sampler did not capture background parsing");
    const baseline = [...sampler.samples].reverse().find(sample => sample.at <= importStartedWall);
    const peak = during.reduce((largest, sample) => sample.bytes > largest.bytes ? sample : largest);
    console.log("CHRONICLE_PERFORMANCE " + JSON.stringify({
      installed, startMs, switchCaseMs, pdfResponseMs, pdfFirstVisibleMs, importMs, parsedMs, parseStates, fileCount,
      inputBytes: fileCount * bytesPerFile, baselineBytes: baseline?.bytes,
      intakePeakBytes: intake.length ? Math.max(...intake.map(sample => sample.bytes)) : null, peakBytes: peak.bytes,
      observedProcesses: peak.processes, samplingCount: during.length,
    }));
    assert(pdfFirstVisibleMs !== null, "Native PDF first-page marker was not visible in the embedded preview");
  } finally {
    await sampler.stop();
  }
}
