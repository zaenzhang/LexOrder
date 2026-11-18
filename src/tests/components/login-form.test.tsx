import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  checkEnforcement: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("next-auth/react", () => ({ signIn: mocks.signIn }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams("callbackUrl=%2Fmatters")
}));
vi.mock("@/server/auth/totp-actions", () => ({ checkLoginTotpEnforcement: mocks.checkEnforcement }));

import { LoginForm } from "@/app/(auth)/login/login-form";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.signIn.mockResolvedValue({ ok: true });
  mocks.checkEnforcement.mockResolvedValue(false);
});

describe("登录表单使用 Semi 控件", () => {
  it("空表单保留字段级错误，点眼睛只切换密码可见性", async () => {
    render(<LoginForm />);
    const password = screen.getByLabelText("密码");
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByText("请填写有效邮箱")).toBeInTheDocument();
    expect(screen.getByText("请填写密码")).toBeInTheDocument();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("按需送出两步验证码，失败保留输入，关闭验证码后只提交当前可见字段", async () => {
    mocks.signIn.mockResolvedValueOnce({ ok: false, error: "CredentialsSignin" });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "fixture@example.invalid" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "synthetic-password" } });
    const checkbox = screen.getByRole("checkbox", { name: "使用两步验证码" });
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText("两步验证码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("邮箱、密码或两步验证码错误");
    expect(mocks.signIn).toHaveBeenNthCalledWith(1, "credentials", {
      email: "fixture@example.invalid", password: "synthetic-password", totpCode: "123456", redirect: false
    });
    expect(screen.getByLabelText("两步验证码")).toHaveValue("123456");
    fireEvent.click(checkbox);
    expect(screen.queryByLabelText("两步验证码")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/matters"));
    expect(mocks.signIn).toHaveBeenNthCalledWith(2, "credentials", {
      email: "fixture@example.invalid", password: "synthetic-password", totpCode: undefined, redirect: false
    });
    await waitFor(() => expect(screen.queryByRole("alert", { name: "登录失败" })).not.toBeInTheDocument());
  });

  it("登录服务异常使用 Semi 通知，重试成功后清除提示", async () => {
    mocks.signIn.mockRejectedValueOnce(new Error("synthetic network failure"));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "fixture@example.invalid" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "synthetic-password" } });
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByRole("alert", { name: "登录失败" })).toHaveTextContent("登录服务暂时不可用");
    expect(mocks.replace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/matters"));
    await waitFor(() => expect(screen.queryByRole("alert", { name: "登录失败" })).not.toBeInTheDocument());
  });
});
