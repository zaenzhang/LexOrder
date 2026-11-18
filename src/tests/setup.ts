import "@douyinfe/semi-ui/react19-adapter";
import "@testing-library/jest-dom/vitest";
import { randomBytes } from "node:crypto";
import { createCanvas, type Canvas } from "@napi-rs/canvas";

// 独立运行单测不读取部署 .env；使用本次测试进程的临时密钥。
process.env.STORAGE_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

// Semi 的 Lottie 在模块加载时会请求 2D 上下文。jsdom 使用项目已有的 Canvas 实现。
if (typeof HTMLCanvasElement !== "undefined") {
  const canvasByElement = new WeakMap<HTMLCanvasElement, Canvas>();
  const getContext = HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value(this: HTMLCanvasElement, type: string, options?: unknown) {
      if (type !== "2d") return getContext.call(this, type, options);
      let backing = canvasByElement.get(this);
      if (!backing) {
        backing = createCanvas(this.width, this.height);
        canvasByElement.set(this, backing);
      }
      return backing.getContext("2d");
    }
  });
}

// jsdom omits geometry APIs used by Semi typography, tables, tabs and collapsibles.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Range !== "undefined") {
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
}
