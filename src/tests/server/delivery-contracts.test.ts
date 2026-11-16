// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import { briefSchema, deliveryState, prepareDeliverySchema, registerDeliveryEventSchema } from "@/server/deliveries/contracts";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/documents/material-ingest", () => ({ ingestMaterial: vi.fn() }));
import { renderClientBriefBytes } from "@/server/deliveries/brief";

const matterId = "cmatterdelivery000000000001", documentId = "cdocdelivery00000000000001";
const preparation = () => ({ matterId, requestKey: randomUUID(), documentIds: [documentId],
  recipientName: "合成接收人", recipientContact: "synthetic@example.invalid", purpose: "阶段简报",
  disclosureScope: "仅所列文书，不含其他案卷", unresolvedItems: "仍待核实原件" });

describe("交付的事实边界", () => {
  it("导出不代表发送，收悉不替代原发送事实", () => {
    expect(deliveryState([])).toBe("PREPARED");
    expect(deliveryState([{ kind: "EXPORTED" }])).toBe("EXPORTED");
    expect(deliveryState([{ kind: "RECEIVED" }])).toBe("PREPARED");
    expect(deliveryState([{ kind: "EXPORTED" }, { kind: "SENT" }])).toBe("SENT");
  });
  it("清单保留顺序而拒绝重复和空接收信息", () => {
    const another = "cdocdelivery00000000000002";
    expect(prepareDeliverySchema.parse({ ...preparation(), documentIds: [another, documentId] }).documentIds).toEqual([another, documentId]);
    expect(prepareDeliverySchema.safeParse({ ...preparation(), documentIds: [documentId, documentId] }).success).toBe(false);
    expect(prepareDeliverySchema.safeParse({ ...preparation(), recipientContact: " " }).success).toBe(false);
    expect(prepareDeliverySchema.safeParse({ ...preparation(), latest: true }).success).toBe(false);
  });
  it("发送必须有渠道和事实说明，更正必须明确关联原登记", () => {
    const event = { deliveryId: "cdelivery00000000000000001", requestKey: randomUUID(), kind: "SENT", occurredAt: "2026-01-01T10:00:00+08:00", note: "合成邮件实际发送", channel: "邮件" };
    expect(registerDeliveryEventSchema.safeParse(event).success).toBe(true);
    expect(registerDeliveryEventSchema.safeParse({ ...event, note: "" }).success).toBe(false);
    expect(registerDeliveryEventSchema.safeParse({ ...event, channel: "" }).success).toBe(false);
    expect(registerDeliveryEventSchema.safeParse({ ...event, kind: "SEND_CORRECTION" }).success).toBe(false);
    expect(registerDeliveryEventSchema.safeParse({ ...event, kind: "SEND_CORRECTION", correctsEventId: "ceventdelivery000000000001" }).success).toBe(true);
    expect(registerDeliveryEventSchema.safeParse({ ...event, kind: "REPLIED", correctsEventId: "ceventdelivery000000000001" }).success).toBe(false);
  });
  it("手工简报不会接受已有批准、发送或自动摘要状态", () => {
    const input = { matterId, requestKey: randomUUID(), title: "合成简报", content: "进展待核实" };
    expect(briefSchema.safeParse(input).success).toBe(true);
    expect(briefSchema.safeParse({ ...input, status: "APPROVED" }).success).toBe(false);
  });
  it("同一手工正文在不同时刻生成完全相同字节，重试不改变原件身份", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const first = await renderClientBriefBytes({ title: "合成简报", content: "进展\n仍待决定\n下一步" });
      vi.setSystemTime(new Date("2026-11-16T20:00:00Z"));
      const second = await renderClientBriefBytes({ title: "合成简报", content: "进展\n仍待决定\n下一步" });
      expect(first.equals(second)).toBe(true);
      const zip = new PizZip(first);
      expect(zip.file("word/document.xml")?.asText()).toContain("仍待决定");
      expect(zip.file("docProps/core.xml")?.asText()).not.toContain("dcterms:created");
      const changed = await renderClientBriefBytes({ title: "合成简报", content: "实际客户指示另行记录" });
      expect(first.equals(changed)).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
