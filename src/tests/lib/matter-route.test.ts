import { describe, expect, it } from "vitest";
import { matterHref } from "@/lib/matters/route";

describe("案件编号地址", () => {
  it("保留实际编号的大小写，不用内部 ID", () => {
    const matter = { id: "cmq3lxgrm002nitzfhh8qn8ql", internalCode: "M2C-2fa82183-21" };
    expect(matterHref(matter)).toBe("/matters/M2C-2fa82183-21");
  });

  it("编码完整编号，不去空白或重复解释字面百分号", () => {
    expect(matterHref({ internalCode: "M 2026/001" })).toBe("/matters/M%202026%2F001");
    expect(matterHref({ internalCode: "M2C-%2F-a" })).toBe("/matters/M2C-%252F-a");
  });

  it("保留调用方的工作位置后缀", () => {
    expect(matterHref({ internalCode: "LL-2026-CC-0001" }, "?view=work#materials")).toBe(
      "/matters/LL-2026-CC-0001?view=work#materials"
    );
  });
});
