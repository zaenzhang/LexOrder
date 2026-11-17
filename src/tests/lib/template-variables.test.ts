import { describe, it, expect, vi } from "vitest";
import PizZip from "pizzip";
import { Document, Header, Paragraph, Packer } from "docx";
import { extractDocxVariables } from "@/lib/template-engine";
import { recordTimelineEvent } from "@/server/timeline/record";

async function docxWith(xml: string): Promise<Buffer> {
  const zip = new PizZip(await Packer.toBuffer(new Document({ sections: [{ headers: { default: new Header({ children: [new Paragraph("{{firm.name}}") ] }) }, children: [new Paragraph("TEST_BODY")] }] })));
  zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace("<w:t xml:space=\"preserve\">TEST_BODY</w:t>", xml));
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

describe("extractDocxVariables（模板上传变量提取）", () => {
  it("提取正文与页眉变量、循环段标签，去重排序", async () => {
    const buf = await docxWith(
      "<w:t>{{client.name}}</w:t><w:t>{{ client.idNumber }}</w:t><w:t>{{#plaintiffs}}</w:t><w:t>{{client.name}}</w:t><w:t>{{/plaintiffs}}</w:t>"
    );
    expect(extractDocxVariables(buf)).toEqual(["client.idNumber", "client.name", "firm.name", "plaintiffs"]);
  });

  it("跨 run 拆分的占位符（XML 标签穿插）仍可提取", async () => {
    const buf = await docxWith("<w:t>{{mat</w:t><w:t>ter.title}}</w:t>");
    expect(extractDocxVariables(buf)).toContain("matter.title");
  });

  it("正文无变量时仅返回页眉真实字段", async () => {
    const buf = await docxWith("<w:t>固定文本，无占位符</w:t>");
    expect(extractDocxVariables(buf)).toEqual(["firm.name"]); // 仅页眉示例变量
  });
  it("拒绝未闭合循环，而不把错误模板登记为可用字段清单", async () => {
    const awaitedBuffer = await docxWith("<w:t>{{#plaintiffs}}{{name}}</w:t>");
    expect(() => extractDocxVariables(awaitedBuffer)).toThrow("模板格式有误");
  });
});

describe("recordTimelineEvent（时间线唯一写入口）", () => {
  it("默认补 occurredAt，透传其余字段", async () => {
    const create = vi.fn(async () => ({}));
    await recordTimelineEvent({ timelineEvent: { create } } as never, {
      matterId: "cmatter000000000000000000001",
      eventType: "TEST",
      title: "测试事件",
      content: "说明"
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matterId: "cmatter000000000000000000001",
        eventType: "TEST",
        title: "测试事件",
        content: "说明",
        occurredAt: expect.any(Date)
      })
    });
  });
});
