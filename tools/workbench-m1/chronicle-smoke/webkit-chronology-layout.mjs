import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { seedChronologyScale } from "./chronology-scale.mjs";

export async function verifyWebKitChronologyLayout({ request, casebookRoot, navigate, execute, click, visible, waitFor, resize, screenshot }) {
  const sample = await seedChronologyScale(request, casebookRoot);
  const saved = await (await request("/api/personal/matter-workspace", {
    action: "record-evidence-observation", matterId: sample.matterId, data: {
      evidenceItemId: sample.evidenceItemId, sourceId: sample.sourceId, expectedRevision: sample.revision,
      requestKey: randomUUID(), observation: { statement: "RECORD", excerpt: { start: 0, end: sample.sourceQuote.length } },
    },
  })).json();
  assert.equal(saved.ok, true);
  const started = performance.now();
  await navigate("/matters/" + sample.matterId + "/evidence/graph");
  const bucketSelector = '[aria-label="时间轴事件"] button[aria-label]';
  const bucket = await waitFor("100-item timeline group", () => execute(`
    return [...document.querySelectorAll(arguments[0])].map(node => node.getAttribute("aria-label"))
      .find(label => / · 100 项(?: ·|$)/.test(label)) ?? null;
  `, bucketSelector));
  const firstInteractiveMs = Math.round(performance.now() - started);
  await click(bucketSelector, bucket, "aria-label", true);

  const itemSelector = '[aria-label="同时间段事项"] button[aria-label]';
  const item = await waitFor("scrollable 100-item picker", () => execute(`
    const items = [...document.querySelectorAll(arguments[0])];
    const target = items.find(node => node.getAttribute("aria-label").startsWith("合成图谱事项 100"));
    if (items.length !== 100 || !target) return null;
    const popup = target.closest('[aria-label="同时间段事项"]');
    if (popup.scrollHeight <= popup.clientHeight) return null;
    target.scrollIntoView({ block: "nearest" });
    return target.getAttribute("aria-label");
  `, itemSelector));
  await click(itemSelector, item, "aria-label", true);

  const facts = '[aria-label="要点与出处"]';
  const heading = facts + " h2";
  await waitFor("facts item 100", () => visible(heading, "合成图谱事项 100", true));
  const panel = await execute(`
    const details = document.querySelector(arguments[0]);
    const content = document.querySelector('[aria-label="时间轴事件"]');
    if (!details || !content) return null;
    const right = details.getBoundingClientRect();
    const left = content.getBoundingClientRect();
    return { position: getComputedStyle(details).position, sideBySide: right.left >= left.right - 1,
      detailWidth: Math.round(right.width), fits: right.right <= innerWidth + 1 &&
      document.documentElement.scrollWidth <= document.documentElement.clientWidth };
  `, facts);
  assert(panel?.position === "sticky" && panel.sideBySide && panel.fits,
    "The detail must fit in a sticky right column: " + JSON.stringify(panel));

  const sourceSection = facts + ' [aria-label="材料记录"]';
  const sourceButton = await waitFor("linked fixed version", () => execute(`
    const target = [...document.querySelectorAll(arguments[0] + ' button')].find(node =>
      node.getAttribute("aria-label") === arguments[1] || node.textContent.trim() === arguments[1]);
    if (!target) return null;
    target.scrollIntoView({ block: "nearest" });
    return { isOpen: target.getAttribute("aria-expanded") === "true", label: target.getAttribute("aria-label") };
  `, sourceSection, sample.sourceName));
  if (!sourceButton.isOpen) {
    await click(sourceSection + " button", sourceButton.label ?? sample.sourceName, sourceButton.label ? "aria-label" : undefined, true);
  }

  const openLabel = "查看原文";
  const openButton = sourceSection + " button";
  const reveal = async (selector, label) => execute(`
    const target = [...document.querySelectorAll(arguments[0])].find(node =>
      node.getAttribute("aria-label") === arguments[1] || node.textContent.trim() === arguments[1]);
    if (!target) return false;
    target.scrollIntoView({ block: "nearest" });
    return true;
  `, selector, label);
  await waitFor("open the fixed-version control", () => reveal(openButton, openLabel));
  await click(openButton, openLabel, undefined, true);

  const original = '[aria-label="固定版本原文"]';
  await waitFor("long fixed-source heading", () => visible(original + " h2", sample.sourceName, true));
  await waitFor("fixed source contains the expected quote and can scroll", () => execute(`
    const body = document.querySelector(arguments[0] + ' [data-slot="scroll-area-viewport"]');
    return !!body && body.textContent.includes(arguments[1]) && body.scrollHeight > body.clientHeight;
  `, original, sample.sourceQuote));
  const scroll = await execute(`
    const details = document.querySelector(arguments[0]);
    const body = details.querySelector('[data-slot="scroll-area-viewport"]');
    const pageStart = scrollY;
    const header = details.querySelector("header");
    const headerStart = header.getBoundingClientRect().top;
    body.scrollTop = body.scrollHeight;
    return { scrolled: body.scrollTop > 0, pageFixed: pageStart === scrollY,
      headerFixed: header.getBoundingClientRect().top === headerStart,
      fits: header.scrollWidth <= header.clientWidth + 1 };
  `, original);
  assert(scroll.scrolled && scroll.pageFixed && scroll.headerFixed && scroll.fits,
    "Fixed-source scrolling or the wrapping header is not contained: " + JSON.stringify(scroll));
  await click(original + " button", "返回事实", undefined, true);
  await waitFor("return to the same fact and source button", () => execute(`
    const details = document.querySelector(arguments[0]);
    const active = document.activeElement;
    return details?.querySelector('h2')?.textContent === "合成图谱事项 100" && details.contains(active) &&
      active.textContent.trim() === arguments[1];
  `, facts, openLabel));
  const wording = "对外措辞预览";
  await waitFor("audience wording control", () => reveal(facts + " button", wording));
  await click(facts + " button", wording, undefined, true);
  const checkWording = async () => execute(`
    const [panel, source, quote] = arguments;
    const client = document.querySelector(panel + ' [aria-label="给客户"]');
    const court = document.querySelector(panel + ' [aria-label="给法官"]');
    if (!client?.getClientRects().length || !court?.getClientRects().length) return null;
    const collapse = court.closest('[data-slot="collapsible-content"]');
    if (collapse.clientHeight < collapse.scrollHeight - 1) return null;
    const panelRight = document.querySelector(panel).getBoundingClientRect().right;
    return { client: client.textContent.includes(quote), court: court.textContent.includes("《" + source + "》V1"),
      distinct: client.textContent !== court.textContent,
      fits: [client, court].every(element => element.scrollWidth <= element.clientWidth + 1 &&
        element.getBoundingClientRect().right <= panelRight + 1) };
  `, facts, sample.sourceName, sample.sourceQuote);
  const wideWording = await waitFor("two audience drafts", checkWording);
  assert.deepEqual(wideWording, { client: true, court: true, distinct: true, fits: true });
  await execute(`document.querySelector(arguments[0] + ' [aria-label="给客户"]').scrollIntoView({ block: "start" });`, facts);
  await screenshot?.("wording-wide");

  console.log("CHRONICLE_WEBKIT_WIDE_LAYOUT " + JSON.stringify({
    viewport: await execute("return [innerWidth, innerHeight]"), firstInteractiveMs, detailWidth: panel.detailWidth,
    aggregatedEvents: 100, sourceVersion: 1, sourceName: sample.sourceName, sourceMs: sample.sourceMs,
    timelineReads: sample.timeline, modelCalls: sample.modelCalls,
  }));
  if (resize) {
    await resize(800, 850);
    const viewport = await waitFor("narrow WebKit", () => execute("return innerWidth <= 850 ? [innerWidth, innerHeight] : null"));
    await execute(`document.querySelector(arguments[0] + ' [aria-label="给法官"]').scrollIntoView({ block: "center" });`, facts);
    assert.deepEqual(await waitFor("narrow audience drafts", checkWording), wideWording);
    await screenshot?.("wording-narrow");
    console.log("CHRONICLE_WEBKIT_WORDING " + JSON.stringify({ viewport, ...wideWording }));
  }
  return true;
}
