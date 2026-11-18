"use client";

import { Button, Checkbox, Form, Input, Select, TextArea, Toast } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import { actionErrorMessage } from "@/lib/action-error";
import { shMonthDayTime } from "@/lib/ui/sh-time";
import { mcpPreset } from "@/lib/legal-mcp/catalog";
import { MCP_STATE_LABELS, MCP_FAILURE_LABELS, type PublicMcpConfig, type McpTool, type McpQueryResult, type McpPhase } from "@/lib/legal-mcp/contracts";
import { saveLegalMcpSettingsAction, testLegalMcpConnection, discoverLegalMcpTools, queryLegalMcpTool } from "@/server/legal/mcp-actions";

const PHASE_LABELS: Record<McpPhase, string> = { connection: "初始化连接", tools: "工具发现", query: "实际检索" };

export function LegalMcpSettingsForm({ initial }: { initial: PublicMcpConfig[] }) {
  const [configs, setConfigs] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  function saved(config: PublicMcpConfig, created = false) {
    setConfigs(previous => previous.some(item => item.id === config.id) ? previous.map(item => item.id === config.id ? config : item) : [...previous, config]);
    if (created) {
      setAdding(false);
      setCreatedId(config.id);
    }
  }
  return (
    <section className="ll-surface rounded-lg border border-border p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">法律 MCP（可选）</h2><Button size="small" theme="outline" disabled={adding} onClick={() => setAdding(true)}>添加自定义服务</Button></div>
      <p className="mb-4 text-xs text-muted-foreground">预设仅提供官方接入地址，默认关闭。保存不会联网；检查连接、发现工具和检索分别执行，可能受平台授权与计费规则限制。</p>
      <div className="divide-y divide-border">
        {configs.map(config => <McpServiceEditor key={config.id} config={config} initiallyOpen={createdId === config.id} onSaved={saved} />)}
        {adding && <McpServiceEditor config={{ id: "", name: "", endpoint: "", enabled: false, authentication: "bearer", revision: null, hasKey: false, allowedTools: [], state: "DISABLED", checks: {} }} onSaved={config => saved(config, true)} onCancel={() => setAdding(false)} />}
      </div>
    </section>
  );
}

function McpServiceEditor({ config, initiallyOpen = false, onSaved, onCancel }: { config: PublicMcpConfig; initiallyOpen?: boolean; onSaved: (value: PublicMcpConfig) => void; onCancel?: () => void }) {
  const preset = mcpPreset(config.id);
  const prefix = `mcp-${config.id || "new"}`;
  const [name, setName] = useState(config.name);
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [enabled, setEnabled] = useState(config.enabled);
  const [authentication, setAuthentication] = useState(config.authentication);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [allowed, setAllowed] = useState(config.allowedTools.join("\n"));
  const [confirmed, setConfirmed] = useState(config.allowedTools.length > 0);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [checks, setChecks] = useState(config.checks);
  const [tool, setTool] = useState(config.allowedTools[0] ?? "");
  const [argumentsJson, setArgumentsJson] = useState("{}");
  const [result, setResult] = useState<McpQueryResult | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = name !== config.name || endpoint !== config.endpoint || enabled !== config.enabled || authentication !== config.authentication || !!apiKey || clearKey || allowed !== config.allowedTools.join("\n");
  const canOperate = !pending && !dirty && config.enabled && !!config.revision && !config.configurationError && (config.authentication === "none" || config.hasKey);
  const state = config.enabled && checks.connection ? checks.connection.ok ? "CHECKED" : "CONNECTION_FAILED" : config.state;
  const selected = tools.find(item => item.name === tool);

  function save() {
    setMessage(null);
    startTransition(async () => {
      try {
        const value = await saveLegalMcpSettingsAction({ id: config.id || undefined, expectedRevision: config.revision, name, endpoint, enabled, authentication, apiKey, clearKey, allowedTools: allowed.split(/\r?\n/).map(value => value.trim()).filter(Boolean), confirmReadOnly: confirmed });
        const sameService = value.endpoint === config.endpoint && value.authentication === config.authentication && value.enabled === config.enabled && !apiKey && !clearKey && !value.configurationError;
        setName(value.name);
        setEndpoint(value.endpoint);
        setEnabled(value.enabled);
        setAuthentication(value.authentication);
        setApiKey("");
        setClearKey(false);
        setAllowed(value.allowedTools.join("\n"));
        setConfirmed(value.allowedTools.length > 0);
        // A saved revision has its own checks; old query results never validate it.
        setChecks(value.checks);
        setResult(null);
        if (!sameService) setTools([]);
        if (!sameService || !value.allowedTools.includes(tool)) {
          setTool(value.allowedTools[0] ?? "");
          setArgumentsJson("{}");
        }
        onSaved(value);
        Toast.success("配置已保存，尚未进行连接检查");
      } catch (error) { setMessage({ ok: false, text: actionErrorMessage(error) || "保存失败" }); }
    });
  }
  function run(phase: McpPhase) {
    if (!config.revision) return;
    const input = { id: config.id, revision: config.revision };
    setBusy(phase); setMessage(null);
    if (phase === "query") setResult(null);
    startTransition(async () => {
      try {
        const response = phase === "connection" ? await testLegalMcpConnection(input)
          : phase === "tools" ? await discoverLegalMcpTools(input)
          : await queryLegalMcpTool({ ...input, tool, argumentsJson });
        if (!response.ok) {
          if ("checks" in response && response.checks) setChecks(previous => ({ ...previous, ...response.checks }));
          setMessage({ ok: false, text: response.message });
          return;
        }
        setChecks(previous => ({ ...previous, ...response.checks }));
        if ("tools" in response && response.tools) setTools(response.tools);
        if ("result" in response && response.result) setResult(response.result);
        setMessage({ ok: true, text: phase === "connection" ? "初始化已通过；工具和实际检索尚需分别验证。" : phase === "tools" ? `已读取 ${"tools" in response ? response.tools?.length ?? 0 : 0} 项工具；未自动加入白名单。` : "本次请求已返回，请核对下方结果与来源。" });
      } catch (error) { setMessage({ ok: false, text: actionErrorMessage(error) || "操作失败" }); }
      finally { setBusy(null); }
    });
  }
  return (
    <details className="py-3" open={onCancel || initiallyOpen ? true : undefined}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm"><span className="font-medium">{config.name || "新建自定义服务"}</span><span className="text-xs text-muted-foreground">{MCP_STATE_LABELS[state]}</span></summary>
      <fieldset disabled={pending} className="mt-4 min-w-0 space-y-4">
        {preset && <p className="text-xs text-muted-foreground">{preset.note} <a href={preset.documentation} target="_blank" rel="noreferrer" className="text-primary underline">官方说明</a></p>}
        {config.configurationError && <p role="alert" className="text-sm text-destructive">{config.configurationError}</p>}
        <Checkbox disabled={pending} checked={enabled} onChange={e => setEnabled((e.target.checked === true))}>启用此服务</Checkbox>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Form.Label name={`${prefix}-name`}>服务名称</Form.Label><Input id={`${prefix}-name`} value={name} maxLength={80} readOnly={!!preset} onChange={value => setName(value)} /></div>
          <div><Form.Label name={`${prefix}-endpoint`}>远程 Streamable HTTP 地址</Form.Label><Input id={`${prefix}-endpoint`} value={endpoint} maxLength={600} readOnly={!!preset} onChange={value => setEndpoint(value)} placeholder="https://example.com/mcp" /></div>
          <div className="space-y-1.5">
            <Form.Label id={`${prefix}-auth-label`}>认证方式</Form.Label>
            <Select aria-labelledby={`${prefix}-auth-label`} className="w-full" disabled={pending || !!preset} value={authentication} onChange={value => setAuthentication(value as typeof authentication)}>
              <Select.Option value="bearer">Bearer Token</Select.Option>
              {!preset && <Select.Option value="none">无需凭据（仅公开服务）</Select.Option>}
            </Select>
          </div>
          <div><Form.Label name={`${prefix}-key`}>密钥（加密保存，留空保留）</Form.Label><Input id={`${prefix}-key`} type="password" autoComplete="off" maxLength={4096} disabled={authentication === "none" || clearKey} value={apiKey} placeholder={config.hasKey ? "已保存" : "未设置"} onChange={value => setApiKey(value)} /></div>
        </div>
        {config.hasKey && <Checkbox disabled={pending} checked={clearKey} onChange={e => { setClearKey((e.target.checked === true)); setApiKey(""); }}>清除已保存的密钥（保存后生效）</Checkbox>}
        <div><Form.Label name={`${prefix}-allowlist`}>只读工具白名单（每行一个完整工具名）</Form.Label><TextArea id={`${prefix}-allowlist`} rows={3} value={allowed} onChange={value => { setAllowed(value); setConfirmed(false); }} placeholder="先保存配置并发现工具，再核对需要放行的工具" /><Checkbox className="mt-2" disabled={pending} checked={confirmed} onChange={e => setConfirmed((e.target.checked === true))}><span>我已核实白名单中的工具仅用于读取或检索。服务自报的“只读”提示不会自动授权。</span></Checkbox></div>
        <div className="flex flex-wrap gap-2">
          <Button theme="solid" onClick={save} loading={pending && !busy} disabled={pending}>{pending && !busy ? "保存中…" : "保存配置"}</Button>
          {onCancel && <Button theme="borderless" type="tertiary" onClick={onCancel} disabled={pending}>取消</Button>}
          <Button theme="outline" onClick={() => run("connection")} loading={busy === "connection"} disabled={!canOperate}>{busy === "connection" ? "检查中…" : "检查连接"}</Button>
          <Button theme="outline" onClick={() => run("tools")} loading={busy === "tools"} disabled={!canOperate}>{busy === "tools" ? "读取中…" : "发现工具"}</Button>
        </div>
        {dirty && <p className="text-xs text-muted-foreground">请先保存变更，再对已保存的地址执行检查或检索。</p>}
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">{(["connection", "tools", "query"] as const).map(phase => <div key={phase}><dt className="text-muted-foreground">{PHASE_LABELS[phase]}</dt><dd>{checks[phase] ? `${checks[phase]!.ok ? "通过" : "失败"} · ${shMonthDayTime(checks[phase]!.at)}` : "未验证"}{checks[phase]?.code && <span className="block text-destructive">{MCP_FAILURE_LABELS[checks[phase]!.code!]}</span>}</dd></div>)}</dl>
        {message && <p role="status" className={`text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>{message.text}</p>}
        {tools.length > 0 && <details className="text-sm"><summary className="cursor-pointer">查看已发现的工具（{tools.length}）</summary><div className="mt-2 divide-y rounded-md border px-3">{tools.map(item => <details key={item.name} className="py-2"><summary className="cursor-pointer break-all font-mono text-xs">{item.name}{item.title ? ` · ${item.title}` : ""}</summary><p className="mt-2 whitespace-pre-wrap text-xs">{item.description || "服务未提供说明"}</p><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{JSON.stringify(item.inputSchema, null, 2)}</pre></details>)}</div></details>}
        {config.allowedTools.length > 0 && <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-medium">手动检索</h3>
          <div className="space-y-1.5">
            <Form.Label id={`${prefix}-tool-label`}>已批准的只读工具</Form.Label>
            <Select<string> aria-labelledby={`${prefix}-tool-label`} className="w-full" disabled={pending} value={tool} onChange={value => setTool(String(value))} filter={config.allowedTools.length > 5}>
              {config.allowedTools.map(name => <Select.Option key={name} value={name}>{name}</Select.Option>)}
            </Select>
          </div>
          {selected && <details className="text-xs"><summary className="cursor-pointer">该工具声明的输入格式</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">{JSON.stringify(selected.inputSchema, null, 2)}</pre></details>}
          <div><Form.Label name={`${prefix}-args`}>本次检索参数（JSON 对象）</Form.Label><TextArea id={`${prefix}-args`} rows={4} value={argumentsJson} onChange={value => setArgumentsJson(value)} className="font-mono text-xs" /><p className="mt-1 text-xs text-muted-foreground">只发送此处本次输入的参数；不会自动读取或上传案件、客户、材料或历史对话。</p></div>
          <Button theme="outline" disabled={!canOperate || !tool} onClick={() => run("query")} loading={busy === "query"}>{busy === "query" ? "检索中…" : "执行本次检索"}</Button>
        </div>}
        {result && <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">{result.isError ? "服务返回业务错误" : "检索返回结果"}</h3>
          <p className="break-all text-xs text-muted-foreground">{result.serviceName} · {result.tool} · {shMonthDayTime(result.queriedAt)}<br />{result.endpoint}</p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{result.content || "服务返回空内容"}</pre>
          {result.sources.length > 0 && <ul className="space-y-1 text-xs">{result.sources.map(source => <li key={source.url}><a className="break-all text-primary underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>}
          <p className="text-xs text-muted-foreground">来源由服务提供，需核对原文与适用性；此结果尚未写入证据、事项上下文或确认结论。</p>
        </div>}
      </fieldset>
    </details>
  );
}
