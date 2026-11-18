"use client";

/**
 * v0.50: 提醒推送（企业微信 / 钉钉群机器人）配置卡片。
 * 每日 09:00 到期扫描产生新提醒时，向机器人推一条汇总消息。
 */
import { Button, Checkbox, Form, Input, Notification, Toast } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import { Loader2, Send, Webhook } from "lucide-react";
import {
  saveWebhookSettingsAction,
  sendTestWebhookAction
} from "@/server/settings/webhook-actions";
import { actionErrorMessage } from "@/lib/action-error";

export function WebhookSettingsCard({
  initialEnabled,
  initialUrl
}: {
  initialEnabled: boolean;
  initialUrl: string;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [url, setUrl] = useState(initialUrl);
  const [saving, startSaving] = useTransition();
  const [testing, startTesting] = useTransition();

  function save() {
    startSaving(async () => {
      try {
        await saveWebhookSettingsAction({ enabled, url: url.trim() });
        Toast.success("推送配置已保存");
      } catch (err) {
        Notification.error({ title: "保存失败", content: actionErrorMessage(err) });
      }
    });
  }

  function test() {
    startTesting(async () => {
      try {
        await sendTestWebhookAction();
        Toast.success("测试消息已发送，请到群里确认");
      } catch (err) {
        Notification.error({ title: "测试失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <section className="card">
      <div className="panel-head">
        <div className="panel-title">
          <Webhook className="ic" strokeWidth={1.8} />
          群机器人推送（企业微信 / 钉钉）
        </div>
      </div>
      <div className="panel-body">
      <p className="max-w-[760px] text-[12px] leading-5 text-muted-foreground">
        每日到期扫描发现新提醒时，向群机器人推送一条汇总（只含事项标题与案件编号，不含当事人详情）。
        在企业微信 / 钉钉群里添加「自定义机器人」，把 Webhook 地址粘贴到下方；
        钉钉机器人建议用「自定义关键词」安全设置并填 <code className="font-mono">LexOrder</code>。
      </p>

      <div className="mt-3 max-w-[760px] space-y-3">
        <div className="space-y-1.5">
          <Form.Label name="reminder-webhook">机器人 Webhook 地址</Form.Label>
          <Input
            id="reminder-webhook"
            autoComplete="off"
            value={url}
            onChange={(value) => setUrl(value)}
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=... 或 https://oapi.dingtalk.com/robot/send?access_token=..."
            className="font-mono text-[12px]"
          />
        </div>
        <Checkbox checked={enabled} onChange={event => setEnabled(event.target.checked === true)}>启用每日提醒推送
        </Checkbox>
        <div className="flex items-center gap-2">
          <Button theme="solid" size="small" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存
          </Button>
          <Button
            size="small"
            theme="light" type="tertiary"
            onClick={test}
            disabled={testing}
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            发送测试消息
          </Button>
        </div>
      </div>
    </div>
    </section>
  );
}
