"use client";

import { Button, Form, Input, Toast } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import { Package, CheckCircle2, Loader2, Trash2, ExternalLink } from "lucide-react";
import { saveExpressSettingsAction } from "@/server/express/actions";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";

type Initial = {
  kdniao: { ebusinessId: string; configured: boolean; appKeyMasked: string };
  kuaidi100: { customer: string; configured: boolean; keyMasked: string };
};

export function ExpressSettingsForm({ initial }: { initial: Initial }) {
  const [kdEbId, setKdEbId] = useState(initial.kdniao.ebusinessId);
  const [kdAppKey, setKdAppKey] = useState("");
  const [k100Customer, setK100Customer] = useState(initial.kuaidi100.customer);
  const [k100Key, setK100Key] = useState("");
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      try {
        await saveExpressSettingsAction({
          kdniaoEbusinessId: kdEbId,
          kdniaoAppKey: kdAppKey,
          kuaidi100Customer: k100Customer,
          kuaidi100Key: k100Key
        });
        Toast.success("配置已保存");
        setKdAppKey("");
        setK100Key("");
      } catch (e) {
        Toast.error(e instanceof Error ? actionErrorMessage(e) : "失败");
      }
    });
  };

  const clearKdniao = async () => {
    if (!(await confirmDialog({ title: "清除快递鸟密钥？", description: "清除后物流自动刷新将降级到快递100（如已配置）。", confirmText: "清除", danger: true }))) return;
    startTransition(async () => {
      try {
        await saveExpressSettingsAction({ kdniaoClearKey: true });
        Toast.success("已清除");
      } catch (e) {
        Toast.error(e instanceof Error ? actionErrorMessage(e) : "失败");
      }
    });
  };

  const clearKd100 = async () => {
    if (!(await confirmDialog({ title: "清除快递100密钥？", confirmText: "清除", danger: true }))) return;
    startTransition(async () => {
      try {
        await saveExpressSettingsAction({ kuaidi100ClearKey: true });
        Toast.success("已清除");
      } catch (e) {
        Toast.error(e instanceof Error ? actionErrorMessage(e) : "失败");
      }
    });
  };

  return (
    <div className="space-y-5">
      <section className="ll-surface rounded-lg border border-border p-5">
        <header className="mb-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h2 className="text-[14px] font-semibold">快递接入</h2>
        </header>
        <p className="mb-4 text-[12px] text-muted-foreground">
          两家物流服务商：优先 <span className="text-foreground/85">快递鸟</span>（500 条/日免费），
          失败时降级到 <span className="text-foreground/85">快递100</span>。
          配置任一即可使用。
        </p>

        {/* 快递鸟 */}
        <div className="mb-5 rounded-md border border-border bg-muted/20 p-4">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[13px] font-medium">快递鸟（主，推荐）</h3>
            {initial.kdniao.configured && (
              <span className="inline-flex items-center gap-1 rounded bg-[var(--semi-color-success-light-default)] px-1.5 py-0.5 text-[10px] text-[var(--semi-color-success)]">
                <CheckCircle2 className="h-3 w-3" />
                已配置
              </span>
            )}
            <a
              href="https://www.kdniao.com/"
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              申请
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Form.Label name="express-kd-customer" className="text-[11px]">EBusinessID（用户 ID）</Form.Label>
              <Input
                id="express-kd-customer" value={kdEbId}
                onChange={(value) => setKdEbId(value)}
                placeholder="数字 ID"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Form.Label name="express-kd-key" className="text-[11px]">
                AppKey
                {initial.kdniao.configured && (
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    当前 {initial.kdniao.appKeyMasked}（留空保留）
                  </span>
                )}
              </Form.Label>
              <Input
                id="express-kd-key" type="password"
                value={kdAppKey}
                onChange={(value) => setKdAppKey(value)}
                placeholder={initial.kdniao.configured ? "如需更换请粘贴新 AppKey" : "AppKey"}
                className="mt-1 font-mono"
                autoComplete="off"
              />
            </div>
          </div>
          {initial.kdniao.configured && (
            <div className="mt-2 flex justify-end">
              <Button theme="borderless" type="danger" size="small" contentClassName="inline-flex items-center gap-1"
                htmlType="button"
                onClick={clearKdniao}
              >
                <Trash2 className="h-3 w-3" />
                清除密钥
              </Button>
            </div>
          )}
        </div>

        {/* 快递100 */}
        <div className="rounded-md border border-border bg-muted/20 p-4">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[13px] font-medium">快递100（备用）</h3>
            {initial.kuaidi100.configured && (
              <span className="inline-flex items-center gap-1 rounded bg-[var(--semi-color-success-light-default)] px-1.5 py-0.5 text-[10px] text-[var(--semi-color-success)]">
                <CheckCircle2 className="h-3 w-3" />
                已配置
              </span>
            )}
            <a
              href="https://api.kuaidi100.com/"
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              申请
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Form.Label name="express-k100-customer" className="text-[11px]">Customer（授权码）</Form.Label>
              <Input
                id="express-k100-customer" value={k100Customer}
                onChange={(value) => setK100Customer(value)}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Form.Label name="express-k100-key" className="text-[11px]">
                Key
                {initial.kuaidi100.configured && (
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    当前 {initial.kuaidi100.keyMasked}（留空保留）
                  </span>
                )}
              </Form.Label>
              <Input
                id="express-k100-key" type="password"
                value={k100Key}
                onChange={(value) => setK100Key(value)}
                placeholder={initial.kuaidi100.configured ? "如需更换请粘贴新 key" : "key"}
                className="mt-1 font-mono"
                autoComplete="off"
              />
            </div>
          </div>
          {initial.kuaidi100.configured && (
            <div className="mt-2 flex justify-end">
              <Button theme="borderless" type="danger" size="small" contentClassName="inline-flex items-center gap-1"
                htmlType="button"
                onClick={clearKd100}
              >
                <Trash2 className="h-3 w-3" />
                清除密钥
              </Button>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button theme="solid" onClick={save} disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存配置
          </Button>
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          密钥使用 AES-256-GCM 加密保存至系统设置，与文档加密复用同一密钥（
          <span className="font-mono">STORAGE_ENCRYPTION_KEY</span>）。前端永远不显示明文。
        </p>
      </section>
    </div>
  );
}
