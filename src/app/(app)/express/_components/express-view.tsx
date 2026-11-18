"use client";

import { Tabs, Select, Button, Input, RadioGroup, Tag, Notification, Toast } from "@douyinfe/semi-ui";
import { useRef, useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { Package, Search, RefreshCw, Trash2, Briefcase, ArrowDownToLine, ArrowUpFromLine, ExternalLink, AlertTriangle } from "lucide-react";
import type { Prisma, ExpressDirection } from "@prisma/client";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";

import { MatterCombobox } from "@/app/(app)/approvals/seals/_components/matter-combobox";
import { cn, formatDateTime } from "@/lib/utils";
import { createExpress, refreshExpress, deleteExpress } from "@/server/express/actions";
import { SUPPORTED_COMPANIES, detectCompany } from "@/lib/express/companies";
import { matterHref } from "@/lib/matters/route";
import { PageHeader } from "@/components/patterns/moan";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { actionErrorMessage } from "@/lib/action-error";

type Row = Prisma.ExpressTrackingGetPayload<{
  include: {
    matter: { select: { id: true; internalCode: true; title: true } };
    createdBy: { select: { id: true; name: true } };
  };
}>;
type MatterOption = { id: string; internalCode: string; title: string };
type DirectionFilter = ExpressDirection | "ALL";

const STATE_TONE: Record<string, "danger" | "ok" | "warn" | "muted"> = {
  已签收: "ok",
  在途: "muted",
  在途中: "muted",
  已揽件: "muted",
  揽收: "muted",
  到达派件城市: "muted",
  派件中: "muted",
  疑难件: "danger",
  疑难: "danger",
  退签: "danger",
  退回: "danger",
  暂无信息: "warn",
  未知: "warn"
};

export function ExpressView({
  items,
  matters,
  configured,
  hideHeader
}: {
  items: Row[];
  matters: MatterOption[];
  configured: boolean;
  hideHeader?: boolean;
}) {
  const [direction, setDirection] = useState<DirectionFilter>("ALL");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return items.filter((e) => {
      if (direction !== "ALL" && e.direction !== direction) return false;
      if (!kw) return true;
      return (
        e.trackingNo.toLowerCase().includes(kw) ||
        (e.purpose ?? "").toLowerCase().includes(kw) ||
        (e.recipient ?? "").toLowerCase().includes(kw) ||
        (e.matter?.title ?? "").toLowerCase().includes(kw) ||
        (e.matter?.internalCode ?? "").toLowerCase().includes(kw)
      );
    });
  }, [items, direction, search]);

  useTopbarAction({ label: "新建追踪", onClick: () => setNewOpen(true) }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        {hideHeader ? (
          <div />
        ) : (
          <PageHeader className="!mb-0" title="快递追踪" sub="寄出 / 收到的法院文书、当事人材料统一登记 + 自动刷新物流" />
        )}
      </div>

      {!configured && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--amber-line)] bg-[var(--amber-bg)] p-3 text-[12px] text-[var(--amber)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            未配置任何快递接入。记录可创建但物流状态拉不到。
            <Link href="/admin/express" target="_blank" rel="noopener" className="ml-1 font-medium underline">
              去配置 快递鸟 / 快递100 →
            </Link>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 sm:min-w-64 flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e)}
            placeholder="搜索单号 / 用途 / 收件人 / 案件"
            prefix={<Search size={16} />}
          />
        </div>
        <Tabs activeKey={direction} onChange={key => setDirection(key as DirectionFilter)}
          tabList={[
            { itemKey: "ALL", tab: "全部" },
            { itemKey: "OUTBOUND", tab: "寄出" },
            { itemKey: "INBOUND", tab: "收到" }
          ]}
        />
      </div>

      <div>
        {filtered.length === 0 ? (
          <div className="ll-surface rounded-lg border border-border p-12 text-center text-sm text-muted-foreground">
            <Package className="mx-auto mb-2 h-6 w-6 opacity-40" />
            {items.length === 0
              ? "暂无快递追踪记录，点上方「新建追踪」开始"
              : "没有匹配的记录"}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((e) => (
              <Card key={e.id} e={e} />
            ))}
          </div>
        )}
      </div>

      <NewExpressDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        matters={matters}
        configured={configured}
      />
    </div>
  );
}

function Card({ e }: { e: Row }) {
  const [pending, startTransition] = useTransition();
  const [tracesOpen, setTracesOpen] = useState(false);
  const traces = (e.tracesJson as { time?: string; desc?: string }[] | null) ?? [];
  const tone = e.lastState ? STATE_TONE[e.lastState] ?? "muted" : "muted";

  const onRefresh = () =>
    startTransition(async () => {
      try {
        const r = await refreshExpress({ id: e.id });
        Toast.success(`已更新：${r.state}（${r.provider}）`);
      } catch (err) {
        Notification.error({ title: err instanceof Error ? actionErrorMessage(err) : "刷新失败", duration: 6 });
      }
    });

  const onDelete = async () => {
    if (!(await confirmDialog({ title: `删除快递单号 ${e.trackingNo}？`, confirmText: "删除", danger: true }))) return;
    startTransition(async () => {
      try {
        await deleteExpress({ id: e.id });
        Toast.success("已删除");
      } catch (err) {
        Notification.error({ title: err instanceof Error ? actionErrorMessage(err) : "失败", duration: 6 });
      }
    });
  };

  return (
    <div className="ll-surface flex flex-col gap-2 rounded-lg border border-border p-4">
      {/* 行 1：方向 + 公司 + 状态 */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {e.direction === "OUTBOUND" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--blue-bg)] px-2 py-0.5 text-[var(--blue)]">
            <ArrowUpFromLine className="h-3 w-3" />
            寄出
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--green-bg)] px-2 py-0.5 text-[var(--green)]">
            <ArrowDownToLine className="h-3 w-3" />
            收到
          </span>
        )}
        {e.companyCode && (
          <span className="text-muted-foreground">{e.companyCode}</span>
        )}
        {e.lastState && (
          <Tag
            color={tone === "danger" ? "red" : tone === "ok" ? "green" : tone === "warn" ? "amber" : "grey"}
            type="light"
          >
            {e.lastState}
          </Tag>
        )}
      </div>

      {/* 行 2：单号 + 用途 */}
      <div>
        <div className="font-mono text-[13px] font-medium text-foreground">
          {e.trackingNo}
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] text-foreground/85">{e.purpose}</p>
      </div>

      {/* 行 3：收件人 + 案件 */}
      <div className="space-y-1 text-[11px] text-muted-foreground">
        {(e.recipient || e.recipientPhone) && (
          <div>
            收件人：{e.recipient ?? "—"}
            {e.recipientPhone && (
              <span className="ml-1 font-mono text-[10px]">{e.recipientPhone}</span>
            )}
          </div>
        )}
        {e.matter && (
          <Link
            href={matterHref(e.matter)}
            className="inline-flex items-center gap-1 hover:text-primary"
          >
            <Briefcase className="h-3 w-3" />
            <span className="shrink-0 whitespace-nowrap font-mono text-[10px]">{e.matter.internalCode}</span>
            <span className="truncate">{e.matter.title}</span>
          </Link>
        )}
        {e.lastUpdateAt && (
          <div className="font-mono text-[10px]">
            上次刷新：{formatDateTime(new Date(e.lastUpdateAt))}
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center justify-end gap-1 pt-2">
        {traces.length > 0 && (
          <Button
            size="small"
            theme="borderless" type="tertiary"
            onClick={() => setTracesOpen(true)}
            className="h-7 gap-1 px-2 text-[11px]" htmlType="button"
          >
            <ExternalLink className="h-3 w-3" />
            轨迹 {traces.length}
          </Button>
        )}
        <Button
          size="small"
          theme="borderless" type="tertiary"
          onClick={onRefresh}
          disabled={pending}
          className="h-7 gap-1 px-2 text-[11px] text-primary" htmlType="button"
        >
          <RefreshCw className={cn("h-3 w-3", pending && "animate-spin")} />
          刷新
        </Button>
        <Button
          htmlType="button"
          onClick={onDelete}
          disabled={pending}
          className="rounded p-1 text-muted-foreground hover:text-destructive"
          title="删除" theme="borderless" type="tertiary"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Dialog open={tracesOpen} onOpenChange={setTracesOpen}>
        <DialogContent className="max-h-[80vh] w-[92vw] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <span className="font-mono">{e.trackingNo}</span> · 物流轨迹
            </DialogTitle>
            <DialogDescription className="text-xs">
              {e.companyCode} · {traces.length} 条
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-2 border-l border-border pl-4">
            {traces.map((t, i) => (
              <li key={i} className="relative">
                <span
                  className={cn(
                    "absolute -left-[19px] top-1 h-2 w-2 rounded-full",
                    i === 0 ? "bg-primary" : "bg-muted-foreground/40"
                  )}
                />
                <div className="text-[12px] text-foreground/85">{t.desc}</div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {t.time}
                </div>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function NewExpressDialog({
  open,
  onOpenChange,
  matters,
  configured
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  matters: MatterOption[];
  configured: boolean;
}) {
  const [trackingNo, setTrackingNo] = useState("");
  const popupContainer = useRef<HTMLDivElement>(null);
  const openDropdown = useRef(false);
  const [companyCode, setCompanyCode] = useState("");
  const [direction, setDirection] = useState<ExpressDirection>("OUTBOUND");
  const [matterId, setMatterId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [recipient, setRecipient] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [pending, startTransition] = useTransition();

  // 单号变化时自动识别公司
  const onTrackingChange = (v: string) => {
    setTrackingNo(v);
    if (v && !companyCode) {
      const detected = detectCompany(v);
      if (detected) setCompanyCode(detected);
    }
  };

  const reset = () => {
    setTrackingNo("");
    setCompanyCode("");
    setDirection("OUTBOUND");
    setMatterId("");
    setPurpose("");
    setRecipient("");
    setRecipientPhone("");
  };

  const submit = () => {
    if (!trackingNo.trim()) {
      Notification.error({ title: "快递单号必填", duration: 6 });
      return;
    }
    if (!purpose.trim()) {
      Notification.error({ title: "用途必填", duration: 6 });
      return;
    }
    startTransition(async () => {
      try {
        const res = await createExpress({
          trackingNo: trackingNo.trim(),
          companyCode,
          direction,
          matterId: matterId || null,
          purpose: purpose.trim(),
          recipient: recipient.trim(),
          recipientPhone: recipientPhone.trim()
        });
        if (res.firstState) {
          Toast.success(`已创建并查询：${res.firstState}`);
        } else {
          Toast.success(configured ? "已创建（首次查询失败，可稍后刷新）" : "已创建（未配置 API，状态稍后手动查）");
        }
        reset();
        onOpenChange(false);
      } catch (e) {
        Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "失败", duration: 6 });
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent ref={popupContainer} className="max-h-[88vh] w-[92vw] max-w-2xl overflow-y-auto" onEscapeKeyDown={event => { if (pending || openDropdown.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>新建快递追踪</DialogTitle>
          <DialogDescription className="text-xs">
            支持自动识别 顺丰 / 中通 / 圆通 / 韵达 / 申通 / EMS / 京东 / 极兔 等
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-[11px]">方向 *</label>
            <RadioGroup
              buttonSize="small"
              className="mt-2"
              options={[
                { value: "OUTBOUND", label: "寄出" },
                { value: "INBOUND", label: "收到" }
              ]}
              value={direction}
              disabled={pending}
              onChange={event => ((v) => setDirection(v as ExpressDirection))(String(event.target.value))} type="button"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-[11px]">快递单号 *</label>
              <Input
                value={trackingNo}
                disabled={pending}
                onChange={(e) => onTrackingChange(e)}
                placeholder="如 SF1234567890123"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <label className="text-[11px]">快递公司</label>
              <Select<string> insetLabel="快递公司" insetLabelId="express-company-label" aria-labelledby="express-company-label" disabled={pending} getPopupContainer={() => popupContainer.current!} onDropdownVisibleChange={visible => { openDropdown.current = visible; }} value={companyCode} onChange={value => ((e) => setCompanyCode(e))(String(value ?? ""))} className="mt-1" style={{ width: "100%" }} motion={false}>
                <Select.Option value="">自动识别 / 未知</Select.Option>
                {SUPPORTED_COMPANIES.map((c) => (
                  <Select.Option key={c} value={c}>
                    {c}
                  </Select.Option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label className="text-[11px]">用途 *</label>
            <Input
              value={purpose}
              disabled={pending}
              onChange={(e) => setPurpose(e)}
              placeholder={
                direction === "OUTBOUND"
                  ? "如：起诉状寄朝阳区法院立案庭"
                  : "如：法院送达判决书"
              }
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-[11px]">关联案件（可选）</label>
            <div className="mt-1">
              <MatterCombobox
                matters={matters}
                value={matterId}
                onChange={setMatterId}
                disabled={pending}
                onDropdownVisibleChange={visible => { openDropdown.current = visible; }}
                placeholder="搜索案件编号 / 名称"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-[11px]">{direction === "OUTBOUND" ? "收件人" : "寄件人"}</label>
              <Input
                value={recipient}
                disabled={pending}
                onChange={(e) => setRecipient(e)}
                placeholder="姓名或单位"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[11px]">联系电话</label>
              <Input
                value={recipientPhone}
                disabled={pending}
                onChange={(e) => setRecipientPhone(e)}
                className="mt-1 font-mono"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button theme="outline" type="tertiary" onClick={() => onOpenChange(false)} disabled={pending} htmlType="button">
            取消
          </Button>
          <Button onClick={submit} disabled={pending} theme="solid" type="primary" htmlType="button">
            {pending ? "创建中..." : "创建并查询"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
