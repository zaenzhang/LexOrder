"use client";

import { useState } from "react";
import { Button, Modal } from "@douyinfe/semi-ui";
import { ShieldCheck } from "lucide-react";

export function LoginProtectionDialog() {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Button
        htmlType="button"
        theme="borderless"
        type="tertiary"
        icon={<ShieldCheck size={16} aria-hidden />}
        aria-label="登录保护说明"
        aria-haspopup="dialog"
        aria-expanded={visible}
        title="登录保护说明"
        onClick={() => setVisible(true)}
      />
      <Modal
        title="登录保护"
        visible={visible}
        onCancel={() => setVisible(false)}
        footer={null}
        centered
      >
        <p>连续 5 次登录失败后，账号将锁定 15 分钟。管理员可要求两步验证。</p>
      </Modal>
    </>
  );
}
