import assert from "node:assert/strict";
import { seedChronologyScale } from "./chronology-scale.mjs";

export async function verifyWebKitChronologyLayout({ request, casebookRoot, navigate, execute, click, visible, waitFor }) {
  const sample = await seedChronologyScale(request, casebookRoot);
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

  const openLabel = "查看固定原文 · " + sample.sourceName;
  const openButton = facts + " button[aria-label]";
  const reveal = async (selector, label) => execute(`
    const target = [...document.querySelectorAll(arguments[0])].find(node =>
      node.getAttribute("aria-label") === arguments[1] || node.textContent.trim() === arguments[1]);
    if (!target) return false;
    target.scrollIntoView({ block: "nearest" });
    return true;
  `, selector, label);
  await waitFor("open the fixed-version control", () => reveal(openButton, openLabel));
  await click(openButton, openLabel, "aria-label", true);

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
      active.getAttribute("aria-label") === arguments[1];
  `, facts, openLabel));
  console.log("CHRONICLE_WEBKIT_WIDE_LAYOUT " + JSON.stringify({
    viewport: await execute("return [innerWidth, innerHeight]"), firstInteractiveMs, detailWidth: panel.detailWidth,
    aggregatedEvents: 100, sourceVersion: 1, sourceName: sample.sourceName, sourceMs: sample.sourceMs,
    timelineReads: sample.timeline, modelCalls: sample.modelCalls,
  }));
  return true;
}
