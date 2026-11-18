"use client";

import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Form, Input, Notification, Toast } from "@douyinfe/semi-ui";
import { changeMyPassword } from "@/server/users/actions";
import { actionErrorMessage } from "@/lib/action-error";

const schema = z
  .object({
    currentPassword: z.string().min(1, "请输入当前密码"),
    newPassword: z.string().min(8, "新密码至少 8 位").max(128),
    confirmPassword: z.string()
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "两次输入的新密码不一致",
    path: ["confirmPassword"]
  });

type FormValues = z.infer<typeof schema>;

export function ChangePasswordForm() {
  const [isPending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" }
  });

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      try {
        await changeMyPassword({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword
        });
        Toast.success("密码已修改");
        reset();
      } catch (err) {
        Notification.error({ title: "修改失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-4">
      {([
        { name: "currentPassword", label: "当前密码", autoComplete: "current-password" },
        { name: "newPassword", label: "新密码（至少 8 位）", autoComplete: "new-password" },
        { name: "confirmPassword", label: "确认新密码", autoComplete: "new-password" }
      ] as const).map(({ name, label, autoComplete }) => <div key={name}>
        <Form.Label name={`change-password-${name}`} text={label} />
        <Controller name={name} control={control} render={({ field }) => (
          <Input {...field} id={`change-password-${name}`} type="password" autoComplete={autoComplete}
            disabled={isPending} aria-invalid={!!errors[name]} validateStatus={errors[name] ? "error" : "default"}
            aria-describedby={errors[name] ? `change-password-${name}-error` : undefined} />
        )} />
        {errors[name] && <p id={`change-password-${name}-error`} role="alert" className="mt-1 text-sm text-[var(--semi-color-danger)]">{errors[name]?.message}</p>}
      </div>)}
      <Button htmlType="submit" theme="solid" loading={isPending} disabled={isPending}>修改密码</Button>
    </form>
  );
}
