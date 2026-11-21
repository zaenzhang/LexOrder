import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ActionError } from "@/lib/action-error";
import { prisma } from "@/lib/prisma";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { isPersonalMode } from "@/lib/runtime/mode";
import { resolvePersonalActor } from "@/server/runtime/personal";
import { externalSkillResultSchema } from "@/server/skills/signoff-contract";
import { changeSignoff, hashSkillToken } from "@/server/skills/signoff-service";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

async function authenticate(request: Request) {
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(request.headers, { method: request.method, requireCookie: false, allowMissingOrigin: true })) {
    return new Response(null, { status: 403, headers });
  }
  const denied = () => new Response(null, { status: 401, headers: { ...headers, "WWW-Authenticate": "Bearer" } });
  const token = /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return denied();
  const tokenHash = hashSkillToken(token);
  const grant = await prisma.skillHostGrant.findUnique({
    where: { tokenHash }, select: { id: true, expiresAt: true, revokedAt: true,
      commission: { select: { id: true, matterId: true } } },
  });
  if (!grant || grant.revokedAt || grant.expiresAt.getTime() <= Date.now()) return denied();
  return { grant: { id: grant.id, tokenHash }, commission: grant.commission };
}

export async function POST(request: Request) {
  const authentication = await authenticate(request);
  if (authentication instanceof Response) return authentication;
  const { grant, commission } = authentication;
  const server = new McpServer({ name: "lexorder-signoff", version: "1.0.0" });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: 128_000 });
  const scope = { matterId: commission.matterId, id: commission.id };
  async function respond(action: Parameters<typeof changeSignoff>[1]) {
    try {
      const actor = await resolvePersonalActor(prisma);
      if (!actor) throw new ActionError("授权所属的本机操作者已不可用");
      const result = await changeSignoff(actor, action, grant);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const,
        text: error instanceof ActionError ? error.message : "委托服务暂时无法处理请求" }] };
    }
  }
  server.registerTool("read_signoff_packet", {
    title: "读取固定核对输入", description: "读取当前授权委托的任务、固定片段和核对方法。每个片段包含原句和编号。重复读取范围相同。",
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, () => respond({ ...scope, action: "export-signoff", confirmed: true }));
  server.registerTool("submit_signoff_result", {
    title: "提交待核稿", description: "提交本委托的候选结论与逐字引文。相同内容可以重复提交，律师决定是否采用。",
    inputSchema: externalSkillResultSchema, annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, result => respond({ ...scope, action: "submit-signoff", result }));
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    await server.close();
  }
}

// Stateless JSON responses do not expose a server-event stream or mutable MCP session.
export async function GET(request: Request) {
  const authentication = await authenticate(request);
  return authentication instanceof Response ? authentication : new Response(null, { status: 405, headers });
}

export const DELETE = GET;
