// @vitest-environment node
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { changeMatterFolder } from "@/lib/runtime/matter-folders";
import { saveAiSettings } from "@/lib/ai/settings";
import { readMatterInputCoverage } from "@/server/ai/input-coverage-service";
import type { MatterAnalysisPlan } from "@/lib/ai/input-coverage";
import { resolvePersonalActor } from "@/server/runtime/personal";
import { uploadDocument } from "@/server/documents/actions";
import { processMaterialJob } from "@/server/documents/material-processing";
import { addEvidenceSource, adoptEvidenceObservationRun, adoptMatterObservations, createEvidenceItem } from "@/server/evidence/actions";
import { processObservationRun, queueMatterObservationRun, queueObservationRun, readMatterObservationExcerpt, readObservationRuns } from "@/server/evidence/analysis-runs";
import { observationJobKey } from "@/server/evidence/analysis-run-contract";
import { completeJob } from "@/server/cron/queue";
import { processDueJobs } from "@/server/cron/worker";
import { previewCaseGrouping, queueCaseGrouping, readCaseGrouping } from "@/server/evidence/case-grouping-runs";

const provider = vi.hoisted(() => ({
  url: "https://observation-fixture.invalid/v1",
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock("@/lib/net/safe-url", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/net/safe-url")>(),
  assertSafeHttpUrl: async (url: string) => {
    if (url !== provider.url) throw new Error("Unexpected fixture provider");
  },
  safeFetch: provider.fetch,
}));
vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({ user: await resolvePersonalActor(prisma) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const model = "fixture-observations";
const authorized = "2023年3月3日，转账金额48万元，转账后账户余额49万元。";
const original = "同一页其他信息：未授权的备注。\n" + authorized + "\n其他款项：余额50万元。";
const filing = "提交日期：2023年3月7日。";
const service = "送达日期：2023年3月6日。";
const observation = { fragment: 1, statement: "RECORD",
  date: { role: "OCCURRENCE", quote: { text: "2023年3月3日" } },
  amount: { nature: "ACTUAL_TRANSFER", quote: { text: "48万元" } },
};

describe.skipIf(process.env.LEXORDER_EVIDENCE_PGLITE_TEST !== "1")("个人版案内事实分析管线", () => {
  let work: string | undefined;
  let workspace: string | undefined;
  let database: { close(): Promise<void> } | undefined;
  let socket: { port: number; stop(): Promise<void> } | undefined;

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "lexorder-evidence-pipeline-"));
    workspace = path.join(work, "runtime");
    const tools = path.resolve("tools/workbench-m1");
    const requireTool = createRequire(path.join(tools, "package.json"));
    const { PGlite } = requireTool("@electric-sql/pglite");
    const { startPrivatePostgres } = await import(path.join(tools, "private-pg.mjs"));
    database = await PGlite.create();
    const password = randomBytes(32).toString("hex");
    socket = await startPrivatePostgres(database, password) as NonNullable<typeof socket>;
    const url = "postgresql://postgres:" + password + "@127.0.0.1:" + socket.port + "/postgres?sslmode=disable&connection_limit=1";
    await promisify(execFile)(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url }, timeout: 40_000,
    }).catch(error => { throw new Error(String(error.message).replaceAll(password, "[redacted]")); });
    const storage = path.join(workspace, "storage");
    await mkdir(storage, { recursive: true });
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("LEXORDER_RUNTIME_MODE", "PERSONAL");
    vi.stubEnv("LEXORDER_PERSONAL_ORIGIN", "http://127.0.0.1:4173");
    vi.stubEnv("LEXORDER_PERSONAL_CHANNEL_TOKEN", randomBytes(32).toString("hex"));
    vi.stubEnv("LEXORDER_PERSONAL_MANIFEST", path.join(workspace, "workspace.json"));
    vi.stubEnv("APP_STORAGE_DIR", storage);
    vi.stubEnv("STORAGE_PROVIDER", "local");
    vi.stubEnv("STORAGE_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const workspaceId = randomUUID();
    const actor = await prisma.user.create({ data: { name: "合成本机操作者", email: workspaceId + "@personal.invalid",
      passwordHash: "!personal-no-login", role: "INDEPENDENT_LAWYER", systemRole: "NONE" } });
    const manifest = { version: 2, mode: "PERSONAL", workspaceId, actorId: actor.id };
    await prisma.systemSetting.create({ data: { key: "personal-workspace", value: manifest } });
    await writeFile(path.join(workspace, "workspace.json"), JSON.stringify(manifest));
    vi.stubEnv("LEXORDER_PERSONAL_WORKSPACE_ID", workspaceId);
    vi.stubEnv("LEXORDER_PERSONAL_ACTOR_ID", actor.id);
    await saveAiSettings({ enabled: true, apiKey: "fixture-key", baseUrl: provider.url, textModel: model });
  }, 60_000);

  afterAll(async () => {
    if (process.env.LEXORDER_PERSONAL_MANIFEST === path.join(workspace ?? "", "workspace.json")) await prisma.$disconnect();
    await socket?.stop();
    await database?.close();
    vi.unstubAllEnvs();
    if (work) await rm(work, { recursive: true, force: true });
  });

  it("结构化人物关系进入固定出处和正式要点", async () => {
    const actor = await resolvePersonalActor(prisma);
    if (!actor || !workspace || !work) throw new Error("Missing fixture");
    const matter = await prisma.matter.create({ data: {
      title: "合成设备交付", internalCode: "SYNTHETIC-RELATION",
      ownerId: actor.id, registeredById: actor.id,
    } });
    const root = path.join(work, "relation-casebook");
    await mkdir(root, { recursive: true });
    await changeMatterFolder(matter, { action: "bind", root }, path.join(workspace, "storage"));
    const text = "青禾公司于2024年4月8日向远桥公司交付两台机床。";
    const form = new FormData();
    form.set("file", new File([text], "设备交付.txt", { type: "text/plain" }));
    form.set("name", "设备交付.txt");
    form.set("matterId", matter.id);
    form.set("requestKey", randomUUID());
    const saved = await uploadDocument(form);
    if (!saved.ok) throw new Error(saved.message);
    const parse = await prisma.documentParseRun.findFirstOrThrow({ where: { documentId: saved.id } });
    expect(await processDueJobs(1, "personal-materials")).toMatchObject({ succeeded: 1 });
    const parsed = await prisma.documentParseRun.findUniqueOrThrow({ where: { id: parse.id } });
    const [anchor] = parsed.anchors as { anchorId: string; text: string }[];
    expect(anchor.text).toBe(text);
    const run = await queueMatterObservationRun(actor, {
      matterId: matter.id, confirmed: true, model, origin: new URL(provider.url).origin, runId: randomUUID(),
      ranges: [{ documentId: saved.id, parseRunId: parse.id, anchorId: anchor.anchorId, start: 0, end: text.length }],
    });
    const record = {
      fragment: 1, firstLine: 1, lastLine: 1, title: "设备交付", category: "performance", kind: "FACT",
      statement: "RECORD", excerpt: null, dateRole: "OCCURRENCE", dateText: "2024年4月8日",
      amountNature: null, amountText: null, participants: ["青禾公司", "远桥公司"],
      relations: [{ kind: "DELIVERS_TO", from: 1, to: 2, quote: text }],
    };
    provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: {
      content: JSON.stringify({ observations: [{ ...record, firstLine: "1" }, record] }),
    } }] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readObservationRuns(actor, matter.id, null, run.id)).toMatchObject({
      state: "READY", receipt: { rejected: [{ index: 0, reason: "SCHEMA" }] },
      candidates: [{ data: { participants: [{ text: "青禾公司" }, { text: "远桥公司" }],
        relations: [{ kind: "DELIVERS_TO", from: 1, to: 2, text }] } }],
    });
    const adopted = await adoptMatterObservations({ matterId: matter.id, requestId: randomUUID(),
      chosen: [{ runId: run.id, index: 0 }], target: { type: "new", kind: "FACT", title: "设备交付", content: text },
    });
    const sync = await prisma.evidenceItem.findUniqueOrThrow({ where: { id: adopted.id } });
    const observation = await prisma.evidenceObservationRevision.findUniqueOrThrow({
      where: { id: sync.observationRevisionIds[0] }, include: { sourceLink: true },
    });
    expect(observation.sourceLink).toMatchObject({ documentId: saved.id, parseRunId: parse.id, anchorId: anchor.anchorId });
    expect(observation.data).toMatchObject({
      relations: [{ kind: "DELIVERS_TO", from: 1, to: 2, span: { start: 0, end: text.length }, text }],
    });
  }, 30_000);

  it.each(["txt", "xlsx"])("%s 原件入卷、解析、派发与逐条采用均绑定获准选区", async format => {
    provider.fetch.mockClear();
    const actor = await resolvePersonalActor(prisma);
    if (!actor || !workspace || !work) throw new Error("Missing fixture");
    const matter = await prisma.matter.create({ data: { title: "合成事实分析", internalCode: "SYNTHETIC-ANALYSIS-" + format,
      ownerId: actor.id, registeredById: actor.id } });
    const root = path.join(work, "casebook");
    await mkdir(root, { recursive: true });
    await changeMatterFolder(matter, { action: "bind", root }, path.join(workspace, "storage"));
    const name = "合成转账回单." + format;
    let file: File;
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("转账记录");
      sheet.getCell("B2").value = "字".repeat(6050) + "\r\n😀\r\n" + original + "\n" + filing;
      sheet.getCell("B3").value = "银行流水".repeat(5500);
      sheet.getCell("B4").value = "入账凭据".repeat(5500);
      file = new File([new Uint8Array(await workbook.xlsx.writeBuffer())], name, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    } else {
      file = new File([original], name, { type: "text/plain" });
    }
    async function lease(key: string) {
      const job = await prisma.jobQueue.findUniqueOrThrow({ where: { dedupeKey: key } });
      const leaseToken = randomUUID();
      await prisma.jobQueue.update({ where: { id: job.id, status: "PENDING" }, data: {
        status: "RUNNING", leaseToken, leaseUntil: new Date(Date.now() + 60_000),
      } });
      return { id: job.id, leaseToken };
    }
    async function ingest(file: File) {
      const form = new FormData();
      form.set("file", file);
      form.set("name", file.name);
      form.set("matterId", matter.id);
      form.set("requestKey", randomUUID());
      const saved = await uploadDocument(form);
      if (!saved.ok) throw new Error(saved.message);
      const parse = await prisma.documentParseRun.findFirstOrThrow({ where: { documentId: saved.id } });
      const parseJob = await lease("document.parse:" + parse.id);
      await processMaterialJob({ runId: parse.id }, parseJob);
      expect(await completeJob(parseJob)).toBe(true);
      const snapshot = await prisma.documentParseRun.findUniqueOrThrow({ where: { id: parse.id } });
      expect(snapshot.state).toBe("READY");
      const [anchor] = snapshot.anchors as { anchorId: string; text: string }[];
      return { documentId: saved.id, parseRunId: parse.id, anchor };
    }
    const { documentId, parseRunId, anchor } = await ingest(file);
    const event = await createEvidenceItem({ matterId: matter.id, requestKey: randomUUID(), title: "核对转账记载",
      content: "核对交易日和金额。", kind: "FACT" });
    const beforeLink = await prisma.evidenceItem.findUniqueOrThrow({ where: { id: event.id }, select: { revision: true } });
    const linked = await addEvidenceSource({ evidenceItemId: event.id, expectedRevision: beforeLink.revision,
      documentId, parseRunId, anchorId: anchor.anchorId, relation: "SUPPORTS" });
    const start = anchor.text.indexOf(authorized);
    expect(start).toBeGreaterThan(format === "xlsx" ? 6000 : 0);
    const ranges = [{ sourceId: linked.sourceId, start, end: start + authorized.length }];
    const texts = [authorized];
    const observations: unknown[] = [observation, { fragment: 1, statement: "RECORD", amount: { nature: "BALANCE", quote: { text: "49万元" } } }];
    let revision = linked.revision;
    let alternate: string | undefined;
    let casePlan: MatterAnalysisPlan | undefined;
    if (format === "xlsx") {
      const secondStart = anchor.text.indexOf(filing);
      expect(secondStart).toBeGreaterThan(ranges[0].end);
      ranges.push({ sourceId: linked.sourceId, start: secondStart, end: secondStart + filing.length });
      texts.push(filing);
      const notice = await ingest(new File([service], "合成送达记录.txt", { type: "text/plain" }));
      const preview = await readMatterInputCoverage(actor.id, { matterId: matter.id, purpose: "FACT_ANALYSIS",
        documents: [{ documentId }, { documentId: notice.documentId }] });
      casePlan = preview.analysisPlan;
      expect(preview.modelSupply).toEqual({ status: "NOT_SENT", sentChars: 0 });
      expect(preview.analysisPlan?.batches).toHaveLength(2);
      expect(preview.analysisPlan?.plannedCharacters).toBeGreaterThan(36_000);
      expect(preview.analysisPlan?.batches.flatMap(batch => batch.ranges).at(-1)).toMatchObject({
        documentId: notice.documentId, parseRunId: notice.parseRunId, start: 0, end: service.length,
      });
      expect(provider.fetch).not.toHaveBeenCalled();
      const second = await addEvidenceSource({ evidenceItemId: event.id, expectedRevision: revision,
        documentId: notice.documentId, parseRunId: notice.parseRunId, anchorId: notice.anchor.anchorId, relation: "SUPPORTS" });
      ranges.push({ sourceId: second.sourceId, start: 0, end: service.length });
      texts.push(service);
      observations.push(
        { fragment: 2, statement: "RECORD", date: { role: "FILING", quote: { text: "2023年3月7日" } } },
        { fragment: 3, statement: "RECORD", date: { role: "SERVICE", quote: { text: "2023年3月6日" } } },
      );
      const alias = await addEvidenceSource({ evidenceItemId: event.id, expectedRevision: second.revision,
        documentId, parseRunId, anchorId: anchor.anchorId, relation: "CONTEXT" });
      alternate = alias.sourceId;
      revision = alias.revision;
    }
    const input = { matterId: matter.id, evidenceItemId: event.id, expectedRevision: revision,
      confirmed: true as const, model, origin: new URL(provider.url).origin, ranges };

    const foreign = await prisma.matter.create({ data: { title: "其他合成案件", internalCode: "SYNTHETIC-FOREIGN-" + format, ownerId: actor.id } });
    await expect(queueObservationRun(actor, { ...input, matterId: foreign.id, runId: randomUUID() })).rejects.toThrow("要点不存在或不属于本案");
    if (format === "xlsx") {
      await expect(queueObservationRun(actor, { ...input, runId: randomUUID(), ranges: [
        { sourceId: linked.sourceId, start: 0, end: 6001 },
      ] })).rejects.toThrow("单段最多 6000 字符");
      expect(alternate).toBeDefined();
      await expect(queueObservationRun(actor, { ...input, runId: randomUUID(), ranges: [
        ranges[0], { ...ranges[0], sourceId: alternate! },
      ] })).rejects.toThrow("不可重复或重叠");
      await expect(queueObservationRun(actor, { ...input, runId: randomUUID(), ranges: [
        ranges[0], { ...ranges[0], start: start + 1 },
      ] })).rejects.toThrow("不可重复或重叠");
    }
    expect(provider.fetch).not.toHaveBeenCalled();

    const invalidRunIds = [];
    // One value is outside the granted selection. The other is present but expressly a balance.
    for (const text of ["50万元", "49万元"]) {
      const invalidRunId = randomUUID();
      invalidRunIds.push(invalidRunId);
      await queueObservationRun(actor, { ...input, runId: invalidRunId });
      provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
        observations: [{ ...observation, amount: { nature: "ACTUAL_TRANSFER", quote: { text } } }],
      }) } }] }));
      const invalidJob = await lease(observationJobKey(invalidRunId));
      await processObservationRun({ runId: invalidRunId }, invalidJob);
      expect(await completeJob(invalidJob)).toBe(true);
      expect(await readObservationRuns(actor, matter.id, event.id, invalidRunId)).toMatchObject({
        state: "FAILED", receipt: { error: "INVALID_RESULT" }, candidates: [],
      });
    }

    const runId = randomUUID();
    const queued = await queueObservationRun(actor, { ...input, runId });
    expect(await queueObservationRun(actor, { ...input, runId })).toEqual(queued);
    await expect(queueObservationRun(actor, { ...input, runId, ranges: [{ ...input.ranges[0], start: start + 1 }] }))
      .rejects.toThrow("此委托标识已绑定其他范围");
    provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({ observations }) } }],
      usage: { prompt_tokens: 240, completion_tokens: 80 } }));
    const job = await lease(observationJobKey(runId));
    await processObservationRun({ runId }, job);
    await processObservationRun({ runId }, job);
    expect(await completeJob(job)).toBe(true);
    expect(provider.fetch).toHaveBeenCalledTimes(3);
    for (const [url, options] of provider.fetch.mock.calls) {
      expect(url).toBe(provider.url + "/chat/completions");
      const body = JSON.parse(String(options?.body));
      expect(JSON.parse(body.messages[1].content)).toEqual({ title: "核对转账记载", fragments: texts.map((text, index) => ({ index: index + 1, text })) });
    }
    const ready = await readObservationRuns(actor, matter.id, event.id, runId);
    if (!("candidates" in ready)) throw new Error("Expected analysis batch detail");
    expect(ready).toMatchObject({
      state: "READY", receipt: { sentCharacters: texts.join("").length, usage: { inputTokens: 240, outputTokens: 80 } },
      sources: ranges.map(({ sourceId, start, end }) => ({ sourceId, start, end })),
    });
    expect(ready.candidates).toHaveLength(observations.length);
    expect(ready.candidates.slice(0, 2)).toMatchObject([
      { data: { date: { value: { precision: "EXACT", day: "2023-03-03" } }, amount: { value: { currency: "CNY", value: "480000" } } } },
      { data: { amount: { nature: "BALANCE", value: { currency: "CNY", value: "490000" } } } },
    ]);
    if (format === "xlsx") {
      expect(ready.candidates[2]).toMatchObject({ fragment: 2, data: {
        date: { role: "FILING", span: { start: anchor.text.indexOf("2023年3月7日") } },
      } });
    }
    expect((await prisma.evidenceItem.findUniqueOrThrow({ where: { id: event.id } })).observationRevisionIds).toEqual([]);
    const chosen = [format === "xlsx" ? 3 : 0];
    const adoption = { matterId: matter.id, evidenceItemId: event.id, expectedRevision: revision, runId, chosen };
    for (const invalidRunId of invalidRunIds) {
      await expect(adoptEvidenceObservationRun({ ...adoption, runId: invalidRunId })).rejects.toThrow("仅可采用当前要点版本中已生成的待核稿");
    }
    const adopted = await adoptEvidenceObservationRun(adoption);
    expect(await adoptEvidenceObservationRun(adoption)).toEqual(adopted);
    expect(adopted.observationIds).toHaveLength(1);
    const savedObservation = await prisma.evidenceObservationRevision.findUniqueOrThrow({ where: { id: adopted.observationIds[0] } });
    expect(savedObservation.sourceLinkId).toEqual(ranges[format === "xlsx" ? 2 : 0].sourceId);
    await expect(adoptEvidenceObservationRun({ ...adoption, chosen: [1] })).rejects.toThrow("该批次已按其他选择采用");
    expect((await prisma.evidenceItem.findUniqueOrThrow({ where: { id: event.id } })).observationRevisionIds).toEqual(adopted.observationIds);
    expect(await readObservationRuns(actor, matter.id, event.id, runId)).toMatchObject({ state: "ADOPTED", adoption: { chosen } });
    expect(provider.fetch).toHaveBeenCalledTimes(3);
    if (casePlan) {
      const batch = casePlan.batches[0];
      const fixed = batch.ranges.map(({ documentId, parseRunId, anchorId, start, end }) =>
        ({ documentId, parseRunId, anchorId, start, end }));
      const request = { confirmed: true as const, matterId: matter.id, model, origin: new URL(provider.url).origin, ranges: fixed };
      await expect(queueMatterObservationRun(actor, { ...request, matterId: foreign.id, runId: randomUUID() })).rejects.toThrow("不属于本案");
      const [queued, same] = await Promise.all([
        queueMatterObservationRun(actor, { ...request, runId: randomUUID() }),
        queueMatterObservationRun(actor, { ...request, runId: randomUUID() }),
      ]);
      expect(same.id).toBe(queued.id);
      const job = await lease(observationJobKey(queued.id));
      const source = fixed.findIndex(range => range.documentId === documentId && range.anchorId === anchor.anchorId && range.start <= start && range.end >= start + authorized.length);
      expect(source).toBeGreaterThanOrEqual(0);
      provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
        observations: [{ ...observation, fragment: source + 1 },
          { fragment: source + 1, statement: "RECORD", amount: { nature: "BALANCE", quote: { text: "49万元" } } }],
      }) } }],
        usage: { prompt_tokens: 300, completion_tokens: 70 } }));
      await processObservationRun({ runId: queued.id }, job);
      expect(await completeJob(job)).toBe(true);
      expect(await readObservationRuns(actor, matter.id, null, queued.id)).toMatchObject({
        state: "READY", receipt: { sentCharacters: batch.characters, usage: { inputTokens: 300, outputTokens: 70 } },
        sources: fixed.map(range => ({ sourceId: null, start: range.start, end: range.end })),
        candidates: [{ fragment: source + 1, data: { amount: { value: { currency: "CNY", value: "480000" } } } },
          { fragment: source + 1, data: { amount: { value: { currency: "CNY", value: "490000" } } } }],
        caseAdoptions: [], canAdopt: true,
      });
      expect(await queueMatterObservationRun(actor, { ...request, runId: randomUUID() })).toMatchObject({ id: queued.id, state: "READY" });
      await expect(readObservationRuns(actor, foreign.id, null, queued.id)).rejects.toThrow("不属于当前事项");
      const later = await queueMatterObservationRun(actor, { ...request, runId: randomUUID(),
        ranges: casePlan.batches[1].ranges.map(({ documentId, parseRunId, anchorId, start, end }) =>
          ({ documentId, parseRunId, anchorId, start, end })),
      });
      const laterJob = await lease(observationJobKey(later.id));
      provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
        observations: [{ fragment: casePlan.batches[1].ranges.length, statement: "RECORD",
          date: { role: "SERVICE", quote: { text: "2023年3月6日" } } }],
      }) } }] }));
      await processObservationRun({ runId: later.id }, laterJob);
      expect(await completeJob(laterJob)).toBe(true);

      const laterFragment = casePlan.batches[1].ranges.length;
      expect(await readMatterObservationExcerpt(actor, matter.id, later.id, laterFragment)).toEqual({ text: service });
      await expect(readMatterObservationExcerpt(actor, matter.id, later.id, laterFragment + 1)).rejects.toThrow("不属于本批次");
      await expect(readMatterObservationExcerpt(actor, foreign.id, later.id, laterFragment)).rejects.toThrow("不属于当前事项");

      const selection = [{ runId: queued.id, index: 0 }, { runId: later.id, index: 0 }];
      const current = await prisma.evidenceItem.findUniqueOrThrow({ where: { id: event.id }, include: { sources: true } });
      const existing = { type: "existing" as const, evidenceItemId: event.id, expectedRevision: current.revision };
      const save = { matterId: matter.id, requestId: randomUUID(), target: existing, chosen: selection };
      await expect(adoptMatterObservations({ ...save, chosen: [...selection, selection[0]] })).rejects.toThrow("同一候选");
      await expect(adoptMatterObservations({ ...save, matterId: foreign.id })).rejects.toThrow("不属于本案");
      await expect(adoptMatterObservations({ ...save, chosen: [{ runId: queued.id, index: 79 }] })).rejects.toThrow("不在此批次");
      await expect(adoptMatterObservations({ ...save, target: { ...existing, expectedRevision: current.revision - 1 } })).rejects.toThrow("已有新修订");
      const noticeId = casePlan.batches[1].ranges.at(-1)!.documentId;
      await prisma.document.update({ where: { id: noticeId }, data: { deletedAt: new Date() } });
      await expect(adoptMatterObservations(save)).rejects.toThrow("已撤回");
      await expect(readMatterObservationExcerpt(actor, matter.id, later.id, laterFragment)).rejects.toThrow("已撤回");
      expect(await prisma.caseObservationAdoption.count({ where: { id: save.requestId } })).toBe(0);
      await prisma.document.update({ where: { id: noticeId }, data: { deletedAt: null } });

      const route = await import("@/app/api/personal/matter-workspace/route");
      const origin = process.env.LEXORDER_PERSONAL_ORIGIN!;
      const endpoint = origin + "/api/personal/matter-workspace";
      const headers = { Host: new URL(origin).host, Origin: origin, Cookie: "lexorder_local_channel=" + process.env.LEXORDER_PERSONAL_CHANNEL_TOKEN };
      const savedResponse = await route.POST(new Request(endpoint, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adopt-matter-observations", data: save }),
      }));
      expect(savedResponse.status).toBe(200);
      const grouped = await savedResponse.json();
      expect(grouped).toEqual({ ok: true, id: event.id, revision: current.revision + 1 });
      expect(await adoptMatterObservations({ ...save, chosen: [...selection].reverse() })).toEqual(grouped);
      await expect(adoptMatterObservations({ ...save, chosen: [selection[0]] })).rejects.toThrow("另一组候选");
      await expect(adoptMatterObservations({ ...save, requestId: randomUUID() })).rejects.toThrow("已被采用");
      const appended = await prisma.evidenceItem.findUniqueOrThrow({ where: { id: event.id }, include: { sources: true } });
      expect(appended.observationRevisionIds).toHaveLength(current.observationRevisionIds.length + 2);
      expect(appended.sources.map(source => source.id).sort()).toEqual(current.sources.map(source => source.id).sort());
      const savedRows = await prisma.evidenceObservationRevision.findMany({
        where: { id: { in: appended.observationRevisionIds.slice(-2) } }, include: { sourceLink: true },
      });
      expect(savedRows.map(row => row.sourceLink.documentId).sort()).toEqual([documentId, noticeId].sort());
      expect(await prisma.evidenceItemRevision.findUnique({
        where: { evidenceItemId_revision: { evidenceItemId: event.id, revision: current.revision } },
      })).toMatchObject({ observationRevisionIds: current.observationRevisionIds });
      expect(await readObservationRuns(actor, matter.id, null, queued.id)).toMatchObject({
        state: "READY", caseAdoptions: [{ index: 0, evidenceItemId: event.id, revision: grouped.revision }],
      });

      const fresh = { matterId: matter.id, requestId: randomUUID(), chosen: [{ runId: queued.id, index: 1 }],
        target: { type: "new" as const, title: "合成账户余额待核", content: "需要核对余额的含义。", kind: "TODO_VERIFY" as const } };
      const created = await adoptMatterObservations(fresh);
      expect(await adoptMatterObservations(fresh)).toEqual(created);
      expect(await prisma.evidenceItem.findUniqueOrThrow({ where: { id: created.id }, include: { sources: true } })).toMatchObject({
        revision: 1, kind: "TODO_VERIFY", confirmedAt: null, sources: [{ relation: "CONTEXT", documentId, parseRunId, anchorId: anchor.anchorId }],
      });

      const unavailable = await queueMatterObservationRun(actor, { ...request, runId: randomUUID(), ranges: fixed.slice(0, 1) });
      await saveAiSettings({ enabled: false });
      const unavailableJob = await lease(observationJobKey(unavailable.id));
      await processObservationRun({ runId: unavailable.id }, unavailableJob);
      expect(await completeJob(unavailableJob)).toBe(true);
      expect(await readObservationRuns(actor, matter.id, null, unavailable.id)).toMatchObject({
        state: "FAILED", receipt: { error: "UNAVAILABLE" }, candidates: [],
      });
      await prisma.evidenceObservationRun.createMany({ data: Array.from({ length: 21 }, () => ({
        id: randomUUID(), authorId: actor.id, caseMatterId: matter.id, methodVersion: "matter-observations/1",
        model, baseUrl: provider.url, state: "FAILED", ranges: fixed.slice(0, 1), createdAt: new Date("2024-11-20T00:00:00Z"),
      })) });
      const page = await readObservationRuns(actor, matter.id, null);
      if (!("runs" in page) || !page.nextCursor) throw new Error("Expected the first page of case batches");
      expect(page.runs).toHaveLength(20);
      expect(page.nextCursor).toBe(page.runs?.at(-1)?.id);
      const params = new URLSearchParams({ matter: matter.id, section: "evidence-items", analysis: "case", runCursor: page.nextCursor });
      const olderResponse = await route.GET(new Request(endpoint + "?" + params, { headers }));
      expect(olderResponse.status).toBe(200);
      const older: { runs: { id: string }[]; nextCursor: string | null } = await olderResponse.json();
      expect(older.runs).toHaveLength(4);
      expect(older.nextCursor).toBeNull();
      expect(new Set([...page.runs, ...older.runs].map(batch => batch.id)).size).toBe(24);
      await expect(readObservationRuns(actor, matter.id, null, undefined, runId)).rejects.toThrow("分页位置不属于");
      expect(provider.fetch).toHaveBeenCalledTimes(5);
    }
  }, 60_000);

  it.skipIf(!process.env.LEXORDER_V8_GROUPING_SAMPLE)("V8 借贷示例跨批归并保留三方原文与金额冲突", async () => {
    provider.fetch.mockClear();
    const actor = await resolvePersonalActor(prisma);
    if (!actor || !workspace || !work) throw new Error("Missing fixture");
    await saveAiSettings({ enabled: true, apiKey: "fixture-key", baseUrl: provider.url, textModel: model });
    const matter = await prisma.matter.create({ data: {
      title: "V8 借贷归并示例", internalCode: "SYNTHETIC-V8-GROUP", ownerId: actor.id, registeredById: actor.id,
    } });
    const root = path.join(work, "v8-group-casebook");
    await mkdir(root, { recursive: true });
    await changeMatterFolder(matter, { action: "bind", root }, path.join(workspace, "storage"));

    const ranges = [];
    for (const name of ["4-bank-receipt.txt", "2-complaint.txt", "3-defence.txt", "1-iou.txt"]) {
      const contents = await readFile(path.join(process.env.LEXORDER_V8_GROUPING_SAMPLE!, name), "utf8");
      const form = new FormData();
      form.set("file", new File([contents], name, { type: "text/plain" }));
      form.set("name", name);
      form.set("matterId", matter.id);
      form.set("requestKey", randomUUID());
      const saved = await uploadDocument(form);
      if (!saved.ok) throw new Error(saved.message);
      const run = await prisma.documentParseRun.findFirstOrThrow({ where: { documentId: saved.id } });
      expect(await processDueJobs(1, "personal-materials")).toMatchObject({ succeeded: 1 });
      const parsed = await prisma.documentParseRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(parsed.state).toBe("READY");
      const [anchor] = parsed.anchors as { anchorId: string; text: string }[];
      ranges.push({ documentId: saved.id, parseRunId: run.id, anchorId: anchor.anchorId, start: 0, end: anchor.text.length });
    }
    const supply = { matterId: matter.id, confirmed: true as const, model, origin: new URL(provider.url).origin };
    function reply(data: object) {
      return Response.json({ choices: [{ message: { content: JSON.stringify(data) } }],
        usage: { prompt_tokens: 875, completion_tokens: 190 } });
    }
    function transfer(fragment: number, date: string, amount: string, bank = false, context?: string) {
      return { fragment, statement: bank ? "RECORD" : "PARTY_STATEMENT",
        date: { role: "OCCURRENCE", quote: { text: date } },
        amount: { nature: "ACTUAL_TRANSFER", quote: { text: amount, ...(context && { context }) },
          ...(bank && { unit: { text: "金额（元）" } }) } };
    }
    const a = await queueMatterObservationRun(actor, { ...supply, runId: randomUUID(), ranges: ranges.slice(0, 2) });
    const receiptLine = "2023-03-03 ｜ 张三 ｜ 李四 ｜ 480,000.00 ｜ 借款";
    const loanClause = "被告李四向原告借款 50 万元，原告当日交付";
    provider.fetch.mockResolvedValueOnce(reply({ observations: [
      { ...transfer(1, "2023-03-03", "480,000.00", true), participants: [
        { quote: { text: "张三" } }, { quote: { text: "李四" } },
      ], relations: [{ kind: "PAYS_TO", from: 1, to: 2, quote: { text: receiptLine } }] },
      { ...transfer(2, "2023 年 3 月 1 日", "50 万元", false, "向原告借款 50 万元，原告当日交付"), participants: [
        { quote: { text: "原告", context: "向原告借款" } }, { quote: { text: "李四", context: "被告李四向原告借款" } },
      ], relations: [{ kind: "LENDS_TO", from: 1, to: 2, quote: { text: loanClause } }] },
    ] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    const b = await queueMatterObservationRun(actor, { ...supply, runId: randomUUID(), ranges: ranges.slice(2) });
    provider.fetch.mockResolvedValueOnce(reply({ observations: [
      { ...transfer(1, "2023年3月3日", "48万元", false, "收到借款48万元"), participants: [
        { quote: { text: "李四", context: "答辩人：李四。" } },
      ] },
      { fragment: 2, statement: "RECORD", amount: { nature: "AGREED_PRINCIPAL", quote: { text: "人民币伍拾万元整" } } },
    ] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    const selected = [a.id, b.id].flatMap(runId => [0, 1].map(index => ({ runId, index })));
    const origin = process.env.LEXORDER_PERSONAL_ORIGIN!;
    const endpoint = origin + "/api/personal/matter-workspace";
    const headers = { Host: new URL(origin).host, Origin: origin, Cookie: "lexorder_local_channel=" + process.env.LEXORDER_PERSONAL_CHANNEL_TOKEN };
    const route = await import("@/app/api/personal/matter-workspace/route");
    const previewResponse = await route.POST(new Request(endpoint, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview-case-grouping", data: { matterId: matter.id, selected } }),
    }));
    expect(previewResponse.status, await previewResponse.clone().text()).toBe(200);
    const preview: Awaited<ReturnType<typeof previewCaseGrouping>> = await previewResponse.json();
    expect(provider.fetch).toHaveBeenCalledTimes(2);
    const byName = new Map(preview.members.map(member => [member.source.name, member]));
    const transferKeys = ["4-bank-receipt.txt", "2-complaint.txt", "3-defence.txt"];
    expect(transferKeys.map(name => [byName.get(name)?.date?.value, byName.get(name)?.amount?.value?.value])).toEqual([
      [{ precision: "EXACT", day: "2023-03-03" }, "480000"],
      [{ precision: "EXACT", day: "2023-03-01" }, "500000"],
      [{ precision: "EXACT", day: "2023-03-03" }, "480000"],
    ]);
    expect(byName.get("1-iou.txt")?.amount?.nature).toBe("AGREED_PRINCIPAL");
    expect(byName.get("4-bank-receipt.txt")).toMatchObject({ participants: ["张三", "李四"],
      relations: [{ kind: "PAYS_TO", from: 1, to: 2, quote: receiptLine }] });
    expect(byName.get("2-complaint.txt")).toMatchObject({ participants: ["原告", "李四"],
      relations: [{ kind: "LENDS_TO", from: 1, to: 2, quote: loanClause }] });
    expect(byName.get("3-defence.txt")?.participants).toEqual(["李四"]);
    const proof = transferKeys.map((name, index) => ({
      observation: byName.get(name)!.observation, quote: ["张三 ｜ 李四", "原告当日交付", "实际于2023年3月3日收到借款"][index],
    }));
    const result = { groups: [{ reason: "DISPUTED_EVENT", members: proof }] };
    const input = { ...supply, groupingId: randomUUID(), selected };
    const rejected = await queueCaseGrouping(actor, input);
    provider.fetch.mockResolvedValueOnce(reply({ groups: [{ reason: "DISPUTED_EVENT", members: [proof[0], proof[0]] }] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readCaseGrouping(actor, matter.id, rejected.id)).toMatchObject({ state: "FAILED", receipt: { error: "INVALID_RESULT" }, result: null });
    const badQuote = await queueCaseGrouping(actor, { ...input, groupingId: randomUUID() });
    provider.fetch.mockResolvedValueOnce(reply({ groups: [{ reason: "RELATED_DESCRIPTION", members: [
      proof[0], { ...proof[1], quote: "引文不在候选摘要内" },
    ] }] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readCaseGrouping(actor, matter.id, badQuote.id)).toMatchObject({ state: "FAILED", receipt: { error: "INVALID_RESULT" }, result: null });
    const retry = { ...input, groupingId: randomUUID() };
    const [queued, sameScope] = await Promise.all([
      queueCaseGrouping(actor, retry),
      queueCaseGrouping(actor, { ...retry, groupingId: randomUUID(), selected: [...selected].reverse() }),
    ]);
    expect(sameScope.id).toBe(queued.id);
    expect(await queueCaseGrouping(actor, { ...retry, selected: [...selected].reverse() })).toMatchObject({ id: queued.id });
    await expect(queueCaseGrouping(actor, { ...retry, selected: selected.slice(0, 2) })).rejects.toThrow("其他范围");
    provider.fetch.mockResolvedValueOnce(reply(result));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    const browserQuery = new URLSearchParams({ matter: matter.id, section: "evidence-items", analysis: "grouping", groupingRun: queued.id });
    const readback = await route.GET(new Request(endpoint + "?" + browserQuery, { headers }));
    expect(readback.status, await readback.clone().text()).toBe(200);
    expect(await readback.json()).toMatchObject({ state: "READY", result,
      receipt: { sentCharacters: preview.characters, usage: { inputTokens: 875, outputTokens: 190 } } });
    const [, options] = provider.fetch.mock.calls[4];
    const payload = JSON.parse(String(options?.body)).messages.find((item: { role: string }) => item.role === "user").content;
    expect(payload.length).toBe(preview.characters);
    expect(payload).toContain('"participants":["张三","李四"]');
    expect(payload).toContain('"kind":"PAYS_TO"');
    expect(payload).not.toContain("4-bank-receipt.txt");
    expect(payload).not.toContain(ranges[0].documentId);
    expect(payload).not.toContain("保证人：王五（承担连带保证责任）");
    const revokedId = ranges[0].documentId;
    const bankAndComplaint = await previewCaseGrouping(actor, { matterId: matter.id, selected: selected.slice(0, 2) });
    const withdrawn = await queueCaseGrouping(actor, { ...input, groupingId: randomUUID(), selected: selected.slice(0, 2) });
    await prisma.document.update({ where: { id: revokedId }, data: { deletedAt: new Date() } });
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readCaseGrouping(actor, matter.id, withdrawn.id)).toMatchObject({ state: "FAILED", result: null, receipt: { error: "PERMISSION" } });
    expect(provider.fetch).toHaveBeenCalledTimes(5);
    await prisma.document.update({ where: { id: revokedId }, data: { deletedAt: null } });
    const late = await queueCaseGrouping(actor, { ...input, groupingId: randomUUID(), selected: selected.slice(0, 2) });
    provider.fetch.mockImplementationOnce(async () => {
      await prisma.document.update({ where: { id: revokedId }, data: { deletedAt: new Date() } });
      return reply({ groups: [] });
    });
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readCaseGrouping(actor, matter.id, late.id)).toMatchObject({
      state: "FAILED", result: null, receipt: { sentCharacters: bankAndComplaint.characters, error: "PERMISSION" },
    });
    await prisma.document.update({ where: { id: revokedId }, data: { deletedAt: null } });
    expect(await prisma.evidenceItem.count({ where: { matterId: matter.id } })).toBe(0);
    const grouped = proof.map(({ observation }) => preview.members[observation - 1]);
    const adopted = await adoptMatterObservations({ matterId: matter.id, requestId: randomUUID(),
      chosen: grouped.map(({ runId, index }) => ({ runId, index })),
      target: { type: "new", kind: "TODO_VERIFY", title: "借款交付待核", content: "核对日期及扣除利息前后的交付金额。" },
    });
    const workspaceQuery = new URLSearchParams({ matter: matter.id, section: "evidence-items" });
    const restorable = await (await route.GET(new Request(endpoint + "?" + workspaceQuery, { headers }))).json();
    expect(restorable.items.find((item: { id: string }) => item.id === adopted.id).observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ participants: [
        expect.objectContaining({ text: "张三" }), expect.objectContaining({ text: "李四" }),
      ], relations: [expect.objectContaining({ kind: "PAYS_TO", from: 1, to: 2, text: receiptLine })] }) }),
    ]));
    expect(await prisma.party.count({ where: { matterId: matter.id } })).toBe(0);
    expect(await readCaseGrouping(actor, matter.id, queued.id)).toMatchObject({ members: expect.arrayContaining([
      expect.objectContaining({ adoptedItemId: expect.any(String) }),
      expect.objectContaining({ adoptedItemId: null }),
    ]) });
    await prisma.document.update({ where: { id: ranges[0].documentId }, data: { deletedAt: new Date() } });
    await expect(readCaseGrouping(actor, matter.id, queued.id)).rejects.toThrow("已撤回");
    expect(provider.fetch).toHaveBeenCalledTimes(6);
  }, 60_000);
});
