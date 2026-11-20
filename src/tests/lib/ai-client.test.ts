import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiChat } from "@/lib/ai/client";

const mock = vi.hoisted(() => ({ settings: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/ai/settings", () => ({ getAiSettings: mock.settings }));
vi.mock("@/lib/external-call-log", () => ({ withExternalCallLog: (_event: unknown, run: () => unknown) => run() }));
vi.mock("@/lib/net/safe-url", () => ({ assertSafeHttpUrl: async () => {}, safeFetch: mock.fetch }));

describe("结构化请求只发送一次输出约束", () => {
  const schema = { type: "object", properties: {}, required: [], additionalProperties: false };
  const request = {
    messages: [{ role: "system" as const, content: "只返回符合约定的数据。" }],
    jsonSchema: { name: "fixture", schema },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetch.mockImplementation(async () => Response.json({ choices: [{ message: { content: "{}" } }] }));
  });

  it("OpenAI 原生结构化输出只通过 response_format 传契约", async () => {
    mock.settings.mockResolvedValue({ configured: true, apiKey: "fixture", baseUrl: "https://api.openai.com/v1", textModel: "gpt-4.1-mini-2025-04-14" });
    await aiChat(request);
    const body = JSON.parse(mock.fetch.mock.calls[0][1].body);
    expect(body.messages).toEqual(request.messages);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { ...request.jsonSchema, strict: true } });
  });

  it("未启用原生 schema 的供方只在系统消息发送契约", async () => {
    mock.settings.mockResolvedValue({ configured: true, apiKey: "fixture", baseUrl: "https://fixture.invalid/v1", textModel: "fixture" });
    await aiChat(request);
    const body = JSON.parse(mock.fetch.mock.calls[0][1].body);
    expect(body.response_format).toBeUndefined();
    expect(body.messages).toEqual([{ role: "system", content: "输出结构：" + JSON.stringify(schema) }, ...request.messages]);
  });
});
