"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Mail, LockKeyhole, ShieldCheck } from "lucide-react";
import { Banner, Button, Checkbox, Form, Input } from "@douyinfe/semi-ui";
import { checkLoginTotpEnforcement } from "@/server/auth/totp-actions";

const schema = z.object({
  email: z.string().email("请填写有效邮箱"),
  password: z.string().min(1, "请填写密码"),
  totpCode: z.string().optional()
});

type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const [authError, setAuthError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showTotp, setShowTotp] = useState(false);
  const PasswordIcon = showPassword ? EyeOff : Eye;
  const passwordToggleLabel = showPassword ? "隐藏密码" : "显示密码";
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", totpCode: "" }
  });

  async function onSubmit(values: FormValues) {
    setAuthError(null);
    let res;
    try {
      res = await signIn("credentials", {
        email: values.email,
        password: values.password,
        totpCode: showTotp ? values.totpCode || undefined : undefined,
        redirect: false
      });
    } catch {
      setAuthError("登录服务暂时异常，请稍后重试或联系管理员；这不代表密码错误。");
      return;
    }
    if (res?.ok) {
      router.replace(callbackUrl);
      router.refresh();
      return;
    }
    if (res?.error !== "CredentialsSignin") {
      setAuthError("登录服务暂时异常，请稍后重试或联系管理员；这不代表密码错误。");
      return;
    }
    // 仅在凭据被拒后查询绑定策略，不通过预检暴露账号是否存在。
    try {
      if (await checkLoginTotpEnforcement(values.email)) {
        setAuthError("该账号已被管理员要求开启双步验证，且尚未完成绑定，暂无法登录。请联系管理员协助完成绑定。");
        return;
      }
    } catch {
      // 预检不可用时保留通用错误提示。
    }
    setAuthError(showTotp ? "邮箱、密码或两步验证码错误" : "邮箱或密码错误；如账号已开启两步验证，请勾选「使用两步验证码」后填写。");
  }

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      {authError && <Banner type="danger" description={<span role="alert">{authError}</span>} closeIcon={null} />}
      <div>
        <Form.Label name="email" text="邮箱" />
        <Controller name="email" control={control} render={({ field }) => (
          <Input {...field} id="email" type="email" autoComplete="email" placeholder="name@firm.cn"
            prefix={<Mail size={16} aria-hidden />} size="large" disabled={isSubmitting}
            aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined}
            validateStatus={errors.email ? "error" : "default"} />
        )} />
        {errors.email && <p id="email-error" role="alert" className="mt-1 text-sm text-[var(--semi-color-danger)]">{errors.email.message}</p>}
      </div>
      <div>
        <Form.Label name="password" text="密码" />
        <Controller name="password" control={control} render={({ field }) => (
          <Input {...field} id="password" type={showPassword ? "text" : "password"} autoComplete="current-password"
            prefix={<LockKeyhole size={16} aria-hidden />} size="large" disabled={isSubmitting}
            aria-invalid={!!errors.password} aria-describedby={errors.password ? "password-error" : undefined}
            validateStatus={errors.password ? "error" : "default"}
            suffix={<Button htmlType="button" theme="borderless" type="tertiary" aria-label={passwordToggleLabel}
              aria-controls="password" title={passwordToggleLabel} disabled={isSubmitting}
              icon={<PasswordIcon size={16} aria-hidden />} onClick={() => setShowPassword(value => !value)} />} />
        )} />
        {errors.password && <p id="password-error" role="alert" className="mt-1 text-sm text-[var(--semi-color-danger)]">{errors.password.message}</p>}
      </div>
      {showTotp && <div>
        <Form.Label name="totpCode" text="两步验证码" />
        <Controller name="totpCode" control={control} render={({ field }) => (
          <Input {...field} id="totpCode" inputMode="numeric" maxLength={16} autoFocus
            placeholder="6 位动态码或恢复码" autoComplete="one-time-code" size="large"
            prefix={<ShieldCheck size={16} aria-hidden />} disabled={isSubmitting} />
        )} />
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox checked={showTotp} disabled={isSubmitting} onChange={event => setShowTotp(!!event.target.checked)}>
          使用两步验证码
        </Checkbox>
        <span className="text-sm text-[var(--semi-color-text-2)]" title="本系统为自部署实例，密码由所内管理员在管理后台重置">忘记密码？请联系管理员</span>
      </div>
      <Button htmlType="submit" theme="solid" type="primary" size="large" block loading={isSubmitting} disabled={isSubmitting}>
        {isSubmitting ? "登录中…" : "登 录"}
      </Button>
    </form>
  );
}
