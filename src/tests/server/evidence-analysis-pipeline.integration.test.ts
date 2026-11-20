// @vitest-environment node
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { Document as Docx, Packer, Paragraph } from "docx";
import { prisma } from "@/lib/prisma";
import { changeMatterFolder } from "@/lib/runtime/matter-folders";
import { saveAiSettings } from "@/lib/ai/settings";
import { readMatterInputCoverage } from "@/server/ai/input-coverage-service";
import type { MatterAnalysisPlan } from "@/lib/ai/input-coverage";
import { resolvePersonalActor } from "@/server/runtime/personal";
import { createFolder, moveDocumentToFolder, renameFolder } from "@/server/document-folders/actions";
import { changeMaterialCategory } from "@/server/documents/catalog-actions";
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
vi.mock("@/lib/net/safe-url", async importOriginal => {
  const real = await importOriginal<typeof import("@/lib/net/safe-url")>();
  return {
    ...real,
    assertSafeHttpUrl: async (url: string) => {
      if (url === provider.url) return;
      if (url === "https://api.openai.com/v1" && process.env.LEXORDER_V8_LIVE_OPENAI === "1") return real.assertSafeHttpUrl(url);
      throw new Error("Unexpected fixture provider");
    },
    safeFetch: provider.fetch,
  };
});
vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({ user: await resolvePersonalActor(prisma) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const model = "fixture-observations";
const authorized = "2023年3月3日，转账金额48万元，转账后账户余额49万元。";
const original = "同一页其他信息：未授权的备注。\n" + authorized + "\n其他款项：余额50万元。";
const filing = "提交日期：2023年3月7日。";
const service = "送达日期：2023年3月6日。";
const draft = {
  fragment: 1, firstLine: 1, lastLine: 1, title: "转账记载", category: "payment", kind: "FACT",
  statement: "RECORD", excerpt: null, dateRole: null, dateText: null, amountNature: null, amountText: null,
  participants: null, relations: null,
} as const;
const observation = { ...draft, dateRole: "OCCURRENCE", dateText: "2023年3月3日",
  amountNature: "ACTUAL_TRANSFER", amountText: "48万元" };
const balance = { ...draft, amountNature: "BALANCE", amountText: "49万元" };
const filingDraft = { ...draft, fragment: 2, category: "procedure", dateRole: "FILING", dateText: "2023年3月7日" };
const serviceDraft = { ...draft, fragment: 3, category: "procedure", dateRole: "SERVICE", dateText: "2023年3月6日" };

const v8Samples = {
  "4-bank-receipt.txt": "449d16882b658829b55af12962b3e2ff32bbe45fc99c88cd2061353adedacb4c",
  "2-complaint.txt": "d9abcfd1f97131e2673ed2e2edebb85e3ed8a9d2c0da649a93d30119c82615d4",
  "3-defence.txt": "c89d2938a657f4f713fcae47ca6bd815b0e3aaaa0c753773308cee7acfc251b0",
  "1-iou.txt": "846c99bcb7b0cbf1fcd913e24813c0bf84a5c9180b4b2f353ac107a3015a396b",
};

async function loadV8Samples(verify: boolean): Promise<[string, string][]> {
  const source = process.env.LEXORDER_V8_GROUPING_SAMPLE;
  if (!source) throw new Error("Set LEXORDER_V8_GROUPING_SAMPLE to the synthetic V8 sample directory");
  return Promise.all(Object.entries(v8Samples).map(async ([name, expected]) => {
    const contents = await readFile(path.join(source, name));
    if (verify && createHash("sha256").update(contents).digest("hex") !== expected) {
      throw new Error("OpenAI smoke only accepts the fixed synthetic V8 files: " + name);
    }
    return [name, contents.toString("utf8")];
  }));
}

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
    const delivery = "青禾公司于2024年4月8日向远桥公司交付两台机床。";
    const text = "远桥公司先前通知仓库。" + delivery;
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
      amountNature: null, amountText: null,
      participants: [{ text: "青禾公司", context: null }, { text: "远桥公司", context: "向远桥公司交付" }],
      relations: [{ kind: "DELIVERS_TO", from: 1, to: 2, quote: delivery }],
    };
    provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: {
      content: JSON.stringify({ observations: [{ ...record, firstLine: "1" }, record] }),
    } }] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readObservationRuns(actor, matter.id, null, run.id)).toMatchObject({
      state: "READY", receipt: { rejected: [{ index: 0, reason: "SCHEMA" }] },
      candidates: [{ data: { participants: [{ text: "青禾公司" }, { text: "远桥公司" }],
        relations: [{ kind: "DELIVERS_TO", from: 1, to: 2, text: delivery }] } }],
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
      participants: [{ text: "青禾公司" }, { text: "远桥公司", span: { start: text.lastIndexOf("远桥公司"), end: text.lastIndexOf("远桥公司") + 4 } }],
      relations: [{ kind: "DELIVERS_TO", from: 1, to: 2, span: { start: text.indexOf(delivery), end: text.length }, text: delivery }],
    });
  }, 30_000);

  it.each(["matter", "fact"])("%s 固定排队时的材料分类，类别变动后只复用匹配批次", async scope => {
    provider.fetch.mockClear();
    const actor = await resolvePersonalActor(prisma);
    if (!actor || !workspace || !work) throw new Error("Missing fixture");
    const matter = await prisma.matter.create({ data: {
      title: "材料类别与分析复用", internalCode: "SYNTHETIC-OBSERVATION-CATEGORY-" + scope,
      ownerId: actor.id, registeredById: actor.id,
    } });
    const root = path.join(work, "observation-category-" + scope);
    await mkdir(root, { recursive: true });
    await changeMatterFolder(matter, { action: "bind", root }, path.join(workspace, "storage"));
    const text = "答辩人称2023年3月3日实际收到借款48万元。";
    const form = new FormData();
    form.set("file", new File([text], "合成陈述.txt", { type: "text/plain" }));
    form.set("name", "合成陈述.txt");
    form.set("category", "OTHER");
    form.set("matterId", matter.id);
    form.set("requestKey", randomUUID());
    const saved = await uploadDocument(form);
    if (!saved.ok) throw new Error(saved.message);
    expect(await processDueJobs(1, "personal-materials")).toMatchObject({ succeeded: 1 });
    const parsed = await prisma.documentParseRun.findFirstOrThrow({ where: { documentId: saved.id, state: "READY" } });
    const [anchor] = parsed.anchors as { anchorId: string; text: string }[];
    expect(anchor.text).toBe(text);
    const range = { documentId: saved.id, parseRunId: parsed.id, anchorId: anchor.anchorId, start: 0, end: text.length };
    const common = { matterId: matter.id, confirmed: true as const, model, origin: new URL(provider.url).origin };
    const event = scope === "fact" ? await createEvidenceItem({
      matterId: matter.id, requestKey: randomUUID(), title: "核对收到的借款", kind: "FACT", content: "合成要点",
    }) : undefined;
    const linked = event && await addEvidenceSource({
      evidenceItemId: event.id, expectedRevision: 1, documentId: saved.id, parseRunId: parsed.id, anchorId: anchor.anchorId, relation: "SUPPORTS",
    });
    const queue = (runId: string = randomUUID()) => event && linked
      ? queueObservationRun(actor, { ...common, runId, evidenceItemId: event.id, expectedRevision: linked.revision,
        ranges: [{ sourceId: linked.sourceId, start: 0, end: text.length }] })
      : queueMatterObservationRun(actor, { ...common, runId, ranges: [range] });
    const setCategory = (category: "OTHER" | "PLEADING" | "CONTRACT") => changeMaterialCategory({
      action: "change-material-category", matterId: matter.id, category, documentIds: [saved.id],
    });
    const read = (id: string) => readObservationRuns(actor, matter.id, event?.id ?? null, id);
    const runNext = async () => {
      provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"observations":[]}' } }] }));
      expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
      const body = JSON.parse(String(provider.fetch.mock.calls.at(-1)?.[1]?.body));
      return JSON.parse(body.messages.find((message: { role: string }) => message.role === "user").content);
    };

    const original = await queue();
    const folder = await createFolder({ matterId: matter.id, name: "收件" });
    await moveDocumentToFolder({ documentId: saved.id, folderId: folder.id });
    await renameFolder({ id: folder.id, name: "诉辩材料待核对" });
    expect(await queue()).toMatchObject({ id: original.id });
    expect(await setCategory("PLEADING")).toEqual({ changed: 1 });
    expect(await queue(original.id)).toMatchObject({ id: original.id });
    const originalPayload = await runNext();
    expect(originalPayload.fragments).toMatchObject([{ category: "OTHER" }]);
    expect(await read(original.id)).toMatchObject({ state: "READY", candidates: [] });

    const reclassified = await queue();
    expect(reclassified.id).not.toBe(original.id);
    expect(await queue()).toMatchObject({ id: reclassified.id });
    const reclassifiedPayload = await runNext();
    expect(reclassifiedPayload.fragments).toMatchObject([{ category: "PLEADING" }]);
    expect(await read(reclassified.id)).toMatchObject({ state: "READY", receipt: { localRecords: 1 },
      candidates: [{ data: { statement: "PARTY_STATEMENT", amount: { text: "48万元" } } }] });

    await setCategory("OTHER");
    expect(await queue()).toMatchObject({ id: original.id, state: "READY" });

    const legacyInput = {
      ranges: [linked ? { ...range, sourceId: linked.sourceId } : range],
      methodVersion: scope === "fact" ? "evidence-observations/12" : "matter-observations/12",
    };
    await setCategory("CONTRACT");
    const oldQueued = await queue();
    await prisma.evidenceObservationRun.update({ where: { id: oldQueued.id }, data: legacyInput });
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await read(oldQueued.id)).toMatchObject({ state: "FAILED", receipt: { error: "STALE" } });

    await prisma.evidenceObservationRun.update({ where: { id: reclassified.id }, data: legacyInput });
    expect(await queue(reclassified.id)).toMatchObject({ id: reclassified.id, state: "READY" });
    expect(await read(reclassified.id)).toMatchObject({ sources: [{ start: 0, end: text.length }],
      candidates: [{ data: { statement: "PARTY_STATEMENT" } }] });
    if (event && linked) {
      await adoptEvidenceObservationRun({
        matterId: matter.id, evidenceItemId: event.id, expectedRevision: linked.revision, runId: reclassified.id, chosen: [0],
      });
      expect(await read(reclassified.id)).toMatchObject({ state: "ADOPTED" });
    } else {
      expect(await readMatterObservationExcerpt(actor, matter.id, reclassified.id, 1)).toEqual({ text });
      await adoptMatterObservations({
        matterId: matter.id, requestId: randomUUID(), chosen: [{ runId: reclassified.id, index: 0 }],
        target: { type: "new", kind: "FACT", title: "材料陈述", content: text },
      });
      expect(await read(reclassified.id)).toMatchObject({ caseAdoptions: [{ index: 0 }] });
    }
    expect(provider.fetch).toHaveBeenCalledTimes(2);
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
    const materials = [{ text: authorized, material: name }];
    const observations: unknown[] = [observation, balance];
    let revision = linked.revision;
    let alternate: string | undefined;
    let casePlan: MatterAnalysisPlan | undefined;
    if (format === "xlsx") {
      const secondStart = anchor.text.indexOf(filing);
      expect(secondStart).toBeGreaterThan(ranges[0].end);
      ranges.push({ sourceId: linked.sourceId, start: secondStart, end: secondStart + filing.length });
      materials.push({ text: filing, material: name });
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
      materials.push({ text: service, material: "合成送达记录.txt" });
      observations.push(filingDraft, serviceDraft);
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

    const unavailableLine = { ...observation, firstLine: 2, lastLine: 2, amountText: "50万元" };
    const withoutPeriod = { ...ranges[0], end: ranges[0].end - 1 };
    const balanceOnly = { ...ranges[0], start: start + authorized.indexOf("转账后账户余额") };
    const cases = [
      { candidate: unavailableLine, range: ranges[0], state: "FAILED",
        output: { receipt: { error: "INVALID_RESULT" }, candidates: [] } },
      { candidate: { ...observation, amountText: "50万元" }, range: withoutPeriod, state: "READY",
        output: { receipt: { skippedFields: 1 }, candidates: [{ data: { date: { text: "2023年3月3日" } } }] } },
      { candidate: { ...draft, amountNature: "ACTUAL_TRANSFER", amountText: "49万元" }, range: balanceOnly, state: "READY",
        output: { candidates: [{ data: { amount: { nature: "BALANCE" } } }] } },
    ];
    const invalidRunId = randomUUID();
    for (const [index, scenario] of cases.entries()) {
      const runId = index === 0 ? invalidRunId : randomUUID();
      await queueObservationRun(actor, { ...input, runId, ranges: [scenario.range, ...ranges.slice(1)] });
      provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
        observations: [scenario.candidate],
      }) } }] }));
      const checkedJob = await lease(observationJobKey(runId));
      await processObservationRun({ runId }, checkedJob);
      expect(await completeJob(checkedJob)).toBe(true);
      const result = await readObservationRuns(actor, matter.id, event.id, runId);
      expect(result).toMatchObject({ state: scenario.state, ...scenario.output });
      if (index === 1 && "candidates" in result) expect(result.candidates[0].data).not.toHaveProperty("amount");
    }

    const runId = randomUUID();
    const queued = await queueObservationRun(actor, { ...input, runId });
    expect(await queueObservationRun(actor, { ...input, runId })).toEqual(queued);
    const route = await import("@/app/api/personal/matter-workspace/route");
    const origin = process.env.LEXORDER_PERSONAL_ORIGIN!;
    const endpoint = origin + "/api/personal/matter-workspace";
    const headers = { Host: new URL(origin).host, Origin: origin, Cookie: "lexorder_local_channel=" + process.env.LEXORDER_PERSONAL_CHANNEL_TOKEN };
    const reopened = await Promise.all(Array.from({ length: 2 }, () => route.POST(new Request(endpoint, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start-evidence-observation-run", data: { ...input, runId: randomUUID() } }),
    }))));
    for (const response of reopened) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: runId, state: "QUEUED" });
    }
    await expect(queueObservationRun(actor, { ...input, runId, ranges: [{ ...input.ranges[0], start: start + 1 }] }))
      .rejects.toThrow("此委托标识已绑定其他范围");
    provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({ observations }) } }],
      usage: { prompt_tokens: 240, completion_tokens: 80 } }));
    const job = await lease(observationJobKey(runId));
    await processObservationRun({ runId }, job);
    await processObservationRun({ runId }, job);
    expect(await completeJob(job)).toBe(true);
    expect(provider.fetch).toHaveBeenCalledTimes(4);
    for (const [index, [url, options]] of provider.fetch.mock.calls.entries()) {
      expect(url).toBe(provider.url + "/chat/completions");
      const body = JSON.parse(String(options?.body));
      const userMessage = body.messages.find((message: { role: string }) => message.role === "user");
      const payload = JSON.parse(userMessage.content);
      const firstRange = cases[index]?.range ?? ranges[0];
      expect(payload).toEqual({ title: "核对转账记载", fragments: materials.map(({ text, material }, index) => ({
        index: index + 1, material, category: expect.any(String),
        lines: [{ line: 1, text: index === 0 ? anchor.text.slice(firstRange.start, firstRange.end) : text }],
      })) });
    }
    const ready = await readObservationRuns(actor, matter.id, event.id, runId);
    if (!("candidates" in ready)) throw new Error("Expected analysis batch detail");
    expect(ready).toMatchObject({
      state: "READY", receipt: { sentCharacters: materials.reduce((total, row) => total + row.text.length, 0), usage: { inputTokens: 240, outputTokens: 80 } },
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
    expect(await queueObservationRun(actor, { ...input, runId: randomUUID() })).toMatchObject({ id: runId, state: "READY" });
    await prisma.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
    await expect(queueObservationRun(actor, { ...input, runId: randomUUID() })).rejects.toThrow("已撤回");
    await prisma.document.update({ where: { id: documentId }, data: { deletedAt: null } });
    expect(provider.fetch).toHaveBeenCalledTimes(4);
    expect((await prisma.evidenceItem.findUniqueOrThrow({ where: { id: event.id } })).observationRevisionIds).toEqual([]);
    const chosen = [format === "xlsx" ? 3 : 0];
    const adoption = { matterId: matter.id, evidenceItemId: event.id, expectedRevision: revision, runId, chosen };
    await expect(adoptEvidenceObservationRun({ ...adoption, runId: invalidRunId }))
      .rejects.toThrow("仅可采用当前要点版本中已生成的待核稿");
    const adopted = await adoptEvidenceObservationRun(adoption);
    expect(await adoptEvidenceObservationRun(adoption)).toEqual(adopted);
    expect(adopted.observationIds).toHaveLength(1);
    const savedObservation = await prisma.evidenceObservationRevision.findUniqueOrThrow({ where: { id: adopted.observationIds[0] } });
    expect(savedObservation.sourceLinkId).toEqual(ranges[format === "xlsx" ? 2 : 0].sourceId);
    await expect(adoptEvidenceObservationRun({ ...adoption, chosen: [1] })).rejects.toThrow("该批次已按其他选择采用");
    expect((await prisma.evidenceItem.findUniqueOrThrow({ where: { id: event.id } })).observationRevisionIds).toEqual(adopted.observationIds);
    expect(await readObservationRuns(actor, matter.id, event.id, runId)).toMatchObject({ state: "ADOPTED", adoption: { chosen } });
    expect(provider.fetch).toHaveBeenCalledTimes(4);
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
      const sourceOffset = fixed[source].start;
      const line = anchor.text.slice(sourceOffset, start).split("\n").length;
      provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
        observations: [observation, balance].map(row => ({ ...row, fragment: source + 1, firstLine: line, lastLine: line })),
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
        observations: [{ ...serviceDraft, fragment: casePlan.batches[1].ranges.length }],
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
      await saveAiSettings({ enabled: true, apiKey: "fixture-key", baseUrl: provider.url, textModel: model });
      const failedRange = { ...request, ranges: fixed.slice(0, 1) };
      const retry = await queueMatterObservationRun(actor, { ...failedRange, runId: randomUUID() });
      expect(retry.state).toBe("QUEUED");
      expect(retry.id).not.toBe(unavailable.id);
      const candidateJob = await prisma.jobQueue.findUniqueOrThrow({ where: { dedupeKey: observationJobKey(retry.id) } });
      await prisma.jobQueue.update({ where: { id: candidateJob.id }, data: { status: "DEAD" } });
      expect(await queueMatterObservationRun(actor, { ...failedRange, runId: retry.id })).toMatchObject({ state: "FAILED" });
      const restarted = await queueMatterObservationRun(actor, { ...failedRange, runId: randomUUID() });
      expect(restarted.state).toBe("QUEUED");
      expect(restarted.id).not.toBe(retry.id);
      await prisma.evidenceObservationRun.update({ where: { id: restarted.id }, data: { state: "DISPATCHED", receipt: {
        dispatchedAt: new Date().toISOString(),
      } } });
      await prisma.jobQueue.update({ where: { dedupeKey: observationJobKey(restarted.id) }, data: { status: "DEAD" } });
      expect(await queueMatterObservationRun(actor, { ...failedRange, runId: randomUUID() })).toMatchObject({
        id: restarted.id, state: "UNCERTAIN", receipt: { error: "INTERRUPTED" },
      });
      expect(provider.fetch).toHaveBeenCalledTimes(6);
    }
  }, 60_000);

  async function seedV8Case(tag: string, samples: [string, string][]) {
    const actor = await resolvePersonalActor(prisma);
    if (!actor || !workspace || !work) throw new Error("Missing fixture");
    const matter = await prisma.matter.create({ data: {
      title: "V8 借贷归并示例", internalCode: "SYNTHETIC-V8-" + tag, ownerId: actor.id, registeredById: actor.id,
    } });
    const root = path.join(work, "v8-casebook-" + tag);
    await mkdir(root, { recursive: true });
    await changeMatterFolder(matter, { action: "bind", root }, path.join(workspace, "storage"));

    const ranges = [];
    for (const [name, contents] of samples) {
      const form = new FormData();
      form.set("file", new File([contents], name, { type: "text/plain" }));
      form.set("name", name);
      form.set("category", name === "2-complaint.txt" || name === "3-defence.txt" ? "PLEADING" : "EVIDENCE");
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
    return { actor, matter, ranges };
  }


  it("补充合同、跨工作表金额、收发时间和公开裁判沿同一条固定出处管线核对", async () => {
    provider.fetch.mockClear();
    await saveAiSettings({ enabled: true, apiKey: "fixture-key", baseUrl: provider.url, textModel: model });
    const { actor, matter } = await seedV8Case("MATERIAL-ROLES", []);
    async function ingest(file: File, category: string) {
      const form = new FormData();
      form.set("file", file);
      form.set("name", file.name);
      form.set("category", category);
      form.set("matterId", matter.id);
      form.set("requestKey", randomUUID());
      const saved = await uploadDocument(form);
      if (!saved.ok) throw new Error(saved.message);
      expect(await processDueJobs(1, "personal-materials")).toMatchObject({ succeeded: 1 });
      const run = await prisma.documentParseRun.findFirstOrThrow({ where: { documentId: saved.id } });
      expect(run.state).toBe("READY");
      return (run.anchors as { anchorId: string; text: string; location: Record<string, unknown> }[])
        .map(anchor => ({ ...anchor, documentId: saved.id, parseRunId: run.id }));
    }

    const contracted = "约定验收日期：2024年6月2日。";
    const fulfilled = "实际履行日期：2024年6月3日。";
    const docx = await Packer.toBuffer(new Docx({ sections: [{ children: [
      new Paragraph(contracted), new Paragraph(fulfilled),
    ] }] }));
    const agreement = await ingest(new File([new Uint8Array(docx)], "合成补充合同.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }), "CONTRACT");

    const credited = "到账金额：480,000.00元";
    const balance = "账户余额：490,000.00元";
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("到账记录").getCell("B2").value = credited;
    workbook.addWorksheet("月末余额").getCell("C3").value = balance;
    const ledger = await ingest(new File([new Uint8Array(await workbook.xlsx.writeBuffer())], "合成两页账簿.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), "EVIDENCE");
    expect(ledger.map(entry => entry.location)).toMatchObject([
      { kind: "TABLE", sheet: "到账记录", rowStart: 2, columnStart: 2 },
      { kind: "TABLE", sheet: "月末余额", rowStart: 3, columnStart: 3 },
    ]);

    const sent = "发送时间：2024-06-02 23:59:02";
    const received = "接收时间：2024-06-03 00:00:01";
    const message = (name: string) => ingest(new File([sent + "\n" + received], name, { type: "text/plain" }), "EVIDENCE");
    const [outbox] = await message("发件端记录.txt");
    const [inbox] = await message("收件端记录.txt");
    const records = [
      [agreement[0], contracted, { dateRole: "OCCURRENCE", dateText: "2024年6月2日" }],
      [agreement[0], fulfilled, { dateRole: "AGREEMENT", dateText: "2024年6月3日" }],
      [ledger[0], credited, { amountNature: "BALANCE", amountText: "480,000.00元" }],
      [ledger[1], balance, { amountNature: "ACTUAL_TRANSFER", amountText: "490,000.00元" }],
      [outbox, sent, { dateRole: "SERVICE", dateText: sent.split("：")[1] }],
      [outbox, received, { dateRole: "SENT", dateText: received.split("：")[1] }],
      [inbox, sent, { dateRole: "RECEIVED", dateText: sent.split("：")[1] }],
      [inbox, received, { dateRole: "SERVICE", dateText: received.split("：")[1] }],
    ] as const;
    const selections: { anchor: typeof agreement[number]; text: string; fields: Record<string, unknown> }[] = records.map(([anchor, text, fields]) => ({ anchor, text, fields: { ...draft, ...fields } }));
    const opinionPath = process.env.LEXORDER_P1_OPINION;
    if (opinionPath) {
      const pdf = await readFile(opinionPath);
      expect(createHash("sha256").update(pdf).digest("hex")).toBe("591f0fdecf41cb297427288a18fd72230e14d4aefe9af4f2d86d6c64dcc4476f");
      const pages = await ingest(new File([new Uint8Array(pdf)], "Coinbase v Suski.pdf", { type: "application/pdf" }), "JUDGMENT");
      for (const [page, cue, wrong] of [
        [9, "Coinbase argues that", "COURT_FINDING"],
        [10, "We conclude that", "PARTY_STATEMENT"],
      ] as const) {
        const anchor = pages.find(item => item.location.page === page)!;
        const start = anchor.text.indexOf(cue);
        expect(start).toBeGreaterThanOrEqual(0);
        const text = anchor.text.slice(start).split(/\r?\n|\.\s/u)[0];
        const excerpt = text.slice(cue.length).trim();
        expect(excerpt.length).toBeGreaterThan(8);
        selections.push({ anchor, text, fields: { ...draft, statement: wrong, excerpt } });
      }
    }
    const supply = { matterId: matter.id, confirmed: true as const, model, origin: new URL(provider.url).origin };
    async function analyze(entries: typeof selections) {
      const ranges = entries.map(({ anchor, text }) => {
        const start = anchor.text.indexOf(text);
        expect(start).toBeGreaterThanOrEqual(0);
        return { documentId: anchor.documentId, parseRunId: anchor.parseRunId, anchorId: anchor.anchorId, start, end: start + text.length };
      });
      const run = await queueMatterObservationRun(actor, { ...supply, runId: randomUUID(), ranges });
      provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
        observations: entries.map(({ fields }, index) => ({ ...fields, fragment: index + 1 })),
      }) } }] }));
      expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
      const batch = await readObservationRuns(actor, matter.id, null, run.id);
      if (!("candidates" in batch)) throw new Error("Missing mixed material analysis");
      expect(batch.state).toBe("READY");
      expect(batch.receipt?.rejected ?? []).toEqual([]);
      expect(batch.receipt?.skippedFields ?? 0).toBe(0);
      expect(batch.candidates).toHaveLength(entries.length);
      for (const [index, candidate] of batch.candidates.entries()) {
        const { anchor, text } = entries[index];
        expect(await readMatterObservationExcerpt(actor, matter.id, run.id, index + 1)).toEqual({ text });
        for (const field of [candidate.data.date, candidate.data.amount, candidate.data.excerpt]) {
          if (field) expect(anchor.text.slice(field.span.start, field.span.end)).toBe(field.text);
        }
      }
      return batch;
    }
    const batch = await analyze(selections.slice(0, 8));
    expect(batch.candidates.slice(0, 8).map(({ data }) => data.date?.role ?? data.amount?.nature)).toEqual([
      "AGREEMENT", "OCCURRENCE", "ACTUAL_TRANSFER", "BALANCE", "SENT", "RECEIVED", "SENT", "RECEIVED",
    ]);
    expect(batch.candidates.slice(2, 4).map(({ data }) => data.amount?.value)).toEqual([
      { currency: "CNY", value: "480000" }, { currency: "CNY", value: "490000" },
    ]);
    expect(batch.candidates[4].data.date).toMatchObject({ text: sent.split("：")[1], value: { day: "2024-06-02" } });
    expect(batch.candidates[5].data.date).toMatchObject({ text: received.split("：")[1], value: { day: "2024-06-03" } });
    expect(batch.candidates[4].hint).toMatchObject({ title: "消息发送记载", category: "communication" });
    expect(batch.candidates[5].hint).toMatchObject({ title: "消息接收记载", category: "communication" });
    if (opinionPath) {
      const court = await analyze(selections.slice(8));
      expect(court.candidates.map(({ data }) => data.statement)).toEqual(["PARTY_STATEMENT", "COURT_FINDING"]);
      expect(court.candidates[0].hint).toMatchObject({ kind: "TODO_VERIFY", title: "核对裁判文书所载当事人主张" });
    }

    // Even a model proposing one group for all four message dates cannot combine
    // send and receive. Each role has a record from both independent documents.
    const selected = [4, 5, 6, 7].map(index => ({ runId: batch.id, index }));
    const groupingId = randomUUID();
    provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
      groups: [{ reason: "RELATED_DESCRIPTION", members: [1, 2, 3, 4] }],
    }) } }] }));
    await queueCaseGrouping(actor, { ...supply, groupingId, selected });
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    const grouped = await readCaseGrouping(actor, matter.id, groupingId);
    if (!("result" in grouped)) throw new Error("Missing message grouping result");
    expect(grouped.result?.groups.map(group => group.members.map(member => member.observation))).toEqual([[1, 3], [2, 4]]);
    const adopted = await adoptMatterObservations({ matterId: matter.id, requestId: randomUUID(),
      chosen: [{ runId: batch.id, index: 4 }], target: { type: "new", title: "发送记载", kind: "FACT", content: sent },
    });
    const item = await prisma.evidenceItem.findUniqueOrThrow({ where: { id: adopted.id } });
    const observation = await prisma.evidenceObservationRevision.findUniqueOrThrow({ where: { id: item.observationRevisionIds[0] } });
    expect(observation.data).toMatchObject({ date: { role: "SENT", text: sent.split("：")[1] } });
    expect(provider.fetch).toHaveBeenCalledTimes(opinionPath ? 3 : 2);
  }, 40_000);

  it("模型截掉否认时只可采用带限定语的待核记载", async () => {
    provider.fetch.mockClear();
    await saveAiSettings({ enabled: true, apiKey: "fixture-key", baseUrl: provider.url, textModel: model });
    const phrase = "2024年3月1日吴乙向周甲付款12万元";
    const text = "被告否认：" + phrase + "。";
    const { actor, matter, ranges } = await seedV8Case("DENIED", [["2-complaint.txt", text]]);
    const input = { matterId: matter.id, runId: randomUUID(), confirmed: true as const,
      model, origin: new URL(provider.url).origin, ranges };
    const stale = await queueMatterObservationRun(actor, input);
    await prisma.evidenceObservationRun.update({
      where: { id: stale.id }, data: { methodVersion: "matter-observations/15" },
    });
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readObservationRuns(actor, matter.id, null, stale.id)).toMatchObject({ state: "FAILED", receipt: { error: "STALE" } });
    expect(provider.fetch).not.toHaveBeenCalled();

    const run = await queueMatterObservationRun(actor, { ...input, runId: randomUUID() });
    provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
      observations: [{ ...draft, title: "吴乙已付款", excerpt: phrase, dateRole: "OCCURRENCE", dateText: "2024年3月1日",
        amountNature: "ACTUAL_TRANSFER", amountText: "12万元", participants: ["吴乙", "周甲"].map(text => ({ text, context: null })),
        relations: [{ kind: "PAYS_TO", from: 1, to: 2, quote: "吴乙向周甲付款12万元" }] }],
    }) } }] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    const detail = await readObservationRuns(actor, matter.id, null, run.id);
    if (!("candidates" in detail)) throw new Error("Expected the candidate details");
    expect(detail).toMatchObject({ state: "READY", receipt: { skippedFields: 3 } });
    expect(detail.candidates[0]).toMatchObject({
      hint: { kind: "TODO_VERIFY", title: "核对材料中的履行记载" },
      data: { statement: "PARTY_STATEMENT", excerpt: { text: text.slice(0, -1) } },
    });
    expect(detail.candidates[0].data.date).toBeUndefined();
    expect(detail.candidates[0].data.amount).toBeUndefined();
    expect(detail.candidates[0].data.relations).toBeUndefined();
    const adopted = await adoptMatterObservations({ matterId: matter.id, requestId: randomUUID(), chosen: [{ runId: run.id, index: 0 }],
      target: { type: "new", title: "核对履行记载", kind: "TODO_VERIFY", content: "由律师核对付款事实和备注。" },
    });
    const origin = process.env.LEXORDER_PERSONAL_ORIGIN!;
    const endpoint = origin + "/api/personal/matter-workspace";
    const headers = { Host: new URL(origin).host, Origin: origin, Cookie: "lexorder_local_channel=" + process.env.LEXORDER_PERSONAL_CHANNEL_TOKEN };
    const query = new URLSearchParams({ matter: matter.id, section: "evidence-items", timeline: "1" });
    const route = await import("@/app/api/personal/matter-workspace/route");
    const response = await route.GET(new Request(endpoint + "?" + query, { headers }));
    expect(response.status).toBe(200);
    const { items } = await response.json();
    const target = items.find((entry: { id: string }) => entry.id === adopted.id);
    expect(target).toMatchObject({ kind: "TODO_VERIFY", observations: [{ data: {
      statement: "PARTY_STATEMENT", excerpt: { text: text.slice(0, -1) },
    } }] });
    expect(target.observations[0].data).not.toHaveProperty("date");
    expect(target.observations[0].data).not.toHaveProperty("amount");
    expect(target.observations[0].data).not.toHaveProperty("relations");
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it("连接丢失和网关中断保留同一批次，明确拒绝允许重新确认", async () => {
    provider.fetch.mockClear();
    await saveAiSettings({ enabled: true, apiKey: "fixture-key", baseUrl: provider.url, textModel: model });
    const firstText = "设备序列号甲，接收登记待核。";
    const secondText = "设备序列号乙，验收材料待核。";
    const { actor, matter, ranges } = await seedV8Case("UNCERTAIN", [["甲.txt", firstText], ["乙.txt", secondText]]);
    const destination = { matterId: matter.id, confirmed: true as const, model, origin: new URL(provider.url).origin };
    const extraction = { ...destination, ranges: ranges.slice(0, 1) };

    const first = await queueMatterObservationRun(actor, { ...extraction, runId: randomUUID() });
    provider.fetch.mockRejectedValueOnce(new TypeError("fetch failed", { cause: new Error("socket closed after upload") }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readObservationRuns(actor, matter.id, null, first.id)).toMatchObject({
      state: "UNCERTAIN", receipt: { error: "INTERRUPTED" },
    });
    expect(await queueMatterObservationRun(actor, { ...extraction, runId: randomUUID() })).toMatchObject({
      id: first.id, state: "UNCERTAIN",
    });
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ processed: 0 });
    expect(provider.fetch).toHaveBeenCalledTimes(1);

    const both = { ...destination, ranges };
    const rejected = await queueMatterObservationRun(actor, { ...both, runId: randomUUID() });
    provider.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readObservationRuns(actor, matter.id, null, rejected.id)).toMatchObject({
      state: "FAILED", receipt: { error: "PROVIDER" },
    });
    expect(await queueMatterObservationRun(actor, { ...both, runId: rejected.id })).toMatchObject({ id: rejected.id, state: "FAILED" });
    expect(provider.fetch).toHaveBeenCalledTimes(2);
    const retry = await queueMatterObservationRun(actor, { ...both, runId: randomUUID() });
    expect(retry.id).not.toBe(rejected.id);
    provider.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
      observations: [{ ...draft, excerpt: firstText }, { ...draft, fragment: 2, excerpt: secondText }],
    }) } }] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    const ready = await readObservationRuns(actor, matter.id, null, retry.id);
    expect(ready).toMatchObject({ state: "READY", candidates: { length: 2 } });
    const group = { ...destination, selected: [0, 1].map(index => ({ runId: retry.id, index })) };
    const grouped = await queueCaseGrouping(actor, { ...group, groupingId: randomUUID() });
    provider.fetch.mockResolvedValueOnce(new Response(null, { status: 502 }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readCaseGrouping(actor, matter.id, grouped.id)).toMatchObject({
      state: "UNCERTAIN", receipt: { error: "INTERRUPTED" },
    });
    expect(await queueCaseGrouping(actor, { ...group, groupingId: randomUUID() })).toMatchObject({ id: grouped.id, state: "UNCERTAIN" });
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ processed: 0 });
    expect(provider.fetch).toHaveBeenCalledTimes(4);
  });

  it.skipIf(!process.env.LEXORDER_V8_GROUPING_SAMPLE)("V8 借贷示例跨批归并保留三方原文与金额冲突", async () => {
    provider.fetch.mockClear();
    await saveAiSettings({ enabled: true, apiKey: "fixture-key", baseUrl: provider.url, textModel: model });
    const { actor, matter, ranges } = await seedV8Case("GROUP", await loadV8Samples(false));
    const supply = { matterId: matter.id, confirmed: true as const, model, origin: new URL(provider.url).origin };
    function reply(data: object) {
      return Response.json({ choices: [{ message: { content: JSON.stringify(data) } }],
        usage: { prompt_tokens: 875, completion_tokens: 190 } });
    }
    const a = await queueMatterObservationRun(actor, { ...supply, runId: randomUUID(), ranges: ranges.slice(0, 2) });
    const receiptLine = "2023-03-03 ｜ 张三 ｜ 李四 ｜ 480,000.00 ｜ 借款";
    provider.fetch.mockResolvedValueOnce(reply({ observations: [] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    const b = await queueMatterObservationRun(actor, { ...supply, runId: randomUUID(), ranges: ranges.slice(2) });
    provider.fetch.mockResolvedValueOnce(reply({ observations: [
      { ...draft, fragment: 2, firstLine: 2, lastLine: 2, title: "借条约定本金", category: "agreement",
        amountNature: "AGREED_PRINCIPAL", amountText: "人民币伍拾万元整" },
    ] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    const reads = await Promise.all([a, b].map(run => readObservationRuns(actor, matter.id, null, run.id)));
    const selected = reads.flatMap((batch, index) => {
      if (!("candidates" in batch)) throw new Error("Expected V8 analysis batch detail");
      expect(batch.state).toBe("READY");
      return batch.candidates.flatMap((candidate, candidateIndex) =>
        candidate.data.amount ? [{ runId: [a, b][index].id, index: candidateIndex }] : []);
    });
    expect(selected).toHaveLength(4);
    const firstCall = JSON.parse(String(provider.fetch.mock.calls[0][1]?.body)).messages.find((message: { role: string }) => message.role === "user");
    expect(JSON.parse(firstCall.content).fragments.map((fragment: { index: number }) => fragment.index)).toEqual([2]);
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
    expect(preview.members.every(member => member.contexts.every(context =>
      !context.includes("保证人：王五（承担连带保证责任）")))).toBe(true);
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
    expect(byName.get("2-complaint.txt")).toMatchObject({ statement: "PARTY_STATEMENT", excerpt: expect.stringContaining("原告当日交付") });
    expect(byName.get("3-defence.txt")).toMatchObject({ statement: "PARTY_STATEMENT", excerpt: expect.stringContaining("2023年3月3日收到借款") });
    const proof = transferKeys.map(name => byName.get(name)!.observation);
    const response = { groups: [{ reason: "DISPUTED_EVENT", members: proof }] };
    const result = { groups: [{ reason: "DISPUTED_EVENT", members: proof.map(observation => ({
      observation, quote: preview.members.find(member => member.observation === observation)!.excerpt,
    })) }] };
    const input = { ...supply, groupingId: randomUUID(), selected };
    const rejected = await queueCaseGrouping(actor, input);
    provider.fetch.mockResolvedValueOnce(reply({ groups: [{ reason: "DISPUTED_EVENT", members: [proof[0], proof[0]] }] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readCaseGrouping(actor, matter.id, rejected.id)).toMatchObject({ state: "FAILED", receipt: { error: "INVALID_RESULT" }, result: null });
    const mixedRoles = await queueCaseGrouping(actor, { ...input, groupingId: randomUUID() });
    provider.fetch.mockResolvedValueOnce(reply({ groups: [{ reason: "RELATED_DESCRIPTION",
      members: [proof[0], byName.get("1-iou.txt")!.observation],
    }] }));
    expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
    expect(await readCaseGrouping(actor, matter.id, mixedRoles.id)).toMatchObject({ state: "FAILED", receipt: { error: "INVALID_RESULT" }, result: null });
    const retry = { ...input, groupingId: randomUUID() };
    const [queued, sameScope] = await Promise.all([
      queueCaseGrouping(actor, retry),
      queueCaseGrouping(actor, { ...retry, groupingId: randomUUID(), selected: [...selected].reverse() }),
    ]);
    expect(sameScope.id).toBe(queued.id);
    expect(await queueCaseGrouping(actor, { ...retry, selected: [...selected].reverse() })).toMatchObject({ id: queued.id });
    await expect(queueCaseGrouping(actor, { ...retry, selected: selected.slice(0, 2) })).rejects.toThrow("其他范围");
    provider.fetch.mockResolvedValueOnce(reply(response));
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
    const grouped = proof.map(observation => preview.members[observation - 1]);
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

  it.skipIf(process.env.LEXORDER_V8_LIVE_OPENAI !== "1")("V8 同案三轮真实 OpenAI 提取和归并", async () => {
    const samples = await loadV8Samples(true);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const origin = "https://api.openai.com";
    const liveModel = "gpt-4.1-mini-2025-04-14";
    const { safeFetch } = await vi.importActual<typeof import("@/lib/net/safe-url")>("@/lib/net/safe-url");
    provider.fetch.mockReset();
    provider.fetch.mockImplementation(async (input, options) => {
      if (input !== origin + "/v1/chat/completions") throw new Error("Unexpected OpenAI destination");
      const response = await safeFetch(input, options as Record<string, unknown> | undefined);
      if (!response.ok) {
        const problem = await response.clone().json().catch(() => null) as
          { error?: { type?: string; code?: string; param?: string } } | null;
        console.log("V8_OPENAI_STATUS " + JSON.stringify({
          status: response.status, type: problem?.error?.type, code: problem?.error?.code, param: problem?.error?.param,
        }));
      }
      return response;
    });
    const checks = [
      { name: "4-bank-receipt.txt", date: "2023-03-03", amount: "480000", statement: "RECORD" },
      { name: "2-complaint.txt", date: "2023-03-01", amount: "500000", statement: "PARTY_STATEMENT" },
      { name: "3-defence.txt", date: "2023-03-03", amount: "480000", statement: "PARTY_STATEMENT" },
    ];
    await saveAiSettings({ enabled: true, apiKey, baseUrl: origin + "/v1", textModel: liveModel });
    try {
      const outcomes: boolean[] = [];
      for (let trial = 1; trial <= 3; trial++) {
        const { actor, matter, ranges } = await seedV8Case("LIVE-" + trial, samples);
        const supply = { matterId: matter.id, confirmed: true as const, model: liveModel, origin };
        const began = performance.now();
        const queued = await queueMatterObservationRun(actor, { ...supply, runId: randomUUID(), ranges });
        expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
        const batch = await readObservationRuns(actor, matter.id, null, queued.id);
        if (!("candidates" in batch)) throw new Error("Expected live batch detail");
        const extractionMs = Math.round(performance.now() - began);
        const selected = checks.flatMap(check => {
          const index = batch.candidates.findIndex(candidate => {
            const { date, amount, statement, excerpt } = candidate.data;
            return batch.sources[candidate.fragment - 1]?.name === check.name &&
              statement === check.statement && date?.value.precision === "EXACT" && date.value.day === check.date &&
              amount?.nature === "ACTUAL_TRANSFER" && amount.value?.value === check.amount && Boolean(excerpt);
          });
          return index < 0 ? [] : [{ runId: batch.id, index }];
        });
        for (const candidate of batch.candidates) {
          const source = ranges[candidate.fragment - 1];
          const file = samples[candidate.fragment - 1][1];
          const excerpt = await readMatterObservationExcerpt(actor, matter.id, batch.id, candidate.fragment);
          expect(excerpt.text).toBe(file.slice(source.start, source.end));
          for (const field of [candidate.data.excerpt, candidate.data.date, candidate.data.amount,
            ...candidate.data.participants ?? [], ...candidate.data.relations ?? []]) {
            if (field) expect(file.slice(field.span.start, field.span.end)).toBe(field.text);
          }
        }
        const result = { trial, state: batch.state, candidates: batch.candidates.length, matchedTransfers: selected.length,
          extractionMs, extraction: batch.receipt };
        if (selected.length < checks.length || batch.state !== "READY" || !batch.receipt?.usage) {
          console.log("V8_LIVE " + JSON.stringify(result));
          if (batch.state !== "READY" || !batch.receipt?.usage) throw new Error("OpenAI extraction did not finish: " + batch.receipt?.error);
          outcomes.push(false);
          continue;
        }
        const iou = batch.candidates.findIndex(candidate => batch.sources[candidate.fragment - 1]?.name === "1-iou.txt" &&
          candidate.data.amount?.nature === "AGREED_PRINCIPAL");
        const review = iou < 0 ? selected : [...selected, { runId: batch.id, index: iou }];
        const groupStarted = performance.now();
        const plan = await previewCaseGrouping(actor, { matterId: matter.id, selected: review });
        const groupRun = await queueCaseGrouping(actor, { ...supply, groupingId: randomUUID(), selected: review });
        expect(await processDueJobs(1, "personal-ai")).toMatchObject({ succeeded: 1 });
        const grouping = await readCaseGrouping(actor, matter.id, groupRun.id);
        if (!("result" in grouping)) throw new Error("Expected live grouping detail");
        const groups = grouping.result?.groups.map(group => ({
          reason: group.reason, sources: group.members.map(member => grouping.members[member.observation - 1].source.name),
        })) ?? [];
        const complete = groups.some(group => group.sources.length === checks.length &&
          checks.every(check => group.sources.includes(check.name))) && Boolean(grouping.receipt?.usage) &&
          grouping.receipt?.sentCharacters === plan.characters;
        console.log("V8_LIVE " + JSON.stringify({ ...result, groups, agreedPrincipal: iou >= 0,
          groupingMs: Math.round(performance.now() - groupStarted), grouping: grouping.receipt }));
        if (grouping.state === "FAILED" && !grouping.receipt?.usage) {
          throw new Error("OpenAI grouping did not finish: " + grouping.receipt?.error);
        }
        outcomes.push(complete);
      }
      expect(outcomes).toEqual([true, true, true]);
      expect(provider.fetch).toHaveBeenCalledTimes(6);
    } finally {
      await saveAiSettings({ enabled: false });
      provider.fetch.mockReset();
    }
  }, 250_000);
});
