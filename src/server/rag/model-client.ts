import { createHash } from "node:crypto";
import { z } from "zod";
import { ServiceFailure, type ServiceTransport } from "./service-transport";

const embeddingReply = z.object({
  model: z.string().optional(),
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()) })),
});
const chatReply = z.object({ model: z.string().optional(), choices: z.array(z.object({ finish_reason: z.literal("stop"), message: z.object({ content: z.string().min(1) }) })).min(1) });

// W04.4 protocol client; the caller must authorize material processing and audit it.
export function createModelClient(transport: ServiceTransport, model: string, dimensions: number) {
  if (!model.trim() || !Number.isInteger(dimensions) || dimensions < 1) throw new ServiceFailure("INVALID_INPUT");
  return {
    async embed(texts: readonly string[]): Promise<number[][]> {
      if (!texts.length || texts.length > 128 || texts.some(text => !text.trim())) throw new ServiceFailure("INVALID_INPUT");
      const result = embeddingReply.safeParse(await transport.request("/embeddings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: texts, encoding_format: "float" }),
      }));
      if (!result.success || result.data.data.length !== texts.length) throw new ServiceFailure("INVALID_RESULT");
      if (result.data.model && result.data.model !== model) throw new ServiceFailure("STALE_INDEX");
      const ordered = result.data.data.toSorted((a, b) => a.index - b.index);
      if (ordered.some((item, index) => item.index !== index || item.embedding.length !== dimensions ||
          item.embedding.every(value => value === 0))) throw new ServiceFailure("INVALID_RESULT");
      return ordered.map(item => item.embedding);
    },
    async generate(prompt: string): Promise<string> {
      if (!prompt.trim() || prompt.length > 100_000) throw new ServiceFailure("INVALID_INPUT");
      const result = chatReply.safeParse(await transport.request("/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 512, stream: false }),
      }));
      if (!result.success) throw new ServiceFailure("INVALID_RESULT");
      if (result.data.model && result.data.model !== model) throw new ServiceFailure("STALE_INDEX");
      return result.data.choices[0].message.content;
    },
  };
}

/** Credentials never enter the fingerprint. Revisions are configured, not inferred. */
export function modelOptionsFingerprint(baseUrl: string, protocol: string, options: Record<string, string | number | boolean>) {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash) throw new ServiceFailure("INVALID_INPUT");
  return createHash("sha256").update(JSON.stringify({ endpoint: url.href.replace(/\/$/, ""), protocol,
    options: Object.entries(options).sort(([a], [b]) => a.localeCompare(b)),
  })).digest("hex");
}
