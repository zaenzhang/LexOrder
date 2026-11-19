import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { startPrivatePostgres } from "../private-pg.mjs";

const load = createRequire(new URL("../../../package.json", import.meta.url));
const { PrismaClient } = load("@prisma/client"),
  { PrismaPg } = load("@prisma/adapter-pg");
if (!process.env.M1_WORKSPACE) throw Error("Set M1_WORKSPACE to the initialized synthetic workspace.");
const workspace = path.resolve(process.env.M1_WORKSPACE);
const manifest = JSON.parse(await readFile(path.join(workspace, "workspace.json"), "utf8"));
assert(manifest.mode === "PERSONAL");
const existing = path.join(workspace, "chronicle-smoke-cases.json");
let cases;
try {
  cases = JSON.parse(await readFile(existing, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

let owner, database, socket, db;
try {
  let url = process.env.DATABASE_URL;
  if (url) {
    assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  } else {
    // Match the runtime's single-owner rule when preparing an embedded DB.
    owner = await open(path.join(workspace, ".owner"), "wx", 0o600);
    const { PGlite } = await import("@electric-sql/pglite");
    database = await PGlite.create(path.join(workspace, "data"));
    const credential = randomBytes(32).toString("hex");
    socket = await startPrivatePostgres(database, credential, () => {
      throw Error("Fixture database closed unexpectedly");
    });
    url =
      "postgresql://postgres:" +
      credential +
      "@127.0.0.1:" +
      socket.port +
      "/postgres?sslmode=disable&connection_limit=1";
  }
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const stored = await db.systemSetting.findUnique({ where: { key: "personal-workspace" } });
  assert.equal(stored?.value?.workspaceId, manifest.workspaceId);
  assert.equal(stored?.value?.actorId, manifest.actorId);
  const sample = randomUUID().slice(0, 8);
  cases ??= await db.$transaction(
    ["甲", "乙"].map((suffix, i) =>
      db.matter.create({
        data: {
          title: "Chronicle合成验收" + suffix,
          internalCode: "CHRONICLE-TEST-" + sample + "-" + (i + 1),
          ownerId: manifest.actorId,
          registeredById: manifest.actorId,
        },
        select: { id: true, internalCode: true, title: true },
      }),
    ),
  );
  await db.$transaction(async (tx) => {
    for (const [index, fixture] of cases.entries()) {
      const row = await tx.matter.findUniqueOrThrow({ where: { id: fixture.id } });
      assert(
        row.internalCode.startsWith("CHRONICLE-TEST-") &&
          row.internalCode === fixture.internalCode &&
          row.ownerId === manifest.actorId,
      );
      if (row.title === "Chronicle 合成验收" + ["甲", "乙"][index]) {
        fixture.title = row.title.replace(" ", "");
        await tx.matter.update({ where: { id: row.id }, data: { title: fixture.title } });
      }
      if (!row.primaryClientId) {
        const client = await tx.client.create({
          data: {
            name: "合成验收委托人" + row.internalCode,
            type: "ORGANIZATION",
            ownerUserId: manifest.actorId,
          },
        });
        await tx.matter.update({ where: { id: row.id }, data: { primaryClientId: client.id } });
      }
    }
    const invoiceNo = cases[0].internalCode + "-ISSUED";
    if (!(await tx.invoiceRequest.count({ where: { matterId: cases[0].id, invoiceNo } }))) {
      await tx.invoiceRequest.create({
        data: {
          matterId: cases[0].id,
          invoiceNo,
          status: "ISSUED",
          amount: "1000000.00",
          requestedById: manifest.actorId,
          processedById: manifest.actorId,
          issuedAt: new Date(),
          buyerName: "合成测试购方",
        },
      });
    }
    for (const [type, label] of [
      ["OFFICIAL_SEAL", "公章"],
      ["LEGAL_REP_SEAL", "法人章"],
    ]) {
      await tx.sealTypeConfig.upsert({
        where: { type },
        create: {
          type,
          label,
          enabled: true,
          requiresLegalRep: type === "LEGAL_REP_SEAL",
          approverRoles: [],
        },
        update: { enabled: true, ...(type === "LEGAL_REP_SEAL" ? { requiresLegalRep: true } : {}) },
      });
    }
    const purpose = await tx.sealPurposeConfig.findUnique({ where: { name: "合成测试事项" } });
    const allowedSealTypes = [
      ...new Set([...(purpose?.allowedSealTypes ?? []), "OFFICIAL_SEAL", "LEGAL_REP_SEAL"]),
    ];
    await tx.sealPurposeConfig.upsert({
      where: { name: "合成测试事项" },
      create: { name: "合成测试事项", allowedSealTypes },
      update: { active: true, allowedSealTypes },
    });
  });
  await writeFile(existing, JSON.stringify(cases), { mode: 0o600 });
  console.log("Prepared two synthetic cases, clients, an issued invoice and test seal options");
} finally {
  await db?.$disconnect();
  if (socket) await socket.stop();
  if (database) await database.close();
  if (owner) {
    await owner.close();
    await rm(path.join(workspace, ".owner"));
  }
}
