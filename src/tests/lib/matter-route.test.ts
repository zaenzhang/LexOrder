import { describe, expect, it } from "vitest";
import { decodeMatterParam, matterHref, normalizeMatterParam } from "@/lib/matters/route";

describe("matterHref", () => {
  it("用 internalCode 作路由键", () => {
    expect(matterHref({ id: "cmq3lxgrm002nitzfhh8qn8ql", internalCode: "M-2026-001" })).toBe(
      "/matters/M-2026-001"
    );
  });

  it("internalCode 为空时回退到 id，链接不会断", () => {
    expect(matterHref({ id: "cmq3lxgrm002nitzfhh8qn8ql", internalCode: null })).toBe(
      "/matters/cmq3lxgrm002nitzfhh8qn8ql"
    );
    expect(matterHref({ id: "cmq3lxgrm002nitzfhh8qn8ql", internalCode: "  " })).toBe(
      "/matters/cmq3lxgrm002nitzfhh8qn8ql"
    );
  });

  it("支持子路径后缀", () => {
    expect(matterHref({ id: "x", internalCode: "LL-2026-CC-0001" }, "#finance")).toBe(
      "/matters/LL-2026-CC-0001#finance"
    );
  });

  it("对编号做 URL 编码，异常字符不会破坏地址", () => {
    expect(matterHref({ id: "x", internalCode: "M 2026/001" })).toBe("/matters/M%202026%2F001");
  });
});

describe("decodeMatterParam", () => {
  it("解码及去空白后保留混合大小写编号和旧 ID", () => {
    expect(decodeMatterParam(" M2C%2D2fa82183%2D21 ")).toBe("M2C-2fa82183-21");
    expect(decodeMatterParam("cmq3lxgrm002nitzfhh8qn8ql")).toBe("cmq3lxgrm002nitzfhh8qn8ql");
  });

  it("裸百分号保留原文，不抛出解码异常", () => {
    expect(decodeMatterParam(" M2C-100%a ")).toBe("M2C-100%a");
  });
});

describe("normalizeMatterParam", () => {
  it("手打小写地址能命中", () => {
    expect(normalizeMatterParam("m-2026-001")).toBe("M-2026-001");
  });

  it("去掉首尾空白", () => {
    expect(normalizeMatterParam("  M-2026-001 ")).toBe("M-2026-001");
  });

  it("先做 URL 解码", () => {
    expect(normalizeMatterParam("M%2D2026%2D001")).toBe("M-2026-001");
  });

  it("参数里有裸 % 时不抛异常", () => {
    expect(() => normalizeMatterParam("M-2026-100%")).not.toThrow();
    expect(normalizeMatterParam("M-2026-100%")).toBe("M-2026-100%");
  });

  it("兼容既有大写输出；事项解析另用保留大小写的解码值", () => {
    expect(normalizeMatterParam("cmq3lxgrm002nitzfhh8qn8ql")).toBe(
      "CMQ3LXGRM002NITZFHH8QN8QL"
    );
  });
});
