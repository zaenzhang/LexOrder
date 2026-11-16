// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
const db = vi.hoisted(() => ({
  systemSetting: { findMany: vi.fn() }, user: { findUnique: vi.fn() },
  matter: { findUnique: vi.fn() }, client: { update: vi.fn() }, party: { findFirst: vi.fn(), update: vi.fn() }
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { buildContext, renderDocxBuffer, extractDocxVariables, type RenderContext } from "@/lib/template-engine";
import { BUILTIN_TEMPLATES } from "@/lib/template-builder";
beforeEach(() => {
  vi.clearAllMocks();
  db.systemSetting.findMany.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue({ name: "合成律师", phone: "" });
  db.matter.findUnique.mockResolvedValue({ internalCode: "TEST-EXECUTION", title: "合成执行案", category: "CIVIL_COMMERCIAL", cause: null, primaryClient: null, parties: [], procedures: [], intakeDate: null });
});
describe("执行文书实际渲染", () => {
  it.each(BUILTIN_TEMPLATES.filter(template => template.category === "EXECUTION"))("renders $name with actual nested values", async template => {
    const original = await template.buildBuffer();
    expect([...template.variables].sort()).toEqual(extractDocxVariables(original));
    const empty = await buildContext({ userId: "fixture" });
    const context = { ...empty, client: { ...empty.client }, opposing: { ...empty.opposing }, third: { ...empty.third } };
    for (const path of template.variables) {
      const parts = path.split(".");
      let node: Record<string, unknown> = context;
      for (const part of parts.slice(0, -1)) { node[part] ??= {}; node = node[part] as Record<string, unknown>; }
      node[parts.at(-1)!] = `合成值_${path}`;
    }
    const rendered = renderDocxBuffer(original, context);
    const xml = new PizZip(rendered).file("word/document.xml")!.asText();
    for (const path of template.variables) expect(xml).toContain(`合成值_${path}`);
    expect(xml).not.toContain("undefined");
    expect(xml).not.toContain("{{");
  });
  it("keeps execution overrides in the rendering snapshot without changing client source data", async () => {
    const result = await buildContext({ matterId: "fixture", userId: "fixture", templateCategory: "EXECUTION", overrides: { "execution.basis": "合成判决书", "execution.basisNo": "合成文号", "proceeding.court": "合成执行法院" } });
    expect(result.execution).toMatchObject({ basis: "合成判决书", basisNo: "合成文号" });
    expect(result.proceeding.court).toBe("合成执行法院");
    expect(db.client.update).not.toHaveBeenCalled();
    expect(db.party.update).not.toHaveBeenCalled();
    expect(db.matter.findUnique.mock.calls[0][0].include.procedures.where.type.in).toContain("ENFORCEMENT");
  });
  it("blocks prototype paths and renders missing values as blanks", async () => {
    const template = BUILTIN_TEMPLATES.find(item => item.category === "EXECUTION")!;
    const zip = new PizZip(await template.buildBuffer());
    const xml = zip.file("word/document.xml")!.asText().replaceAll("{{client.name}}", "{{constructor.name}}");
    zip.file("word/document.xml", xml);
    const context = await buildContext({ userId: "fixture" });
    const rendered = renderDocxBuffer(zip.generate({ type: "nodebuffer" }), context as RenderContext);
    expect(new PizZip(rendered).file("word/document.xml")!.asText()).not.toMatch(/undefined|function Object/);
  });
  it("ignores stale execution overrides when another template category is selected", async () => {
    db.matter.findUnique.mockResolvedValueOnce({ internalCode: "TEST-CIVIL", title: "合成诉讼案", category: "CIVIL_COMMERCIAL", cause: null, primaryClient: null, parties: [], procedures: [{ type: "FIRST_INSTANCE", caseNumber: "诉讼案号", handlingAgency: "诉讼法院" }], intakeDate: null });
    const result = await buildContext({ matterId: "fixture", userId: "fixture", templateCategory: "LITIGATION", overrides: { "execution.basis": "之前的执行依据", "proceeding.caseNo": "之前的执行案号", "proceeding.court": "之前的执行法院" } });
    expect(result.proceeding).toMatchObject({ caseNo: "诉讼案号", court: "诉讼法院" });
    expect(result.execution.basis).toBe("");
  });
});
