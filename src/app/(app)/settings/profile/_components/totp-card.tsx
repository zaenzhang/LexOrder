"use client";

/**
 * TOTP 双步验证绑定/关闭卡（个人设置 · 登录安全）。
 * 绑定流程：生成密钥（展示 otpauth URI 与手输密钥）→ 输入 6 位动态码确认
 * → 一次性展示 8 枚恢复码（仅此一次，请妥善保存）。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { Banner, Button, Card, Form, Input, Notification, Tag, Toast } from "@douyinfe/semi-ui";
import { enrollStartTotp, enrollConfirmTotp, disableTotp } from "@/server/auth/totp-actions";
import { actionErrorMessage } from "@/lib/action-error";

export function TotpCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enrolling, setEnrolling] = useState(false);
  const [secretInfo, setSecretInfo] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  function start() {
    startTransition(async () => {
      try {
        setSecretInfo(await enrollStartTotp());
        setEnrolling(true);
        setCode("");
        setRecoveryCodes(null);
      } catch (e) {
        Notification.error({ title: "生成密钥失败", content: actionErrorMessage(e) });
      }
    });
  }

  function confirm() {
    if (!/^\d{6}$/.test(code.trim())) {
      Toast.error("请输入 6 位动态码");
      return;
    }
    startTransition(async () => {
      try {
        const res = await enrollConfirmTotp({ code: code.trim() });
        if (!res.ok) {
          Notification.error({ title: "验证失败", content: res.message });
          return;
        }
        setRecoveryCodes(res.recoveryCodes);
        setEnrolling(false);
        setSecretInfo(null);
        setCode("");
        Toast.success("双步验证已开启");
        router.refresh();
      } catch (e) {
        Notification.error({ title: "确认失败", content: actionErrorMessage(e) });
      }
    });
  }

  function turnOff() {
    startTransition(async () => {
      try {
        const res = await disableTotp({ code: disableCode.trim() });
        if (!res.ok) {
          Notification.error({ title: "关闭失败", content: res.message });
          return;
        }
        setShowDisable(false);
        setDisableCode("");
        Toast.success("双步验证已关闭");
        router.refresh();
      } catch (e) {
        Notification.error({ title: "关闭失败", content: actionErrorMessage(e) });
      }
    });
  }

  return (
    <Card title={<div className="flex items-center gap-2">
      {enabled ? <ShieldCheck size={16} aria-hidden /> : <ShieldOff size={16} aria-hidden />}
      <h2 className="text-base font-semibold">双步验证（动态码）</h2>
      {enabled && <Tag color="green">已开启</Tag>}
    </div>}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-[var(--semi-color-text-2)]">
          {enabled ? "登录时需输入验证器 App 的 6 位动态码或恢复码。" : "开启后，登录时需要验证器 App 的动态码。"}
        </p>
        {!enrolling && !recoveryCodes && !enabled && <Button htmlType="button" theme="solid" onClick={start} loading={pending} disabled={pending}>开启双步验证</Button>}
        {enabled && !showDisable && <Button htmlType="button" onClick={() => setShowDisable(true)} disabled={pending}>关闭</Button>}
      </div>
      {enrolling && secretInfo && <div className="mt-4 space-y-4">
        <div>
          <h3 className="text-sm font-medium">第 1 步：在验证器 App 中添加密钥</h3>
          <p className="mt-1 text-sm text-[var(--semi-color-text-2)]">在验证器 App 中手动输入以下密钥：</p>
          <div className="mt-2 select-all break-all font-mono text-sm">{secretInfo.secret}</div>
          <div className="mt-1 select-all break-all text-xs text-[var(--semi-color-text-2)]">{secretInfo.uri}</div>
        </div>
        <div>
          <Form.Label name="totp-enroll-code" text="第 2 步：输入 App 显示的 6 位动态码确认" />
          <div className="flex flex-wrap items-center gap-2">
            <Input id="totp-enroll-code" value={code} onChange={value => setCode(value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" placeholder="000000" disabled={pending} style={{ width: 140 }} />
            <Button htmlType="button" theme="solid" onClick={confirm} loading={pending} disabled={pending || code.length !== 6}>确认并开启</Button>
            <Button htmlType="button" type="tertiary" theme="borderless" disabled={pending} onClick={() => { setEnrolling(false); setSecretInfo(null); setCode(""); }}>取消</Button>
          </div>
        </div>
      </div>}
      {recoveryCodes && <Banner className="mt-4" type="warning" closeIcon={null} title="恢复码（仅此一次展示）" description={<div className="space-y-3">
        <p>动态码无法使用时，可用以下任一恢复码登录，每枚只能使用一次。请抄写或打印保存。</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {recoveryCodes.map(code => <span key={code} className="select-all font-mono">{code}</span>)}
        </div>
        <Button htmlType="button" onClick={() => setRecoveryCodes(null)}>我已妥善保存</Button>
      </div>} />}
      {showDisable && <div className="mt-4">
        <Form.Label name="totp-disable-code" text="动态码或恢复码" />
        <div className="flex flex-wrap items-center gap-2">
          <Input id="totp-disable-code" value={disableCode} onChange={value => setDisableCode(value.trim())}
            autoComplete="one-time-code" placeholder="输入动态码或恢复码以关闭" disabled={pending} style={{ width: 240 }} />
          <Button htmlType="button" type="danger" onClick={turnOff} loading={pending} disabled={pending || disableCode.length < 6}>确认关闭</Button>
          <Button htmlType="button" type="tertiary" theme="borderless" disabled={pending} onClick={() => { setShowDisable(false); setDisableCode(""); }}>取消</Button>
        </div>
      </div>}
    </Card>
  );
}
