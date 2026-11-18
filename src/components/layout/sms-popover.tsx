"use client";

/**
 * 顶栏「法院短信」入口（2026-09-19 用户确认）：法院短信是有时效的外部来件队列
 * （送达回执、开庭传票），不是导航分类，也不该藏进工具抽屉——因此与通知铃并排，
 * 图标带未处理角标；点开列未处理短信，可就地标记已处理，或进整页做关联与转开庭/期限。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Mail } from "lucide-react";
import { Button, Popover, Spin, Tag, Toast } from "@douyinfe/semi-ui";
import { listSmsMessages, markSmsProcessed } from "@/server/sms/actions";
import { SmsPasteDialog } from "@/app/(app)/inbox/_components/sms-paste-dialog";
import { shMonthDayTime } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";

type Sms = Awaited<ReturnType<typeof listSmsMessages>>[number];

const TYPE_LABEL: Record<string, string> = {
  HEARING_NOTICE: "开庭",
  SERVICE_NOTICE: "送达",
  FEE_NOTICE: "缴费",
  MEDIATION: "调解",
  ENFORCEMENT: "执行",
  FILING_NOTICE: "立案",
  JUDGMENT_NOTICE: "判决",
  EVIDENCE_SUBMIT: "举证",
  OTHER: "其他"
};
/** 开庭与举证是有期限的，角标与徽章用暖色提示 */
const URGENT_TYPES = new Set(["HEARING_NOTICE", "EVIDENCE_SUBMIT", "FEE_NOTICE"]);

function summaryOf(sms: Sms): string {
  const parsed = (sms.parsedJson ?? {}) as { summary?: string; court?: string | null };
  return parsed.summary?.trim() || sms.rawText.slice(0, 60);
}
function courtOf(sms: Sms): string | null {
  const parsed = (sms.parsedJson ?? {}) as { court?: string | null };
  return parsed.court?.trim() || null;
}

export function SmsPopover() {
  const [items, setItems] = useState<Sms[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const router = useRouter();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const wasPasteOpen = useRef(false);
  const request = useRef(0);
  const mutating = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    // The shared paste dialog has no trigger of its own; return to this persistent entry.
    if (wasPasteOpen.current && !pasteOpen) triggerRef.current?.querySelector("button")?.focus();
    wasPasteOpen.current = pasteOpen;
  }, [pasteOpen]);

  const load = useCallback(async () => {
    if (mutating.current) return;
    const serial = ++request.current;
    setLoading(true);
    try {
      const next = await listSmsMessages({ scope: "mine", processed: "unprocessed" });
      if (serial !== request.current) return;
      setItems(next);
      setLoadError("");
    } catch {
      if (serial !== request.current) return;
      setItems([]);
      setLoadError("法院短信读取失败，请重试。");
    } finally {
      if (serial === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => { clearInterval(timer); request.current += 1; };
  }, [load]);

  const count = items.length;
  const urgent = items.some(sms => URGENT_TYPES.has(sms.smsType));

  async function markDone(id: string) {
    if (mutating.current) return;
    mutating.current = true;
    request.current += 1;
    setLoading(false);
    setBusyId(id);
    try {
      await markSmsProcessed({ id });
      setItems(previous => previous.filter(sms => sms.id !== id));
      router.refresh();
    } catch (error) {
      Toast.error(error instanceof Error ? actionErrorMessage(error) : "标记失败，请稍后重试");
    } finally {
      mutating.current = false;
      setBusyId(null);
    }
  }

  return <>
    <span ref={triggerRef} className="inline-flex">
    <Popover trigger="click" visible={open} position="bottomRight" motion={false}
      onVisibleChange={visible => { setOpen(visible); if (visible) void load(); }}
      onEscKeyDown={() => setOpen(false)} content={
        <section aria-label="法院短信列表" className="w-[360px]">
          <div className="flex items-center justify-between gap-2 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">法院短信</div>
              <div className="text-xs text-[var(--semi-color-text-2)]">{loadError ? "读取失败" : loading ? "正在读取…" : count > 0 ? `未处理 ${count} 条` : "均已处理"}</div>
            </div>
            <Button htmlType="button" size="small" theme="solid" icon={<ClipboardPaste size={16} />} onClick={() => {
              triggerRef.current?.querySelector("button")?.focus();
              setOpen(false);
              setPasteOpen(true);
            }}>粘贴短信</Button>
          </div>
          {loading ? <div role="status" className="px-3 pb-3"><Spin size="small" /> 正在读取法院短信…</div> : null}
          {loadError ? <div role="alert" className="p-3 text-sm">{loadError}<Button size="small" theme="borderless" disabled={loading} onClick={() => void load()}>重试读取</Button></div> : !loading && count === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[var(--semi-color-text-2)]">没有未处理的法院短信</p>
          ) : (
            <ul className="max-h-[380px] overflow-y-auto">
              {items.slice(0, 8).map(sms => <li key={sms.id} className="px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs text-[var(--semi-color-text-2)]">
                  <Tag size="small" color={URGENT_TYPES.has(sms.smsType) ? "orange" : "grey"}>{TYPE_LABEL[sms.smsType] ?? "其他"}</Tag>
                  <span className="min-w-0 truncate">{courtOf(sms) ?? "未识别法院"}</span>
                  <span className="ml-auto shrink-0">{shMonthDayTime(sms.receivedAt)}</span>
                </div>
                <p className="my-2 whitespace-normal break-words text-sm">{summaryOf(sms)}</p>
                <div className="flex items-center gap-2">
                  <Link href={`/inbox?focus=${sms.id}`} onClick={() => setOpen(false)} className="text-sm text-[var(--semi-color-primary)]">去处理</Link>
                  <Button htmlType="button" size="small" theme="borderless" disabled={busyId !== null} loading={busyId === sms.id} onClick={() => void markDone(sms.id)}>标记已处理</Button>
                  <span className="ml-auto min-w-0 truncate text-xs text-[var(--semi-color-text-2)]" title={sms.matchedMatter?.title}>
                    {sms.matchedMatter ? `已关联 ${sms.matchedMatter.internalCode}` : "未关联案件"}
                  </span>
                </div>
              </li>)}
            </ul>
          )}
          <div className="p-3 text-right">
            <Link href="/inbox" onClick={() => setOpen(false)} className="text-sm text-[var(--semi-color-primary)]">全部短信 →</Link>
          </div>
        </section>
      }>
      <Button htmlType="button" theme="light" type="tertiary" icon={<Mail size={18} />}
        aria-label={loadError ? "法院短信（读取失败），可粘贴新短信" : count > 0 ? `法院短信（${count} 条未处理），可粘贴新短信` : "法院短信，可粘贴新短信"}
        title="法院短信：粘贴 12368 短信自动解析，生成开庭与期限">
        <span className="hidden md:inline">法院短信</span>
        {count > 0 ? <Tag size="small" color={urgent ? "orange" : "blue"} className="ml-2">{count}</Tag> : null}
      </Button>
    </Popover>
    </span>
    <SmsPasteDialog open={pasteOpen} onOpenChange={visible => { setPasteOpen(visible); if (!visible) void load(); }} />
  </>;
}
