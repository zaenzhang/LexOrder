import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireFromTest = createRequire(import.meta.url);
const picomatch = requireFromTest("picomatch") as {
  (pattern: string): (value: string) => boolean;
  makeRe(pattern: string, options?: { maxExtglobRecursion?: false; unescape?: boolean; nobrace?: boolean }): RegExp;
};

describe("picomatch 的项目内安全版本", () => {
  it("继续匹配工作台常用的目录、后缀、排除和有限重复", () => {
    expect(picomatch("src/@(app|components)/**/*.{ts,tsx}")("src/app/案件/page.tsx")).toBe(true);
    expect(picomatch("src/!(*.test).ts")("src/example.test.ts")).toBe(false);
    expect(picomatch("assets/+(logo).svg")("assets/logologo.svg")).toBe(true);
    expect(picomatch("assets/+([*]).svg")("assets/**.svg")).toBe(true);
  });

  it("仅在会输出无界量词的解析选项下拦截相同写法", () => {
    const escaped = String.raw`assets/+(logo\*).svg`;
    expect(picomatch(escaped)("assets/logo*.svg")).toBe(true);
    expect(() => picomatch.makeRe(escaped, { unescape: true })).toThrow(SyntaxError);
    expect(() => picomatch.makeRe("assets/+(logo{1,}).svg", { nobrace: true })).toThrow(SyntaxError);
  });

  it.each(["assets/+(brand*).svg", "assets/+(@(brand*)).svg"])("在编译阶段拒绝无界重复 %s", pattern => {
    expect(() => picomatch.makeRe(pattern)).toThrow(SyntaxError);
    expect(() => picomatch.makeRe(pattern, { maxExtglobRecursion: false })).toThrow(SyntaxError);
  });
});
