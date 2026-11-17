// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
const db = vi.hoisted(() => ({
  systemSetting: { findMany: vi.fn() }, user: { findUnique: vi.fn() },
  matter: { findUnique: vi.fn() }, client: { update: vi.fn() }, party: { findFirst: vi.fn(), update: vi.fn() }
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { buildContext, renderDocxBuffer, extractDocxVariables, inspectTemplateFields, type RenderContext } from "@/lib/template-engine";
import { BUILTIN_TEMPLATES, pack, body } from "@/lib/template-builder";
beforeEach(() => {
  vi.clearAllMocks();
  db.systemSetting.findMany.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue({ name: "合成律师", phone: "" });
  db.matter.findUnique.mockResolvedValue({ internalCode: "TEST-EXECUTION", title: "合成执行案", category: "CIVIL_COMMERCIAL", cause: null, primaryClient: null, clientLinks: [], parties: [], procedures: [], intakeDate: null });
});

describe("实际 DOCX 作用域与本稿字段", () => {
  const xml = (buffer: Buffer) => new PizZip(buffer).file("word/document.xml")!.asText();
  it("真实循环成员缺值按行补填，空字符串不借根同名值，根字段只在实际缺失时回退", async () => {
    const base = await buildContext({ userId: "fixture" });
    base.extraNote = "根备注";
    base.plaintiffs = [{ ...base.client, name: "甲" }, { ...base.client, name: "乙", extraNote: "" } as typeof base.client];
    const buffer = await pack([body("{{#plaintiffs}}{{name}}：{{extraNote}}；{{/plaintiffs}}")]);
    const initial = inspectTemplateFields(buffer, base);
    expect(initial.fields.filter(field => field.missing).map(field => field.path)).toEqual(["plaintiffs.1.extraNote"]);
    expect(initial.fields.map(field => field.path)).toContain("extraNote");
    const filled = inspectTemplateFields(buffer, base, { "plaintiffs.1.extraNote": "乙本稿备注" });
    expect(filled.fields.some(field => field.missing)).toBe(false);
    expect(xml(filled.render())).toContain("甲：根备注；乙：乙本稿备注；");
    expect(xml(filled.render())).toEqual(xml(renderDocxBuffer(buffer, filled.context)));
    expect(base.plaintiffs[1]).toHaveProperty("extraNote", "");
    const invalidOverrides: Record<string, string>[] = [{ "plaintiffs.2.extraNote": "越界" }, { plaintiffs: "整组替换" }, { "plaintiffs.0.__proto__.x": "原型" }];
    for (const input of invalidOverrides) {
      expect(() => inspectTemplateFields(buffer, base, input)).toThrow();
    }
  });

  it("空可选集合跳过正向字段，反向块仅核真实活跃标量；隐藏草稿不进输出或context", async () => {
    const base = await buildContext({ userId: "fixture" });
    base.custom = { show: "", detail: "" };
    const buffer = await pack([body("{{#thirds}}{{name}}{{/thirds}}{{^thirds}}无第三人{{/thirds}}{{#custom.show}}{{custom.detail}}{{/custom.show}}")]);
    const hidden = inspectTemplateFields(buffer, base, { "custom.detail": "暂存草稿" });
    expect(hidden.fields.some(field => field.missing)).toBe(false);
    expect(hidden.fields.map(field => field.path)).toEqual(["thirds", "custom.show"]);
    expect(hidden.context.custom).toEqual({ show: "", detail: "" });
    expect(hidden.appliedOverrides).toEqual({});
    expect(xml(hidden.render())).toContain("无第三人");
    expect(xml(hidden.render())).not.toContain("暂存草稿");
    const active = inspectTemplateFields(buffer, base, { "custom.show": "显示", "custom.detail": "暂存草稿" });
    expect(active.fields.find(field => field.path === "custom.detail")).toMatchObject({ required: true, missing: false, value: "暂存草稿" });
    expect(active.expectedValues["custom.detail"]).not.toContain("暂存草稿");
    expect(xml(active.render())).toContain("暂存草稿");
  });

  it("后置根字段的补填先参与前方循环fallback，不制造额外行级必填", async () => {
    const base = await buildContext({ userId: "fixture" });
    base.plaintiffs = [{ ...base.client, name: "甲" }];
    const buffer = await pack([body("{{#plaintiffs}}{{extraNote}}{{/plaintiffs}}|{{extraNote}}")]);
    const filled = inspectTemplateFields(buffer, base, { extraNote: "统一备注" });
    expect(filled.fields.map(field => field.path)).toEqual(["plaintiffs", "extraNote"]);
    expect(xml(filled.render())).toContain("统一备注|统一备注");
  });

  it("后置补填创建的对象同样影响前方块；补齐新激活字段后观察与真实输出一致", async () => {
    const base = await buildContext({ userId: "fixture" });
    const buffer = await pack([body("{{#custom}}{{foo}}/{{bar}}{{/custom}}|{{custom.foo}}")]);
    const partial = inspectTemplateFields(buffer, base, { "custom.foo": "前项" });
    expect(partial.fields.filter(field => field.missing).map(field => field.path)).toEqual(["custom.bar"]);
    const filled = inspectTemplateFields(buffer, base, { "custom.foo": "前项", "custom.bar": "后项" });
    expect(filled.fields.some(field => field.missing)).toBe(false);
    expect(xml(filled.render())).toContain("前项/后项|前项");
    expect(xml(filled.render())).toEqual(xml(renderDocxBuffer(buffer, filled.context)));
  });

  it("纯归档目录渲染保留真实两行的可空页码和备注", async () => {
    const base = await buildContext({ userId: "fixture" });
    base.documents = [{ name: "原件甲", pages: "", remark: "" }, { name: "原件乙", pages: "2", remark: "" }];
    const buffer = await pack([body("{{#documents}}{{name}}/{{pages}}/{{remark}}；{{/documents}}")]);
    expect(xml(renderDocxBuffer(buffer, base))).toContain("原件甲//；原件乙/2/；");
  });
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
  it("rejects values outside the current template instead of retaining a previous template's fields", async () => {
    await expect(buildContext({ matterId: "fixture", userId: "fixture", templateCategory: "LITIGATION", variables: ["client.phone"], overrides: { "execution.basis": "之前的执行依据" } })).rejects.toThrow("补填字段不属于当前模板");
  });
  it("uses the selected second opposing party and procedure without changing either master record", async () => {
    const party = (id: string, name: string, phone: string) => ({ id, name, phone, role: "OPPOSING_PARTY", idNumber: null, address: null, legalRep: null });
    db.matter.findUnique.mockResolvedValue({ internalCode: "TEST-CIVIL", title: "合成诉讼案", category: "CIVIL_COMMERCIAL", cause: null,
      primaryClient: { id: "client1", name: "原委托人", idNumber: null, address: null, phone: "原电话" }, clientLinks: [],
      parties: [party("opp1", "对方一", "电话一"), party("opp2", "对方二", "电话二")],
      procedures: [{ id: "proc1", type: "FIRST_INSTANCE", caseNumber: "一审", handlingAgency: "法院一" }, { id: "proc2", type: "SECOND_INSTANCE", caseNumber: "二审", handlingAgency: "法院二" }], intakeDate: null });
    const result = await buildContext({ matterId: "fixture", userId: "fixture", templateCategory: "LITIGATION",
      selection: { clientId: "client1", opposingPartyId: "opp2", thirdPartyId: null, procedureId: "proc2" },
      variables: ["client.phone", "opposing.phone"], overrides: { "client.phone": "仅本稿委托人电话", "opposing.phone": "仅本稿对方电话" } });
    expect(result.opposing).toMatchObject({ name: "对方二", phone: "仅本稿对方电话" });
    expect(result.client.phone).toBe("仅本稿委托人电话");
    expect(result.proceeding).toMatchObject({ caseNo: "二审", court: "法院二" });
    expect(db.client.update).not.toHaveBeenCalled(); expect(db.party.update).not.toHaveBeenCalled();
  });
  it("rejects a chosen party no longer belonging to the matter", async () => {
    await expect(buildContext({ matterId: "fixture", userId: "fixture", selection: { clientId: null, opposingPartyId: "other-matter", thirdPartyId: null, procedureId: null } })).rejects.toThrow("对方当事人已不属于当前案件");
  });
});
