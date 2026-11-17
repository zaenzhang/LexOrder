import { describe, expect, it } from "vitest";
import { carriedContextInputs, contextInputSelectionsSchema } from "@/lib/matters/context-inputs";

const id = "cm00000000000000000000001", tail = "cm00000000000000000000002";
describe("目标与指示的固定采用合同", () => {
  it("同一确认时点统一ISO后去重，不因时区或毫秒写法产生不同请求", () => {
    expect(contextInputSelectionsSchema.parse([
      { recordId: id, expectedCurrentRecordId: tail, expectedConfirmedAt: "2026-11-17T16:00:00+08:00" },
      { recordId: id, expectedCurrentRecordId: tail, expectedConfirmedAt: "2026-11-17T08:00:00.000Z" },
    ])).toEqual([{ recordId: id, expectedCurrentRecordId: tail, expectedConfirmedAt: "2026-11-17T08:00:00.000Z" }]);
  });
  it("同一修订携矛盾所见状态时拒绝，不取最后一项冒充核对", () => {
    expect(() => contextInputSelectionsSchema.parse([
      { recordId: id, expectedCurrentRecordId: id, expectedConfirmedAt: null },
      { recordId: id, expectedCurrentRecordId: tail, expectedConfirmedAt: null },
    ])).toThrow("核对位置不一致");
  });
  it("新版本沿用固定ID和原核对位置，读取的新末版和新确认不自动成为已核对", () => {
    expect(carriedContextInputs({ unavailable: false, inputs: [{
      selection: { recordId: id, expectedCurrentRecordId: tail, expectedConfirmedAt: "2026-11-17T08:00:00.000Z" },
      kind: "GOAL", version: 1, content: "合成目标", sourceDescription: "合成记录", historical: false, changed: true,
      currentRecordIdAtAdoption: id, adoptedConfirmedAt: null,
    }] })).toEqual([{ recordId: id, expectedCurrentRecordId: id, expectedConfirmedAt: null }]);
  });
});
