import assert from "node:assert/strict";
import { seedChronologyScale } from "./chronology-scale.mjs";

export async function verifyWebView2Scale(page, desktopOrigin, casebookRoot) {
  // The request client shares the test WebView's real local workspace session.
  const api = page.context().request;
  const request = async (route, body) => {
    assert(route.startsWith("/api/") && !route.startsWith("//"));
    const response = await api.fetch(desktopOrigin + route, {
      method: body ? "POST" : "GET", headers: { Origin: desktopOrigin },
      ...(body instanceof FormData ? { multipart: body } : body && { data: body }),
      maxRedirects: 0, timeout: 45_000,
    });
    if (!response.ok()) {
      const { error } = await response.json().catch(() => ({}));
      throw new Error(route.split("?")[0] + " returned " + response.status() + (error ? " · " + error : ""));
    }
    return response;
  };
  const sample = await seedChronologyScale(request, casebookRoot);
  console.log("PASS synthetic native workbench fixture: " + JSON.stringify({
    matterId: sample.matterId, timeline: sample.timeline, sourceMs: sample.sourceMs,
  }));

  await page.setViewportSize({ width: 1440, height: 900 });
  const axis = page.getByRole("region", { name: "时间轴事件", exact: true });
  const bucket = axis.getByRole("button", { name: / · 100 项(?: ·|$)/ });
  const graphPath = desktopOrigin + "/matters/" + sample.matterId + "/evidence/graph";
  const started = performance.now();
  await page.goto(graphPath, { waitUntil: "domcontentloaded" });
  await bucket.waitFor();
  const firstInteractiveMs = Math.round(performance.now() - started);
  await bucket.click();
  const picker = page.getByRole("dialog", { name: "同时间段事项" });
  await picker.waitFor();
  assert.equal(await picker.getByRole("button").count(), 100);
  const overflow = await picker.evaluate(panel => panel.scrollHeight > panel.clientHeight);
  assert(overflow, "The 100-event list should scroll inside its own panel.");
  await picker.getByRole("button", { name: /^合成图谱事项 100/ }).click();

  const detail = page.getByRole("region", { name: "要点与出处", exact: true });
  await detail.getByRole("heading", { name: "合成图谱事项 100", exact: true }).waitFor();
  const facts = page.getByRole("table", { name: "案件事实与出处", exact: true });
  await facts.getByRole("row").filter({ hasText: "合成图谱事项 100" }).waitFor();
  const detailWidth = await detail.evaluate(panel => Math.round(panel.getBoundingClientRect().width));
  const viewport = detail.locator('[data-slot="scroll-area-viewport"]');
  await viewport.waitFor();
  assert.equal(await detail.evaluate(panel => getComputedStyle(panel).position), "sticky");
  const material = detail.getByRole("region", { name: "材料记录", exact: true })
    .getByRole("button", { name: sample.sourceName, exact: true });
  if (await material.getAttribute("aria-expanded") !== "true") await material.click();
  await detail.getByRole("button", { name: "查看固定原文 · " + sample.sourceName, exact: true }).click();
  const original = page.getByRole("region", { name: "固定版本原文", exact: true });
  await original.getByRole("heading", { name: sample.sourceName, exact: true }).waitFor();
  await original.getByText(sample.sourceQuote, { exact: false }).first().waitFor();
  const originalViewport = original.locator('[data-slot="scroll-area-viewport"]');
  await page.waitForFunction(() => {
    const panel = document.querySelector('[aria-label="固定版本原文"]');
    const body = panel?.querySelector('[data-slot="scroll-area-viewport"]');
    return !!body && body.scrollHeight > body.clientHeight;
  });
  assert(await originalViewport.evaluate(body => {
    const top = window.scrollY;
    body.scrollTop = body.scrollHeight;
    return body.scrollTop > 0 && window.scrollY === top;
  }), "The original detail body must scroll independently of the page.");
  await original.getByRole("button", { name: "返回事实", exact: true }).click();
  await detail.getByRole("heading", { name: "合成图谱事项 100", exact: true }).waitFor();

  const dateRange = axis.getByRole("group", { name: "时间范围" });
  const beforeDrag = await dateRange.textContent();
  const overview = axis.locator('[aria-label="缩略时间带"]');
  await overview.scrollIntoViewIfNeeded();
  const bounds = await overview.boundingBox();
  assert(bounds && bounds.width > 180);
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + bounds.width * 0.24, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.62, y, { steps: 12 });
  await page.mouse.up();
  assert.notEqual(await dateRange.textContent(), beforeDrag);
  assert.equal(await axis.locator('[data-slot="timeline-boundary"]').count(), 2);
  await dateRange.getByRole("button", { name: "全时段", exact: true }).click();
  assert.equal(await dateRange.textContent(), beforeDrag);

  await axis.getByRole("combobox", { name: "时间轴泳道" }).click();
  await page.getByRole("option", { name: "按办理程序", exact: true }).click();
  const lanes = axis.locator('[data-slot="timeline-track"]');
  await lanes.filter({ hasText: "规模验收一审" }).waitFor();
  await lanes.filter({ hasText: "规模验收财产保全" }).waitFor();
  assert.equal(await lanes.count(), 3);
  await axis.getByRole("button", { name: "回放", exact: true }).click();
  await axis.getByRole("status").filter({ hasText: /^回放 1 \/ 112$/u }).waitFor();
  await axis.getByRole("button", { name: "下一步", exact: true }).click();
  await axis.getByRole("status").filter({ hasText: /^回放 2 \/ 112$/u }).waitFor();
  await axis.getByRole("button", { name: "退出回放", exact: true }).click();
  await axis.getByRole("button", { name: "回放", exact: true }).waitFor();

  await page.getByRole("tab", { name: "对照矩阵", exact: true }).click();
  await page.getByRole("table", { name: "各份材料与事实要点的出处对照" }).waitFor();
  await page.setViewportSize({ width: 390, height: 820 });
  await page.getByRole("tab", { name: "事实经过", exact: true }).click();
  const undated = page.getByRole("list", { name: "日期未明与来源受限的事项" });
  await undated.waitFor();
  assert.equal(await undated.getByRole("listitem").count(), 5);
  await undated.getByRole("button", { name: /合成图谱事项 115/ }).click();
  await detail.getByRole("heading", { name: "合成图谱事项 115", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const panel = document.querySelector('[aria-label="要点与出处"]');
    const heading = panel?.querySelector("h2");
    const bounds = heading?.getBoundingClientRect();
    return !!bounds && bounds.top >= 0 && bounds.bottom <= innerHeight &&
      document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
      panel === document.activeElement;
  }, undefined, { timeout: 5000 }).catch(async error => {
    const observed = await detail.evaluate(panel => ({
      width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      innerWidth, heading: panel.querySelector("h2")?.getBoundingClientRect().toJSON(),
      focused: panel === document.activeElement,
    }));
    throw new Error("Narrow fact detail: " + JSON.stringify(observed), { cause: error });
  });
  const narrowWidth = await page.evaluate(() => document.documentElement.clientWidth);
  console.log("PASS WebView2 scale: " + JSON.stringify({
    firstInteractiveMs, detailWidth, datedReplaySteps: 112, undated: 5, narrowWidth,
  }));
}
