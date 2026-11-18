import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(), enforcement: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
  changePassword: vi.fn(), saveAvatar: vi.fn(), startTotp: vi.fn(), confirmTotp: vi.fn(), disableTotp: vi.fn(),
  getIdentity: vi.fn(), bindIdentity: vi.fn(), correctIdentity: vi.fn(), correctPhotos: vi.fn(),
  getRecognition: vi.fn(), recognize: vi.fn(), confirm: vi.fn(),
  success: vi.fn(), error: vi.fn(), warning: vi.fn()
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams("callbackUrl=%2Fmatters")
}));
vi.mock("next-auth/react", () => ({ signIn: mocks.signIn }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, warning: mocks.warning } }));
vi.mock("@/server/users/actions", () => ({ changeMyPassword: mocks.changePassword, saveMyAvatar: mocks.saveAvatar }));
vi.mock("@/server/auth/totp-actions", () => ({
  checkLoginTotpEnforcement: mocks.enforcement,
  enrollStartTotp: mocks.startTotp, enrollConfirmTotp: mocks.confirmTotp, disableTotp: mocks.disableTotp
}));
vi.mock("@/server/users/profile-actions", () => ({
  getProfileIdentity: mocks.getIdentity, bindMyIdentity: mocks.bindIdentity, correctUserIdentity: mocks.correctIdentity
}));
vi.mock("@/server/identity-documents/actions", () => ({ correctUserIdentityWithPhotos: mocks.correctPhotos }));
vi.mock("@/server/identity-documents/recognition", () => ({
  getIdentityRecognitionConfig: mocks.getRecognition, recognizeIdentityDocument: mocks.recognize
}));
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.confirm }));

import { LoginForm } from "@/app/(auth)/login/login-form";
import { ChangePasswordForm } from "@/app/(app)/settings/profile/_components/change-password-form";
import { TotpCard } from "@/app/(app)/settings/profile/_components/totp-card";
import { AvatarForm } from "@/app/(app)/settings/profile/_components/avatar-form";
import { IdentityForm } from "@/components/users/identity-form";
import { IdentityDocumentFields, type IdentityDocumentDraft } from "@/components/users/identity-document-fields";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mocks.signIn.mockResolvedValue({ ok: false, error: "CredentialsSignin" });
  mocks.enforcement.mockResolvedValue(false);
  mocks.startTotp.mockResolvedValue({ secret: "SYNTHETICSECRET", uri: "otpauth://totp/Fixture" });
  mocks.confirmTotp.mockResolvedValue({ ok: false, message: "动态码无效" });
  mocks.disableTotp.mockResolvedValue({ ok: false, message: "动态码无效" });
  mocks.getIdentity.mockResolvedValue({
    userId: "synthetic-user", documentType: null, documentTypeLabel: null, number: null,
    updatedAt: "2026-11-18T00:00:00.000Z", photos: []
  });
});

afterEach(() => {
  cleanup();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
});

function fillLogin() {
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "login@example.invalid" } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "fixture-password" } });
}

function photoInput(buttonName: string) {
  // 每个 Upload 另有一个列表替换 input；按业务入口定位普通选片 input。
  return screen.getByRole("button", { name: buttonName }).closest(".semi-upload")!
    .querySelector<HTMLInputElement>("input.semi-upload-hidden-input")!;
}

async function chooseOtherIdentityType() {
  const select = screen.getByRole("combobox", { name: "证件类型" });
  fireEvent.keyDown(select, { key: "Enter" });
  const listbox = await screen.findByRole("listbox");
  await waitFor(() => expect(screen.getByRole("option", { name: "中华人民共和国居民身份证" })).toHaveFocus());
  fireEvent.keyDown(listbox, { key: "End" });
  const other = screen.getByRole("option", { name: "其他身份证件" });
  await waitFor(() => expect(other).toHaveFocus());
  fireEvent.keyDown(other, { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  expect(select).toHaveTextContent("其他身份证件");
  return select;
}

describe("Semi 登录与账户设置", () => {
  it("校验失败聚焦邮箱；密码显示切换不提交登录", async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByText("请填写有效邮箱")).toBeInTheDocument();
    expect(mocks.signIn).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("邮箱")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("登录服务抛错保留输入，允许按原 callback 重新登录", async () => {
    mocks.signIn.mockRejectedValueOnce(new Error("synthetic network failure"));
    render(<LoginForm />);
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByText(/登录服务暂时异常/)).toBeInTheDocument();
    expect(screen.getByLabelText("邮箱")).toHaveValue("login@example.invalid");
    expect(screen.getByLabelText("密码")).toHaveValue("fixture-password");
    expect(mocks.enforcement).not.toHaveBeenCalled();
    mocks.signIn.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/matters"));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("两步码使用真实输入；关闭两步选项不提交隐藏的旧码", async () => {
    render(<LoginForm />);
    fillLogin();
    fireEvent.click(screen.getByRole("checkbox", { name: "使用两步验证码" }));
    fireEvent.change(screen.getByLabelText("两步验证码"), { target: { value: "RECOVERY123" } });
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByText("邮箱、密码或两步验证码错误")).toBeInTheDocument();
    expect(mocks.signIn).toHaveBeenLastCalledWith("credentials", expect.objectContaining({ totpCode: "RECOVERY123" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "使用两步验证码" }));
    expect(screen.queryByLabelText("两步验证码")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(2));
    expect(mocks.signIn).toHaveBeenLastCalledWith("credentials", expect.objectContaining({ totpCode: undefined }));
    await screen.findByText(/邮箱或密码错误；如账号已开启/);
  });

  it("仅凭据被拒才检查强制两步绑定策略", async () => {
    mocks.enforcement.mockResolvedValueOnce(true);
    render(<LoginForm />);
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    expect(await screen.findByText(/尚未完成绑定，暂无法登录/)).toBeInTheDocument();
    expect(mocks.enforcement).toHaveBeenCalledWith("login@example.invalid");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("改密不匹配拒绝提交；服务失败保留输入，成功后清空", async () => {
    mocks.changePassword.mockRejectedValueOnce(new Error("当前密码错误"));
    render(<ChangePasswordForm />);
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "old-fixture" } });
    fireEvent.change(screen.getByLabelText("新密码（至少 8 位）"), { target: { value: "new-fixture" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "different-fixture" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(await screen.findByText("两次输入的新密码不一致")).toBeInTheDocument();
    expect(mocks.changePassword).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-fixture" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("修改失败", expect.anything()));
    expect(screen.getByLabelText("当前密码")).toHaveValue("old-fixture");
    expect(screen.getByLabelText("新密码（至少 8 位）")).toHaveValue("new-fixture");
    await waitFor(() => expect(screen.getByRole("button", { name: "修改密码" })).toHaveAttribute("aria-disabled", "false"));
    mocks.changePassword.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("密码已修改"));
    expect(mocks.changePassword).toHaveBeenLastCalledWith({ currentPassword: "old-fixture", newPassword: "new-fixture" });
    expect(screen.getByLabelText("当前密码")).toHaveValue("");
  });

  it("TOTP 错误不丢动态码，只有服务确认成功才显示恢复码", async () => {
    render(<TotpCard enabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "开启双步验证" }));
    const code = await screen.findByLabelText("第 2 步：输入 App 显示的 6 位动态码确认");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "确认并开启" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("验证失败", { description: "动态码无效" }));
    expect(code).toHaveValue("123456");
    expect(screen.queryByText("恢复码（仅此一次展示）")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "确认并开启" })).toHaveAttribute("aria-disabled", "false"));
    mocks.confirmTotp.mockResolvedValueOnce({ ok: true, recoveryCodes: ["fixture-code-a", "fixture-code-b"] });
    fireEvent.click(screen.getByRole("button", { name: "确认并开启" }));
    expect(await screen.findByText("fixture-code-a")).toBeInTheDocument();
    expect(mocks.confirmTotp).toHaveBeenLastCalledWith({ code: "123456" });
    expect(screen.queryByDisplayValue("123456")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "我已妥善保存" }));
    expect(screen.queryByText("fixture-code-a")).not.toBeInTheDocument();
  });

  it("TOTP 关闭失败保留原码，取消不发送关闭动作", async () => {
    render(<TotpCard enabled />);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.change(screen.getByLabelText("动态码或恢复码"), { target: { value: "fixture-recovery" } });
    fireEvent.click(screen.getByRole("button", { name: "确认关闭" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("关闭失败", { description: "动态码无效" }));
    expect(screen.getByLabelText("动态码或恢复码")).toHaveValue("fixture-recovery");
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByLabelText("动态码或恢复码")).not.toBeInTheDocument();
    expect(mocks.disableTotp).toHaveBeenCalledOnce();
  });

  it("头像清除失败继续显示已保存头像，成功后才清除", async () => {
    mocks.saveAvatar.mockRejectedValueOnce(new Error("保存失败"));
    render(<AvatarForm name="合成姓名" initialAvatar="data:image/png;base64,aGVsbG8=" />);
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(screen.getByAltText("合成姓名")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "清除" })).toHaveAttribute("aria-disabled", "false"));
    mocks.saveAvatar.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "清除" })).not.toBeInTheDocument());
    expect(mocks.saveAvatar).toHaveBeenLastCalledWith({ avatar: null });
  });

  it("身份类型用 Enter 选值，不保存身份或提交外层基本资料", async () => {
    const outerSubmit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={outerSubmit}><IdentityForm /></form>);
    fireEvent.click(await screen.findByRole("button", { name: "登记" }));
    await chooseOtherIdentityType();
    expect(screen.getByLabelText("证件名称")).toBeInTheDocument();
    expect(mocks.bindIdentity).not.toHaveBeenCalled();
    expect(outerSubmit).not.toHaveBeenCalled();
  });

  it("账号 Dialog 内下拉 Escape 只关闭选项，保留证件与核对原因草稿", async () => {
    function AccountDialog() {
      const [open, setOpen] = useState(true);
      return <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>编辑账号资料</DialogTitle>
          <DialogDescription>维护基本资料，或核对并更正身份证件及照片。</DialogDescription>
          <IdentityForm adminTargetId="synthetic-user" />
        </DialogContent>
      </Dialog>;
    }
    render(<AccountDialog />);
    fireEvent.click(await screen.findByRole("button", { name: "登记身份证件" }));
    const select = await chooseOtherIdentityType();
    fireEvent.change(screen.getByLabelText("证件名称"), { target: { value: "合成证件" } });
    fireEvent.change(screen.getByLabelText("证件号码"), { target: { value: "SYNTHETIC-01" } });
    fireEvent.change(screen.getByLabelText("核对及更正原因"), { target: { value: "已核对合成原件" } });
    fireEvent.keyDown(select, { key: "Enter" });
    fireEvent.keyDown(await screen.findByRole("listbox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "编辑账号资料" })).toBeInTheDocument();
    expect(select).toHaveTextContent("其他身份证件");
    expect(screen.getByLabelText("证件名称")).toHaveValue("合成证件");
    expect(screen.getByLabelText("证件号码")).toHaveValue("SYNTHETIC-01");
    expect(screen.getByLabelText("核对及更正原因")).toHaveValue("已核对合成原件");
    expect(mocks.correctIdentity).not.toHaveBeenCalled();
    expect(mocks.correctPhotos).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("证件号码"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("新增用户 Sheet 内下拉 Escape 保留整个表单，Enter 选值不创建用户", async () => {
    const outerSubmit = vi.fn(event => event.preventDefault());
    function CreateUserSheet() {
      const [open, setOpen] = useState(true);
      const [identity, setIdentity] = useState<IdentityDocumentDraft>({ documentType: "PRC_RESIDENT_ID", documentName: "", documentNumber: "", primaryFile: null, secondaryFile: null });
      return <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right">
          <SheetTitle>新增用户</SheetTitle>
          <SheetDescription>登记基本资料和身份证件。</SheetDescription>
          <form onSubmit={outerSubmit}>
            <label htmlFor="fixture-name">姓名</label><input id="fixture-name" />
            <IdentityDocumentFields value={identity} onChange={setIdentity} onRecognizedName={vi.fn()} />
            <button type="submit">创建</button>
          </form>
        </SheetContent>
      </Sheet>;
    }
    render(<CreateUserSheet />);
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "合成用户" } });
    const select = await chooseOtherIdentityType();
    fireEvent.change(screen.getByLabelText("证件名称"), { target: { value: "合成证件" } });
    fireEvent.change(screen.getByLabelText("证件号码"), { target: { value: "SYNTHETIC-02" } });
    fireEvent.keyDown(select, { key: "Enter" });
    fireEvent.keyDown(await screen.findByRole("listbox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "新增用户" })).toBeInTheDocument();
    expect(screen.getByLabelText("姓名")).toHaveValue("合成用户");
    expect(select).toHaveTextContent("其他身份证件");
    expect(screen.getByLabelText("证件名称")).toHaveValue("合成证件");
    expect(screen.getByLabelText("证件号码")).toHaveValue("SYNTHETIC-02");
    expect(outerSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("证件号码"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each(["选择人像面照片（选填）", "选择另一面照片（选填）"])("%s 拒绝不支持的格式并提示", async (buttonName) => {
    const onChange = vi.fn();
    render(<IdentityDocumentFields value={{ documentType: "PRC_RESIDENT_ID", documentName: "", documentNumber: "", primaryFile: null, secondaryFile: null }} onChange={onChange} onRecognizedName={vi.fn()} />);
    fireEvent.change(photoInput(buttonName), { target: { files: [new File(["synthetic-document"], "fixture.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("证件照片仅支持 JPG、PNG 或 WebP"));
    expect(onChange).not.toHaveBeenCalled();
    expect(mocks.recognize).not.toHaveBeenCalled();
  });

  it.each(["选择新的主要证件照片（选填）", "选择新的另一面／补充页（选填）"])("%s 拒绝格式错误，保留先前照片草稿", async (buttonName) => {
    render(<IdentityForm adminTargetId="synthetic-user" />);
    fireEvent.click(await screen.findByRole("button", { name: "登记身份证件" }));
    const file = new File(["synthetic-photo"], "fixture.png", { type: "image/png" });
    fireEvent.change(photoInput(buttonName), { target: { files: [file] } });
    expect(await screen.findByText(file.name)).toBeInTheDocument();
    // Semi 接受文件后会重建原生 input；再次选片使用当前 DOM 节点。
    fireEvent.change(photoInput(buttonName), { target: { files: [new File(["synthetic-document"], "fixture.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("证件照片仅支持 JPG、PNG 或 WebP"));
    expect(screen.getByText(file.name)).toBeInTheDocument();
    expect(screen.queryByText("fixture.pdf")).not.toBeInTheDocument();
    expect(mocks.correctPhotos).not.toHaveBeenCalled();
  });

  it("选择证件照片只更新本地草稿，不自动上传或调用识别", async () => {
    const onChange = vi.fn();
    const file = new File(["synthetic-photo"], "fixture.png", { type: "image/png" });
    const previous = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:synthetic-photo");
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn();
    const open = vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => undefined);
    try {
      const { container } = render(<IdentityDocumentFields value={{ documentType: "PRC_RESIDENT_ID", documentName: "", documentNumber: "", primaryFile: null, secondaryFile: null }} onChange={onChange} onRecognizedName={vi.fn()} />);
      const input = container.querySelector('input[type="file"]')!;
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ primaryFile: file })));
      expect(open).not.toHaveBeenCalled();
      expect(mocks.recognize).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      URL.createObjectURL = previous;
      URL.revokeObjectURL = revoke;
    }
  });

  it("身份资料输入使用 Semi 值；识别外发取消不发送照片", async () => {
    mocks.getRecognition.mockResolvedValue({ configured: true, local: false, host: "ocr.example.invalid" });
    mocks.confirm.mockResolvedValue(false);
    const previous = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:synthetic-preview");
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn();
    function Fields() {
      const [value, setValue] = useState<IdentityDocumentDraft>({ documentType: "OTHER", documentName: "", documentNumber: "", primaryFile: new File(["synthetic"], "fixture.png", { type: "image/png" }), secondaryFile: null });
      return <IdentityDocumentFields value={value} onChange={setValue} onRecognizedName={vi.fn()} />;
    }
    try {
      render(<Fields />);
      fireEvent.change(screen.getByLabelText("证件名称"), { target: { value: "合成证件" } });
      fireEvent.change(screen.getByLabelText("证件号码"), { target: { value: "SYNTHETIC-01" } });
      fireEvent.click(screen.getByRole("button", { name: "自动识别" }));
      await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("ocr.example.invalid") })));
      expect(mocks.recognize).not.toHaveBeenCalled();
      expect(screen.getByLabelText("证件名称")).toHaveValue("合成证件");
      expect(screen.getByLabelText("证件号码")).toHaveValue("SYNTHETIC-01");
      await waitFor(() => expect(screen.getByRole("button", { name: "自动识别" })).toHaveAttribute("aria-disabled", "false"));
    } finally {
      URL.createObjectURL = previous;
      URL.revokeObjectURL = revoke;
    }
  });
});
