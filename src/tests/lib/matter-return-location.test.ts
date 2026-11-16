import { describe, expect, it } from "vitest";
import { isMatterReturnHref } from "@/lib/matters/return-location";

const matter = { internalCode: "LL-2026-CC-0001" };
describe("案件返回地址的具体对象边界", () => {
  it("接受真实编号的完整位置，不剥离查询参数或片段", () => {
    const value = "/matters/LL-2026-CC-0001?view=work&workPane=facts&procedure=proc&stage=stage&detail=source&evidence=item&source=source&revision=2#position";
    expect(isMatterReturnHref(value, matter)).toBe(true);
    expect(isMatterReturnHref("/matters/LL-2026-CC-0001?view=money", matter)).toBe(true);
  });
  it.each([
    "https://example.invalid/matters/LL-2026-CC-0001", "//example.invalid/matters/LL-2026-CC-0001",
    "/\\example.invalid/matters/LL-2026-CC-0001", "/matters/LL-2026-CC-0001\n",
    "/matters/coldmatter00000000000001", "/matters/LL-2026-CC-0002", "/matters/ll-2026-cc-0001",
    "/other/../matters/LL-2026-CC-0001", "/matters/LL-2026-CC-0001/",
    "/matters/LL-2026-CC-0001?returnTo=%2Fmatters", "/matters/LL-2026-CC-0001?%72eturnTo=%2Fmatters",
    "/matters/LL-2026-CC-0001?detail=create", "/matters/LL-2026-CC-0001?action=create",
  ])("拒绝外站、错案、旧ID、非规范路径或递归目标 %s", value => {
    expect(isMatterReturnHref(value, matter)).toBe(false);
  });
});
