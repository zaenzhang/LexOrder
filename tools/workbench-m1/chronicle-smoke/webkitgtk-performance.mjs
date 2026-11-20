import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, open, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { bytesPerFile, fileCount, hasPerformancePdfMarker, prepareCases, syntheticImportFiles, waitForImportParsing } from "./desktop-performance-fixture.mjs";

const [binaryArgument, driverArgument, roundsArgument = "3"] = process.argv.slice(2);
assert(process.platform === "linux" && binaryArgument && driverArgument && /^[1-9]$/.test(roundsArgument),
  "Usage (under Xvfb or the development desktop): webkitgtk-performance.mjs <debug binary> <WebKitWebDriver> [rounds]");
const repo = path.resolve(import.meta.dirname, "../../..");
const binary = path.resolve(binaryArgument);
const driver = path.resolve(driverArgument);
const root = path.join(repo, "tools/workbench-m1/.runtime/webkitgtk-performance");
const workspace = path.join(root, "workspace");
const casebookRoot = path.join(root, "casebook");
await mkdir(casebookRoot, { recursive: true });
await mkdir(workspace, { recursive: true, mode: 0o700 });

const elapsed = start => Math.round(performance.now() - start);
const elementKey = "element-6066-11e4-a52e-4f735466cecf";

async function waitFor(label, probe, timeout = 12_000) {
  const until = performance.now() + timeout;
  do {
    const value = await probe();
    if (value) return value;
    await delay(45);
  } while (performance.now() < until);
  throw new Error("Timed out waiting for " + label);
}

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function processTree(rootPid) {
  const processes = execFileSync("ps", ["-eo", "pid=,ppid=,rss="], {
    encoding: "utf8", env: { ...process.env, COLUMNS: "120", LINES: "24" },
  })
    .trim().split("\n").map(line => line.trim().split(/\s+/).map(Number));
  const children = new Map();
  for (const process of processes) {
    const siblings = children.get(process[1]) ?? [];
    siblings.push(process);
    children.set(process[1], siblings);
  }
  const descendants = [...(children.get(rootPid) ?? [])];
  for (const [pid] of descendants) descendants.push(...(children.get(pid) ?? []));
  return { children: children.get(rootPid) ?? [], processes: descendants.length,
    bytes: descendants.reduce((total, row) => total + row[2] * 1024, 0) };
}

async function measure() {
  const profile = await mkdtemp(path.join(root, "profile-"));
  const log = await open(path.join(profile, "driver.log"), "w");
  const port = await freePort();
  const child = spawn(driver, ["--host=local", "--port=" + port], {
    cwd: repo, stdio: ["ignore", log.fd, log.fd],
    env: { ...process.env, TAURI_WEBVIEW_AUTOMATION: "true", LEXORDER_DESKTOP_ROOT: repo,
      NEXT_DIST_DIR: ".next-personal", LEXORDER_DESKTOP_WORKSPACE: workspace,
      XDG_DATA_HOME: profile, XDG_CACHE_HOME: profile },
  });
  const exited = once(child, "close");
  const webdriver = "http://127.0.0.1:" + port;
  async function command(route, method = "GET", body) {
    const response = await fetch(webdriver + route, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const { value } = await response.json();
    if (!response.ok) throw new Error(method + " " + route + ": " + value.error + " " + value.message);
    return value;
  }
  let session;
  try {
    await waitFor("WebKitWebDriver", async () => {
      assert(child.exitCode === null, "WebKitWebDriver exited");
      return (await command("/status").catch(() => null))?.ready;
    });
    const started = performance.now();
    const { sessionId } = await command("/session", "POST", {
      capabilities: { alwaysMatch: { "webkitgtk:browserOptions": { binary, args: [] } } },
    });
    session = "/session/" + sessionId;
    const execute = (script, ...args) => command(session + "/execute/sync", "POST", { script, args });
    const visible = (selector, expected, includes = false) => execute(`
      return [...document.querySelectorAll(arguments[0])].some(el =>
        el.getClientRects().length && (arguments[2]
          ? el.textContent.includes(arguments[1]) : el.textContent.trim() === arguments[1]));
    `, selector, expected, includes);
    await waitFor("today data", () => visible("main p", " · 本机承办工作", true), 30_000);
    const startMs = elapsed(started);
    const native = await execute("return {origin: location.origin, userAgent: navigator.userAgent, viewport: [innerWidth,innerHeight]}");
    assert.match(native.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(native.userAgent, /Linux.*AppleWebKit/);
    assert.deepEqual(native.viewport, [1440, 900], "Use a 1440 × 900 test viewport");
    const request = async (route, body, expected = 200) => {
      assert.match(route, /^\/api\//);
      const multipart = body instanceof FormData;
      const payload = multipart ? await Promise.all([...body].map(async ([key, value]) => [
        key, typeof value === "string" ? value : {
          name: value.name, type: value.type, bytes: [...new Uint8Array(await value.arrayBuffer())],
        },
      ])) : body ?? null;
      const result = await command(session + "/execute/async", "POST", {
        script: `
          const [route, payload, multipart, done] = arguments;
          let body;
          if (multipart) {
            body = new FormData();
            for (const [key, value] of payload) body.set(key, typeof value === "string" ? value :
              new File([Uint8Array.from(value.bytes)], value.name, { type: value.type }));
          } else if (payload) body = JSON.stringify(payload);
          fetch(route, { method: body ? "POST" : "GET", body, redirect: "error",
            headers: payload && !multipart ? { "Content-Type": "application/json" } : {} })
            .then(async response => done({ status: response.status, headers: [...response.headers],
              bytes: [...new Uint8Array(await response.arrayBuffer())] }))
            .catch(error => done({ error: String(error) }));
        `,
        args: [route, payload, multipart],
      });
      assert(!result.error, result.error);
      assert.equal(result.status, expected, route.split("?")[0]);
      return new Response(Uint8Array.from(result.bytes), { status: result.status, headers: result.headers });
    };
    const { cases: [a, b], documentId } = await prepareCases(request, workspace, casebookRoot);
    const navigate = route => command(session + "/url", "POST", { url: native.origin + route });
    const element = async (selector, title, attribute, hitTest = false) => {
      const handle = await waitFor(title ?? selector, () => execute(`
        const [selector, title, attribute, hitTest] = arguments;
        return [...document.querySelectorAll(selector)].find(el => {
          if (title !== null && (!el.getClientRects().length || (attribute ? el.getAttribute(attribute) : el.textContent.trim()) !== title)) return false;
          if (!hitTest) return true;
          const rect = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }) ?? null;
      `, selector, title ?? null, attribute ?? null, hitTest));
      return session + "/element/" + handle[elementKey];
    };
    const click = handle => command(handle + "/click", "POST", {});
    const overview = title => waitFor("overview " + title, () => visible('section[aria-label="案件状态和期限"] h2', title));
    await navigate("/matters/" + a.id + "/overview");
    await overview(a.title);
    const switchCaseMs = [];
    for (const [from, to] of [[a, b], [b, a], [a, b], [b, a]]) {
      await click(await element("button", "切换案件：" + from.title, "aria-label"));
      const link = await element('[role="menuitem"]', to.title, null, true);
      const began = performance.now();
      await click(link);
      await overview(to.title);
      switchCaseMs.push(elapsed(began));
    }

    const pdfStarted = performance.now();
    const pdfStartedWall = Date.now();
    await navigate("/matters/" + a.id + "/materials");
    const frame = await element('iframe[title="选中材料固定版本"]');
    const pdfPath = await execute('return document.querySelector(\'iframe[title="选中材料固定版本"]\').getAttribute("src")');
    assert(pdfPath.endsWith("/" + documentId + "/download?inline=1"));
    let pdfFirstVisibleMs = null;
    let pdfResponseMs = null;
    const pdfDeadline = performance.now() + 8000;
    while (performance.now() < pdfDeadline) {
      const entry = await execute("const entry = performance.getEntriesByName(new URL(arguments[0], location.href).href).at(-1); return entry ? performance.timeOrigin + entry.responseEnd : null", pdfPath);
      if (entry) pdfResponseMs = Math.round(entry - pdfStartedWall);
      const screenshot = await command(frame + "/screenshot");
      const rgba = await sharp(Buffer.from(screenshot, "base64")).ensureAlpha().raw().toBuffer();
      if (hasPerformancePdfMarker(rgba)) { pdfFirstVisibleMs = elapsed(pdfStarted); break; }
      await delay(100);
    }
    if (pdfFirstVisibleMs === null) {
      const screenshot = await command(session + "/screenshot");
      await writeFile(path.join(profile, "pdf-unpainted.png"), Buffer.from(screenshot, "base64"));
    }
    assert(pdfResponseMs > 0, "No embedded PDF response in WebKit resource timings");
    const pdf = await request(pdfPath);
    assert.match(pdf.headers.get("content-type"), /application\/pdf/);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

    await navigate("/matters/" + b.id + "/materials");
    await click(await element("button", "批量导入"));
    const picker = await element('[role="dialog"] input[type="file"]');
    const tag = randomUUID().slice(0, 8);
    const uploads = path.join(profile, "uploads");
    await mkdir(uploads);
    const files = await Promise.all(syntheticImportFiles(tag).map(async file => {
      const fullPath = path.join(uploads, file.name);
      await writeFile(fullPath, file.buffer);
      return fullPath;
    }));
    const baseline = processTree(child.pid);
    assert(baseline.children.length && baseline.bytes > 0, "No desktop process tree");
    const samples = [];
    const sampler = setInterval(() => samples.push({ at: performance.now(), ...processTree(child.pid) }), 75);
    const importStarted = performance.now();
    let importMs, importFinished, parseStates;
    try {
      const text = files.join("\n");
      await command(picker + "/value", "POST", { text });
      await click(await element('[role="dialog"] button', "导入待处理文件"));
      await waitFor("all import receipts", () => visible('[role="dialog"] [role="status"]',
        "已入卷 " + fileCount + " 件，待处理 0 件，失败 0 件", true), 90_000);
      importFinished = performance.now();
      importMs = elapsed(importStarted);
      parseStates = await waitForImportParsing(request, b.id, tag);
      samples.push({ at: performance.now(), ...processTree(child.pid) });
    } finally {
      clearInterval(sampler);
    }
    const intake = samples.filter(sample => sample.at <= importFinished);
    assert(intake.length, "No process samples during upload");
    assert(samples.some(sample => sample.at > importFinished), "No process samples during background parsing");
    const peak = samples.reduce((largest, sample) => sample.bytes > largest.bytes ? sample : largest);
    const output = { startMs, switchCaseMs, pdfResponseMs, pdfFirstVisibleMs, importMs,
      parsedMs: elapsed(importStarted), parseStates, fileCount, inputBytes: fileCount * bytesPerFile,
      baselineBytes: baseline.bytes, intakePeakBytes: Math.max(...intake.map(sample => sample.bytes)),
      peakBytes: peak.bytes, observedProcesses: peak.processes, samplingCount: samples.length, viewport: native.viewport };
    console.log("CHRONICLE_GTK_PERFORMANCE " + JSON.stringify(output));
    if (pdfFirstVisibleMs === null) console.error("Native PDF first-page marker absent: " + profile);
    return pdfFirstVisibleMs !== null;
  } finally {
    try {
      if (session) await command(session, "DELETE");
    } finally {
      child.kill();
      await exited;
      await log.close();
    }
  }
}

let verified = true;
for (let round = 0; round < Number(roundsArgument); round++) {
  const passed = await measure();
  verified &&= passed;
}
assert(verified, "Fixed PDF bytes are available, but WebKitGTK did not paint the embedded page");
