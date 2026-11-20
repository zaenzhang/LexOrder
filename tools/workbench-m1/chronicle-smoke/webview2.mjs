import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { verifyWebView2Editor } from "./webview2-editor.mjs";
import { verifyWebView2Materials } from "./webview2-materials.mjs";
import { verifyWebView2Scale } from "./webview2-scale.mjs";

const executable = process.argv[2];
const workspace = process.env.M1_WORKSPACE;
assert(process.platform === "win32", "Run the WebView2 smoke with Windows Node.js.");
assert(executable && path.isAbsolute(executable), "Pass the absolute path to the Tauri debug executable.");
assert(workspace && path.isAbsolute(workspace), "Set M1_WORKSPACE to a local Windows synthetic workspace.");
const manifest = JSON.parse(await readFile(path.join(workspace, "workspace.json"), "utf8"));
assert.equal(manifest.mode, "PERSONAL");
const modes = ["--scale", "--editor", "--materials"].filter(flag => process.argv.includes(flag));
assert(modes.length <= 1, "Choose one targeted WebView2 smoke mode.");
const [mode] = modes;
const casebookRoot = process.env.M1_CHRONOLOGY_CASEBOOK_ROOT;
if (mode) assert(casebookRoot && path.isAbsolute(casebookRoot), "Set M1_CHRONOLOGY_CASEBOOK_ROOT to the isolated test casebook directory.");
const cases = mode ? [] : JSON.parse(await readFile(path.join(workspace, "chronicle-smoke-cases.json"), "utf8"));
if (!mode) assert(cases.length === 2 && cases.every(row => row.internalCode.startsWith("CHRONICLE-TEST-")));
const [otherMatter, matter] = cases;
const sourceRoot = process.env.LEXORDER_DESKTOP_ROOT ?? path.resolve(import.meta.dirname, "../../..");
assert(path.isAbsolute(sourceRoot));
const tempRoot = path.resolve(tmpdir());
const profile = await mkdtemp(path.join(tempRoot, "lexorder-webview2-"));
assert.equal(path.dirname(profile), tempRoot);
const child = spawn(executable, [], {
  windowsHide: true,
  stdio: "inherit",
  env: {
    ...process.env,
    LEXORDER_DESKTOP_ROOT: sourceRoot,
    LEXORDER_DESKTOP_WORKSPACE: workspace,
    LEXORDER_WEBVIEW2_SMOKE: "1",
    WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      "--remote-debugging-address=127.0.0.1 --remote-debugging-port=0",
  },
});
let launchError;
const exited = once(child, "exit").catch((error) => { launchError = error; });

let browser;
try {
  const portFile = path.join(profile, "EBWebView", "DevToolsActivePort");
  const deadline = Date.now() + 120_000;
  let port;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    assert.equal(child.exitCode, null, "The Tauri debug executable exited during startup.");
    try {
      const [line] = (await readFile(portFile, "utf8")).split(/\r?\n/);
      if (/^\d+$/.test(line)) {
        port = Number(line);
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(100);
  }
  assert(port, "WebView2 did not publish a debugging port in its fresh profile.");
  browser = await chromium.connectOverCDP("http://127.0.0.1:" + port, { timeout: 10_000 });
  const [context] = browser.contexts();
  const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 10_000 });
  page.setDefaultTimeout(30_000);
  await page.waitForURL(url => url.hostname === "127.0.0.1" && url.pathname === "/practice/today", { timeout: 60_000 });
  const desktopOrigin = new URL(page.url()).origin;
  const errors = [];
  page.on("pageerror", error => errors.push(error.stack ?? error.message));
  if (mode === "--scale") await verifyWebView2Scale(page, desktopOrigin, casebookRoot);
  else if (mode === "--editor") await verifyWebView2Editor(page, desktopOrigin, { workspace, manifest, casebookRoot });
  else if (mode === "--materials") await verifyWebView2Materials(page, desktopOrigin, casebookRoot);
  else await verifyStandardWebView(page, desktopOrigin, errors);
  if (mode) assert.deepEqual(errors, []);
} finally {
  try {
    await browser?.close();
  } finally {
    child.kill();
    await exited;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!await lstat(path.join(workspace, ".owner")).catch(error => {
        if (error.code !== "ENOENT") throw error;
      })) break;
      await delay(250);
    }
    await assert.rejects(lstat(path.join(workspace, ".owner")), { code: "ENOENT" });
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

async function verifyStandardWebView(page, desktopOrigin, errors) {
  const wideHeight = 680;
  await page.setViewportSize({ width: 1440, height: wideHeight });
  const graphPath = "/matters/" + matter.id + "/evidence/graph";
  const navigation = page.getByRole("navigation", { name: "主导航", exact: true });
  async function openCase(target) {
    await navigation.getByRole("link", { name: "案件", exact: true }).click();
    const search = page.getByRole("textbox", { name: "搜索案件", exact: true });
    await search.fill(target.title);
    await search.press("Enter");
    await page.getByRole("table", { name: "案件列表", exact: true })
      .getByRole("link", { name: target.title, exact: true }).click();
  }
  await openCase(matter);
  const group = navigation.getByRole("button", { name: "争点", exact: true });
  await group.click();
  const graphLink = navigation.getByRole("link", { name: "案情图谱", exact: true });
  await graphLink.click();
  await page.waitForURL(desktopOrigin + graphPath);
  const interval = page.locator('[data-slot="timeline-range-marker"]').and(page.getByRole("button", { name: /^借款约定期限/ }));
  await interval.waitFor();
  const rangeLayout = await interval.evaluate((marker) => {
    const lane = marker.closest('[data-slot="timeline-track"]').getBoundingClientRect();
    const mark = marker.getBoundingClientRect();
    return { laneHeight: lane.height, insideLane: mark.top >= lane.top && mark.bottom <= lane.bottom };
  });
  assert(rangeLayout.insideLane && Math.abs(rangeLayout.laneHeight - 40) < 0.5, JSON.stringify(rangeLayout));
  assert.equal(await interval.locator('[data-slot="timeline-range-start"]').count(), 1);
  const legend = page.locator('[aria-label="时间轴图例"]');
  const legendToggle = legend.getByRole("button", { name: "完整图例", exact: true });
  assert.equal(await legendToggle.getAttribute("aria-expanded"), "false");
  await legendToggle.click();
  const legendDetails = legend.locator("dl");
  await legendDetails.waitFor();
  assert.deepEqual(await legend.locator("dt").allTextContents(), ["核对与分歧", "日期表达", "事项性质", "事件等级"]);
  assert.equal(await legend.getByText("关键", { exact: true }).locator('[data-slot="timeline-key-grade"]').count(), 1);
  const rangeLine = '[data-slot="timeline-range-line"]';
  const legendRange = (label) => legend.getByText(label, { exact: true }).locator(rangeLine);
  const lineStyle = (line) => line.evaluate((element) => {
    const css = getComputedStyle(element);
    return { stroke: css.borderTopStyle, thickness: css.height, rounded: css.borderRadius };
  });
  const plottedStyle = await lineStyle(interval.locator(rangeLine));
  assert.deepEqual(plottedStyle, await lineStyle(legendRange(plottedStyle.stroke === "dashed" ? "约定" : "起止")));
  assert.notDeepEqual(await lineStyle(legendRange("仅到月")), await lineStyle(legendRange("约定")));

  const point = page.getByRole("region", { name: "时间轴事件" })
    .getByRole("button", { name: /^出借人交付借款 ·/ });
  const conflictDot = '[data-slot="timeline-conflict-dot"]';
  const dotStyle = (dot) => dot.evaluate((element) => {
    const css = getComputedStyle(element);
    return [css.width, css.height, css.backgroundColor, css.borderRadius];
  });
  assert.deepEqual(await dotStyle(point.locator(conflictDot)),
    await dotStyle(legendDetails.getByText("材料记载不一", { exact: true }).locator(conflictDot)));
  const gapStyle = (gap) => gap.evaluate((element) => getComputedStyle(element).backgroundImage);
  const gap = '[data-slot="timeline-gap-pattern"]';
  assert.equal(await gapStyle(page.locator('[data-slot="timeline-grid"]').locator(gap).first()),
    await gapStyle(legend.locator(gap)));

  const detail = page.getByRole("region", { name: "要点与出处", exact: true });
  const viewport = detail.locator('[data-slot="scroll-area-viewport"]');
  const review = detail.getByRole("button", { name: /^核对与标注/ });
  const sources = detail.getByRole("button", { name: /^材料记录 · \d+ 份材料$/ });
  const revision = detail.getByRole("button", { name: "修订要点", exact: true });
  await viewport.waitFor();
  assert.equal(await graphLink.getAttribute("aria-current"), "page");
  assert.equal(await group.getAttribute("data-active"), "");
  await page.waitForFunction(() => document.querySelector('[aria-label="要点与出处"]')
    ?.style.getPropertyValue("--chronology-detail-height"));

  const measure = () => viewport.evaluate((element) => {
    const panel = element.closest('[role="region"]');
    return {
      page: scrollY,
      local: element.scrollTop,
      range: element.scrollHeight - element.clientHeight,
      width: document.documentElement.clientWidth,
      bottom: panel.getBoundingClientRect().bottom,
      position: getComputedStyle(panel).position,
      overflow: getComputedStyle(element).overflowY,
    };
  });
  const select = detail.getByRole("combobox", { name: "事件性质", exact: true });
  assert.equal(await sources.getAttribute("aria-expanded"), "true");
  assert.match(await sources.getAttribute("aria-label"), /份材料/);
  assert.equal(await review.getAttribute("aria-expanded"), "false");
  assert.equal(await select.isVisible(), false);

  const catalog = detail.getByRole("region", { name: "材料记录", exact: true });
  const material = catalog.locator('ol button[data-slot="collapsible-trigger"]:not(:disabled)').first();
  const readSize = locator => locator.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  const headingSize = await readSize(detail.getByRole("heading").first());
  const sectionSize = await readSize(sources.getByText("材料记录", { exact: true }));
  const materialSize = await readSize(material.locator("span").first());
  assert(headingSize > sectionSize && sectionSize > materialSize);
  assert.doesNotMatch(await material.innerText(), /抽取文本|1 条记载/);
  await material.click();
  assert.doesNotMatch(await catalog.innerText(), /V\d+ ·|抽取文本/);
  await catalog.getByRole("button", { name: /^材料设置/ }).click();
  const sourceMenu = page.getByRole("menu");
  await sourceMenu.getByText("关联用途", { exact: true }).waitFor();
  await sourceMenu.getByRole("menuitem", { name: /^出现时点/ }).press("ArrowRight");
  await page.getByRole("menuitemradio", { name: "庭前", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const openOriginal = catalog.getByRole("button", { name: /^(查看原文|查看固定原文)/ }).first();
  await openOriginal.click();
  const original = page.getByRole("region", { name: "固定版本原文", exact: true });
  await original.getByRole("button", { name: "返回事实", exact: true }).click();
  await detail.waitFor();
  assert.equal(await material.getAttribute("aria-expanded"), "true");
  await material.click();

  await review.click();
  assert.equal(await sources.getAttribute("aria-expanded"), "true");
  await select.scrollIntoViewIfNeeded();
  assert.equal(await detail.getByRole("button", { name: /^(标为已核对|改回待核对)$/ }).count(), 1);
  await page.waitForFunction(() => {
    const body = document.querySelector('[aria-label="要点与出处"] [data-slot="scroll-area-viewport"]');
    return body.scrollHeight > body.clientHeight;
  });
  const wide = await measure();
  assert.equal(wide.position, "sticky");
  assert(wide.range > 0 && wide.bottom <= wideHeight + 1, JSON.stringify(wide));

  await select.click();
  const option = page.getByRole("option", { name: "未标注", exact: true });
  await option.waitFor();
  for (const name of ["page", "local", "width"]) {
    assert.equal((await measure())[name], wide[name], "Opening the select changed " + name);
  }
  await page.keyboard.press("Escape");
  await option.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "事件性质");
  const closed = await measure();
  assert.equal(closed.page, wide.page);
  assert.equal(closed.local, wide.local);

  for (const name of ["事件分类", "事件性质", "当事人争议", "事件等级"]) {
    const trigger = detail.getByRole("combobox", { name, exact: true });
    const fieldLabel = detail.locator("label").filter({ hasText: new RegExp("^" + name + "$") });
    const labelSize = await readSize(fieldLabel);
    assert.equal(await readSize(trigger), labelSize, name);
    await trigger.click();
    const firstOption = page.getByRole("listbox").getByRole("option").first();
    await firstOption.waitFor();
    assert.equal(await readSize(firstOption), labelSize, name + " option");
    await page.keyboard.press("Escape");
    await firstOption.waitFor({ state: "hidden" });
  }
  await select.scrollIntoViewIfNeeded();

  await viewport.hover({ position: { x: 40, y: 100 } });
  await page.mouse.wheel(0, 3000);
  await revision.waitFor();
  await page.waitForFunction(() => {
    const element = document.querySelector('[aria-label="要点与出处"] [data-slot="scroll-area-viewport"]');
    return element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
  });
  assert.equal((await measure()).page, wide.page);
  const history = detail.getByRole("button", { name: /^变更记录/ });
  assert(await history.evaluate((button) => button.getBoundingClientRect().bottom <= innerHeight));

  for (const width of [1024, 950, 390]) {
    await page.setViewportSize({ width, height: 820 });
    await detail.scrollIntoViewIfNeeded();
    const narrow = await measure();
    assert.equal(narrow.position, "static");
    assert.equal(narrow.overflow, "visible");
    assert(narrow.range <= 1, JSON.stringify(narrow));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), narrow.width);
    await select.hover();
    const beforeWheel = (await measure()).page;
    assert(beforeWheel > 0, "The narrow detail should follow the main content.");
    await page.mouse.wheel(0, -480);
    await page.waitForFunction((before) => scrollY < before, beforeWheel);
    assert.equal((await measure()).local, 0);
    await revision.scrollIntoViewIfNeeded();
    assert(await revision.evaluate((button) => button.getBoundingClientRect().bottom <= innerHeight));
  }

  await page.setViewportSize({ width: 1240, height: 820 });
  const sidebar = page.locator('[data-slot="sidebar-trigger"]');
  const waitForDetailPosition = (position) => page.waitForFunction((expected) => {
    const panel = document.querySelector('[aria-label="要点与出处"]');
    return panel && getComputedStyle(panel).position === expected;
  }, position);
  await waitForDetailPosition("static");
  await sidebar.click();
  await waitForDetailPosition("sticky");
  await sidebar.click();
  await waitForDetailPosition("static");

  await page.setViewportSize({ width: 390, height: 820 });
  const table = page.getByRole("table", { name: "案件事实与出处", exact: true });
  const fact = table.getByRole("button", { name: "李四出具借条", exact: true });
  await fact.scrollIntoViewIfNeeded();
  await fact.press("Enter");
  const selectedHeading = detail.getByRole("heading", { name: "李四出具借条", exact: true });
  await selectedHeading.waitFor();
  assert(await selectedHeading.evaluate((heading) => {
    const rect = heading.getBoundingClientRect();
    return rect.top >= 56 && rect.bottom <= innerHeight &&
      document.activeElement === heading.closest('[aria-label="要点与出处"]');
  }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await table.getByRole("button", { name: "出借人交付借款", exact: true }).click();
  await detail.getByText("材料日期记载不一", { exact: true }).waitFor();
  await detail.getByText("材料金额记载不一", { exact: true }).waitFor();
  await detail.getByRole("button", { name: /核对与标注.*当事人无争议/ }).waitFor();

  const comparison = catalog.getByRole("region", { name: "记载分歧" });
  const citedOriginal = page.getByRole("region", { name: "固定版本原文" });
  const dateSource = comparison.getByRole("button", { name: /2023-03-01 · 民事起诉状 · 当事人陈述/ });
  const amountSource = comparison.getByRole("button", { name: /500,000 元 · 民事起诉状 · 当事人陈述/ });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 820 });
    await comparison.getByRole("heading", { name: "发生日期" }).waitFor();
    await comparison.getByRole("heading", { name: "实际交付金额" }).waitFor();
    assert.equal(await comparison.getByText("480,000 元", { exact: true }).count(), 1);
    for (const [source, quote, caption] of [[dateSource, /2023 年 3 月 1 日/, "日期引文"], [amountSource, /50 万元/, "金额引文"]]) {
      await source.scrollIntoViewIfNeeded();
      assert(await source.evaluate(button => {
        const rect = button.getBoundingClientRect();
        const panel = button.closest('[aria-label="要点与出处"]').getBoundingClientRect();
        return rect.left >= panel.left && rect.right <= panel.right && rect.right <= innerWidth;
      }));
      await source.click();
      await citedOriginal.getByRole("heading", { name: "民事起诉状" }).waitFor();
      await citedOriginal.locator("mark").filter({ hasText: quote }).waitFor();
      assert.equal(await citedOriginal.locator("mark").count(), 1);
      await citedOriginal.getByText(caption, { exact: true }).waitFor();
      const metadata = citedOriginal.getByText("第 1 版 · 文本摘录", { exact: true });
      assert.match(await metadata.getAttribute("title"), /1.+183/);
      const actions = citedOriginal.getByRole("link", { name: /^(查看原件|下载原件)$/ });
      assert.equal(await actions.count(), 2);
      for (const action of await actions.all()) {
        assert(await action.evaluate(element => {
          const panel = element.closest('[aria-label="固定版本原文"]').getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          const excerpt = element.closest('[aria-label="固定版本原文"]').querySelector("figure").getBoundingClientRect();
          return rect.bottom <= excerpt.top && rect.left >= panel.left && rect.right <= panel.right;
        }));
      }
      const related = citedOriginal.getByRole("button", { name: /^关联事实 · / });
      assert.equal(await related.getAttribute("aria-expanded"), "false");
      await related.click();
      await citedOriginal.getByRole("button", { name: "出借人交付借款", exact: true }).waitFor();
      await citedOriginal.getByRole("button", { name: "返回事实" }).click();
      assert(await source.evaluate(button => document.activeElement === button));
    }
  }
  await sources.click();
  await dateSource.waitFor({ state: "hidden" });
  await sources.click();
  await page.setViewportSize({ width: 1440, height: 820 });
  const receipt = catalog.getByRole("button", { name: "银行转账回单", exact: true });
  await receipt.click();
  const receiptExcerpt = catalog.locator('[aria-label="原文引文"] blockquote');
  await receiptExcerpt.waitFor();
  assert.equal(await receiptExcerpt.count(), 1);
  assert.deepEqual(await receiptExcerpt.locator("mark").allTextContents(), ["2023-03-03", "480,000.00"]);
  assert.match(await receiptExcerpt.textContent(), /张三.*李四/);
  const addRecord = catalog.getByRole("button", { name: "新增记载", exact: true });
  const readRecord = catalog.getByRole("button", { name: "查看原文", exact: true });
  await addRecord.waitFor();
  assert(await addRecord.evaluate(button => [...button.parentElement.querySelectorAll("button")]
    .some(sibling => sibling.textContent.trim() === "查看原文")));
  await addRecord.click();
  const recordEditor = page.getByRole("dialog", { name: "新增记载", exact: true });
  await recordEditor.waitFor();
  assert.match(await recordEditor.getByRole("textbox", { name: "记载的固定原文", exact: true }).inputValue(), /480,000.00/);
  await page.keyboard.press("Escape");
  await recordEditor.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "新增记载");
  await readRecord.click();
  await original.getByRole("heading", { name: "银行转账回单" }).waitFor();
  await original.getByRole("button", { name: "返回事实", exact: true }).click();

  if (process.argv.includes("--cross-case")) {
    const { items } = await page.evaluate(async id => {
      const response = await fetch("/api/personal/matter-workspace?section=evidence-items&timeline=1&matter=" + id);
      if (!response.ok) throw new Error("Could not read the cross-case timeline: " + response.status);
      return response.json();
    }, otherMatter.id);
    const loan = items.find(item => item.title.startsWith("出借人交付借款 · V8 ") && item.sources.length === 3 &&
      item.sources.every(source => item.observations?.some(entry => entry.sourceId === source.id)));
    assert(loan, "Seed the V8 cross-case smoke data before running --cross-case.");
    const scenarios = [
      { title: "V8核验 · 核对现场交接", pageNumber: 1 },
      { title: loan.title },
      { title: "V8核验 · 分批开展性能测试", pageNumber: 2 },
      { title: "V8核验 · 口头说明日期待核" },
    ];
    await page.setViewportSize({ width: 1440, height: 820 });
    await openCase(otherMatter);
    await page.waitForURL(url => url.pathname.startsWith("/matters/" + otherMatter.id));
    if (await group.getAttribute("aria-expanded") === "false") await group.click();
    await graphLink.click();
    await page.waitForURL(desktopOrigin + "/matters/" + otherMatter.id + "/evidence/graph");
    await page.getByRole("tab", { name: "时间轴", exact: true }).click();
    const search = page.getByRole("textbox", { name: "搜索事实和出处", exact: true });
    const fileRows = catalog.locator('ol > li button[data-slot="collapsible-trigger"]');
    for (const { title, pageNumber } of scenarios) {
      const item = items.find(row => row.title === title);
      assert(item, title);
      if (pageNumber) assert.deepEqual(item.sources.map(source => source.locationLabel), ["第 " + pageNumber + " 页"]);
      await search.fill(title);
      await table.getByRole("button", { name: title, exact: true }).click();
      await detail.getByRole("heading", { name: title, exact: true }).waitFor();
      assert.deepEqual(await fileRows.locator("span:first-of-type").allTextContents(), item.sources.map(source => source.documentName));
      if (!item.sources.length) {
        const empty = catalog.getByText("尚未关联出处。", { exact: true });
        await empty.waitFor();
        const linkSource = catalog.getByRole("button", { name: "关联来源", exact: true });
        assert(await linkSource.evaluate(button => button.parentElement.textContent.includes("尚未关联出处。")));
        assert.equal(await catalog.getByRole("button", { name: "材料记录操作", exact: true }).count(), 0);
        await linkSource.click();
        const linkDialog = page.getByRole("dialog", { name: "关联材料版本", exact: true });
        await linkDialog.waitFor();
        await page.keyboard.press("Escape");
        await linkDialog.waitFor({ state: "hidden" });
        await empty.waitFor();
        console.log("PASS cross-case: " + title + " → empty state and link-source dialog");
      }
      for (const source of item.sources) {
        const row = fileRows.filter({ has: page.getByText(source.documentName, { exact: true }) });
        await row.click();
        assert.equal(await row.getAttribute("aria-expanded"), "true");
        const records = item.observations?.filter(entry => entry.sourceId === source.id) ?? [];
        const wholeSource = catalog.getByRole("button", { name: /^查看固定原文 · / });
        const display = records.length ? catalog.getByRole("button", { name: "查看原文", exact: true }).first() : wholeSource;
        await display.waitFor();
        if (records.length > 1) {
          assert.equal(await catalog.getByRole("button", { name: "新增记载", exact: true }).count(), 1);
          await wholeSource.waitFor();
        } else if (pageNumber) {
          assert.equal(await catalog.getByRole("button", { name: "新增记载", exact: true }).count(), 0);
        }
        const pdfResponse = pageNumber && page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.pathname.endsWith("/documents/" + source.documentId + "/download") && url.searchParams.get("inline") === "1";
        });
        await display.click();
        await original.getByRole("heading", { name: source.documentName, exact: true }).waitFor();
        const location = pageNumber ? source.locationLabel : "文本摘录";
        const metadata = original.getByText("第 " + source.documentVersion + " 版 · " + location, { exact: true });
        await metadata.waitFor();
        if (pageNumber) {
          const pdf = original.locator('iframe[title="固定版本原文"]');
          assert.equal(new URL(await pdf.getAttribute("src"), desktopOrigin).hash, "#page=" + pageNumber);
          const response = await pdfResponse;
          assert(response.ok() || response.status() === 304, "PDF response " + response.status());
        } else {
          assert.deepEqual((await metadata.getAttribute("title")).match(/\d+/g), source.locationLabel.match(/\d+/g));
          const observation = item.observations.find(entry => entry.sourceId === source.id);
          const quote = observation.data.excerpt?.text ?? observation.data.date?.text ?? observation.data.amount?.text;
          assert(quote, source.documentName);
          await original.locator("mark").filter({ hasText: quote }).first().waitFor();
        }
        await original.getByRole("button", { name: "返回事实", exact: true }).click();
        assert.equal(await row.getAttribute("aria-expanded"), "true");
        await row.click();
        console.log("PASS cross-case: " + title + " → " + source.documentName + " · " + source.locationLabel);
      }
    }
  }

  assert.deepEqual(errors, []);
  console.log("PASS WebView2: graph navigation, select and scroll, container-driven layout, narrow fact focus, source differences, date/amount citations and party dispute");
}
