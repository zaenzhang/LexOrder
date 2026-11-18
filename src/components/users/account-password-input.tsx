"use client";

import { Button, Input } from "@douyinfe/semi-ui";
import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentPropsWithRef } from "react";

type AccountPasswordInputProps = Omit<ComponentPropsWithRef<typeof Input>, "mode" | "suffix" | "type"> & { id: string };

export function AccountPasswordInput({ id, disabled, ...props }: AccountPasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "隐藏密码" : "显示密码";
  const Icon = visible ? EyeOff : Eye;

  return <Input
    {...props}
    id={id}
    disabled={disabled}
    type={visible ? "text" : "password"}
    suffix={<Button
      htmlType="button"
      theme="borderless"
      type="tertiary"
      size="small"
      disabled={disabled}
      aria-label={label}
      aria-controls={id}
      title={label}
      icon={<Icon size={16} aria-hidden />}
      onClick={() => setVisible(shown => !shown)}
    />}
  />;
}
