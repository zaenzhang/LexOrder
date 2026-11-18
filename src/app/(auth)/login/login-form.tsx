"use client";

import { Suspense, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Checkbox, Form, Input, Notification, Spin } from "@douyinfe/semi-ui";
import { Eye, EyeOff } from "lucide-react";
import { checkLoginTotpEnforcement } from "@/server/auth/totp-actions";
import styles from "./login.module.css";

const schema = z.object({
  email: z.string().email("请填写有效邮箱"),
  password: z.string().min(1, "请填写密码"),
  totpCode: z.string().optional()
});

type FormValues = z.infer<typeof schema>;

const LOGIN_NOTICE = "login-error";

export function LoginPanel() {
  return (
    <Card className={styles.card} bodyStyle={{ padding: "clamp(24px, 3.5vw, 40px)" }}>
      <Suspense fallback={<div className={styles.loading}><Spin /></div>}>
        <LoginForm />
      </Suspense>

    </Card>
  );
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const [showPassword, setShowPassword] = useState(false);
  const [showTotp, setShowTotp] = useState(false);
  const PasswordIcon = showPassword ? EyeOff : Eye;
  const passwordToggleLabel = showPassword ? "隐藏密码" : "显示密码";

  const { control, handleSubmit, formState: { isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", totpCode: "" }
  });

  useEffect(() => () => { Notification.close(LOGIN_NOTICE); }, []);

  function showLoginError(content: string) {
    Notification.error({ id: LOGIN_NOTICE, title: "登录失败", content, duration: 0 });
  }

  async function onSubmit(values: FormValues) {
    const res = await signIn("credentials", {
      email: values.email,
      password: values.password,
      totpCode: showTotp ? values.totpCode || undefined : undefined,
      redirect: false
    }).catch(() => null);
    if (res?.ok) {
      Notification.close(LOGIN_NOTICE);
      router.replace(callbackUrl);
      router.refresh();
    } else {
      if (res?.error !== "CredentialsSignin") {
        showLoginError("登录服务暂时不可用，请稍后重试或联系管理员。");
        return;
      }
      // 凭据被拒时区分策略性拦截：被管理员要求开启双步验证但尚未绑定的账号
      // 在完成绑定前无法登录（authorize 恒拒）。仅在已失败后查询，避免账号探测。
      try {
        const enforced = await checkLoginTotpEnforcement(values.email);
        if (enforced) {
          showLoginError("该账号已被管理员要求开启双步验证，且尚未完成绑定，暂无法登录。请联系管理员协助完成绑定。");
          return;
        }
      } catch {
        // 预检不可用时不影响通用错误提示
      }
      showLoginError(showTotp ? "邮箱、密码或两步验证码错误" : "邮箱或密码错误。如账号已开启两步验证，请填写验证码。如需重置密码，请联系管理员。");
    }
  }

  return (
    <form className={styles.form} method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Controller
        name="email"
        control={control}
        render={({ field, fieldState: { error } }) => (
          <Form.Slot label={{ name: "email", text: "邮箱" }} error={error && { error: error.message, errorMessageId: "login-email-error" }}>
            <Input
              {...field}
              className={styles.input}
              id="email"
              disabled={isSubmitting}
              type="email"
              size="large"
              autoComplete="email"
              placeholder="name@firm.cn"
              validateStatus={error ? "error" : "default"}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "login-email-error" : undefined}
            />
          </Form.Slot>
        )}
      />

      <Controller
        name="password"
        control={control}
        render={({ field, fieldState: { error } }) => (
          <Form.Slot label={{ name: "password", text: "密码" }} error={error && { error: error.message, errorMessageId: "login-password-error" }}>
            <Input
              {...field}
              className={styles.input}
              id="password"
              disabled={isSubmitting}
              type={showPassword ? "text" : "password"}
              size="large"
              autoComplete="current-password"
              suffix={
                <Button
                  htmlType="button"
                  theme="borderless"
                  type="tertiary"
                  size="small"
                  className={styles.passwordToggle}
                  disabled={isSubmitting}
                  aria-label={passwordToggleLabel}
                  aria-controls="password"
                  title={passwordToggleLabel}
                  icon={<PasswordIcon size={16} aria-hidden />}
                  onClick={() => setShowPassword((visible) => !visible)}
                />
              }
              validateStatus={error ? "error" : "default"}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "login-password-error" : undefined}
            />
          </Form.Slot>
        )}
      />

      <Checkbox
        addonId="login-totp-label"
        checked={showTotp}
        disabled={isSubmitting}
        onChange={(event) => setShowTotp(Boolean(event.target.checked))}
      >
        使用两步验证码
      </Checkbox>

      {showTotp ? (
        <Controller
          name="totpCode"
          control={control}
          render={({ field }) => (
            <Form.Slot label={{ name: "totpCode", text: "两步验证码" }}>
              <Input
                {...field}
                className={styles.input}
                id="totpCode"
                disabled={isSubmitting}
                size="large"
                inputMode="numeric"
                maxLength={16}
                autoFocus
                placeholder="6 位动态码或恢复码"
                autoComplete="one-time-code"
              />
            </Form.Slot>
          )}
        />
      ) : null}

      <Button className={styles.submit} htmlType="submit" theme="solid" size="large" block loading={isSubmitting} disabled={isSubmitting}>
        {isSubmitting ? "登录中…" : "登 录"}
      </Button>
    </form>
  );
}
