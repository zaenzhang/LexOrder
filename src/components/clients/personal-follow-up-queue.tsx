"use client";

import { Button, Tag } from "@douyinfe/semi-ui";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/patterns/workspace-surfaces";
import { actionErrorMessage } from "@/lib/action-error";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { followUpFilters, personalFollowUpHref, personalFollowUpLocation, type PersonalFollowUpMode, type PersonalFollowUpPage, type PersonalFollowUpQuery, type PersonalFollowUpTarget } from "@/lib/clients/follow-ups";
import { getPersonalFollowUps } from "@/server/clients/relationship-actions";
import { ClientActivityDialog, type ClientActivityMode } from "./client-activity-dialog";
import { ClientFollowUpRescheduleDialog } from "./client-follow-up-reschedule-dialog";

type Editor = { target: PersonalFollowUpTarget; status: ClientActivityMode["status"]; mode: PersonalFollowUpMode };
const identity = (target: PersonalFollowUpTarget | null, mode: PersonalFollowUpMode = "result") => target ? `${target.clientId}:${target.followUpId}:${mode}` : "";
function syncUrl(query: PersonalFollowUpQuery, target?: PersonalFollowUpTarget, mode: PersonalFollowUpMode = "result", push = false) {
  window.history[push ? "pushState" : "replaceState"](window.history.state, "", personalFollowUpHref(query, target, mode));
}
export function PersonalFollowUpQueue({ initialData, initialTarget = null, initialMode = "result", locationError = "" }: {
  initialData: PersonalFollowUpPage; initialTarget?: PersonalFollowUpTarget | null; initialMode?: PersonalFollowUpMode; locationError?: string;
}) {
  const [data, setData] = useState(initialData), [error, setError] = useState(locationError);
  const [verified, setVerified] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(() => initialTarget ? { target: initialTarget, status: "COMPLETED", mode: initialMode } : null);
  const [pending, start] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null), trigger = useRef<HTMLElement | null>(null), sequence = useRef(0);
  const mounted = useRef(true);
  const initialLocation = useRef({ data: initialData, target: initialTarget, mode: initialMode, error: locationError });
  const initialIdentity = identity(initialTarget, initialMode), seenInitial = useRef(initialIdentity);
  const closedTarget = useRef("");
  const latest = useRef({ data, editor, load });
  useEffect(() => { latest.current = { data, editor, load }; });

  function load(query: PersonalFollowUpQuery, nextTarget: PersonalFollowUpTarget | null = null, mode: PersonalFollowUpMode = "result", push = false) {
    const token = ++sequence.current;
    setError("");
    start(async () => {
      try {
        const page = await getPersonalFollowUps(query);
        if (!mounted.current || sequence.current !== token) return;
        setData(page);
        setVerified(true);
        setEditor(nextTarget ? { target: nextTarget, status: "COMPLETED", mode } : null);
        syncUrl({ filter: page.filter, page: page.page }, nextTarget ?? undefined, mode, push);
      } catch (cause) { if (mounted.current && sequence.current === token) { setVerified(false); setError(actionErrorMessage(cause) || "跟进队列读取失败，请重试"); } }
    });
  }
  useEffect(() => { setData(initialData); setVerified(true); }, [initialData]);
  useEffect(() => {
    if (seenInitial.current === initialIdentity) return;
    seenInitial.current = initialIdentity;
    // Saving can deliver a refreshed server payload for the target just closed.
    if (initialIdentity && initialIdentity === closedTarget.current) return;
    // A route refresh or a changed target must not silently replace an open editor.
    if (editor) { syncUrl({ filter: data.filter, page: data.page }, editor.target, editor.mode); return; }
    sequence.current++;
    setEditor(initialTarget ? { target: initialTarget, status: "COMPLETED", mode: initialMode } : null);
    syncUrl({ filter: initialData.filter, page: initialData.page }, initialTarget ?? undefined, initialMode);
  }, [initialIdentity, initialTarget, initialMode, initialData, data, editor]);
  useEffect(() => {
    mounted.current = true;
    const initial = initialLocation.current;
    if (!initial.error) syncUrl({ filter: initial.data.filter, page: initial.data.page }, initial.target ?? undefined, initial.mode);
    const pop = () => {
      const current = latest.current;
      if (current.editor) { syncUrl({ filter: current.data.filter, page: current.data.page }, current.editor.target, current.editor.mode); return; }
      const params = new URLSearchParams(window.location.search), input: Record<string, string | string[]> = {};
      for (const key of params.keys()) input[key] = params.getAll(key).length > 1 ? params.getAll(key) : params.get(key)!;
      const location = personalFollowUpLocation(input);
      if (location.error || !location.query) { setError(location.error); return; }
      current.load(location.query, location.target, location.mode);
    };
    window.addEventListener("popstate", pop);
    return () => { mounted.current = false; window.removeEventListener("popstate", pop); };
  }, []);
  function open(target: PersonalFollowUpTarget, status: ClientActivityMode["status"], mode: PersonalFollowUpMode, element: HTMLElement) {
    if (pending || editor) return;
    sequence.current++;
    trigger.current = element;
    setEditor({ target, status, mode });
    syncUrl({ filter: data.filter, page: data.page }, target, mode);
  }
  function close(saved = false) {
    sequence.current++;
    if (saved) trigger.current = null;
    closedTarget.current = identity(editor?.target ?? null, editor?.mode);
    setEditor(null);
    seenInitial.current = initialIdentity;
    syncUrl({ filter: data.filter, page: data.page });
    if (saved) load({ filter: data.filter, page: data.page });
  }
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize)), returnTo = personalFollowUpHref({ filter: data.filter, page: data.page });
  return <div className="space-y-4">
    <Link href="/clients" className="text-sm text-muted-foreground">返回客户列表</Link>
    <PageHeader title="本人待跟进" sub={!verified ? "当前列表尚未核实" : data.available ? `共 ${data.total} 项` : "当前资格不能读取客户跟进"} />
    <h2 ref={heading} tabIndex={-1} className="sr-only">客户待跟进列表</h2>
    <div className="flex flex-wrap gap-2" aria-label="跟进筛选">{Object.entries(followUpFilters).map(([filter, label]) =>
      <Button htmlType="button" key={filter} theme={data.filter === filter ? "solid" : "outline"} aria-pressed={data.filter === filter} disabled={pending || Boolean(editor)}
        onClick={() => load({ filter: filter as keyof typeof followUpFilters, page: 1 }, null, "result", true)}>{label}</Button>)}</div>
    {error && <div className="flex items-center gap-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button htmlType="button" type="tertiary" theme="outline" disabled={pending || Boolean(editor)} onClick={() => load({ filter: data.filter, page: data.page })}>重新读取列表</Button></div>}
    {pending && <p role="status" className="text-sm text-muted-foreground">正在读取跟进队列…</p>}
    {!verified ? <p className="text-sm text-muted-foreground">读取尚未成功，请重试后查看当前跟进。</p> : !data.available ? <p>当前资格不能读取客户跟进。</p> : data.items.length === 0 ? <p className="text-sm text-muted-foreground">当前筛选下没有待跟进。</p> : <ul className="divide-y rounded-md border">
      {data.items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1"><p className="break-words font-medium">{item.title}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link href={`/clients/${encodeURIComponent(item.client.id)}?tab=followups&returnTo=${encodeURIComponent(returnTo)}`}>{item.client.name}</Link>
          <time dateTime={item.dueAt}>{shDayKey(item.dueAt)} {shTime(item.dueAt)}</time>{item.overdue && <Tag color="orange">已逾期</Tag>}
        </div></div>
        <div className="flex gap-2"><Button htmlType="button" type="tertiary" theme="outline" disabled={pending || Boolean(editor)} aria-label={`${item.canClose ? "录入结果" : "查看跟进"}：${item.title}`}
          onClick={event => open({ followUpId: item.id, clientId: item.client.id }, "COMPLETED", "result", event.currentTarget)}>{item.canClose ? "录入结果" : "查看跟进"}</Button>
          {item.canClose && <><Button htmlType="button" type="tertiary" theme="outline" disabled={pending || Boolean(editor)} aria-label={`改期：${item.title}`} onClick={event => open({ followUpId: item.id, clientId: item.client.id }, "COMPLETED", "reschedule", event.currentTarget)}>改期</Button>
          <Button htmlType="button" type="tertiary" theme="borderless" disabled={pending || Boolean(editor)} aria-label={`取消跟进：${item.title}`} onClick={event => open({ followUpId: item.id, clientId: item.client.id }, "CANCELLED", "result", event.currentTarget)}>取消</Button></>}
        </div>
      </li>)}
    </ul>}
    {verified && data.available && <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">第 {data.page} / {pages} 页 · 北京时间</span><div className="flex gap-2">
      <Button htmlType="button" type="tertiary" theme="outline" disabled={pending || Boolean(editor) || data.page <= 1} onClick={() => load({ filter: data.filter, page: data.page - 1 }, null, "result", true)}>上一页</Button>
      <Button htmlType="button" type="tertiary" theme="outline" disabled={pending || Boolean(editor) || data.page >= pages} onClick={() => load({ filter: data.filter, page: data.page + 1 }, null, "result", true)}>下一页</Button>
    </div></div>}
    {editor && (editor.mode === "reschedule" ? <ClientFollowUpRescheduleDialog key={identity(editor.target, editor.mode)} {...editor.target}
      trigger={trigger} fallback={heading} onClose={() => close()} onSaved={() => close(true)} /> : <ClientActivityDialog key={`${identity(editor.target, editor.mode)}:${editor.status}`} clientId={editor.target.clientId} mode={{ id: editor.target.followUpId, status: editor.status }} verifyPersonalTarget
      trigger={trigger} fallback={heading} onClose={() => close()} onSaved={() => close(true)} />)}
  </div>;
}
