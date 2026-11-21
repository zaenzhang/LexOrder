// @vitest-environment node
import { type as osType } from "node:os";
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { openDefaultEditor } from "@/server/desktop/default-editor";

vi.mock("node:os", async importOriginal => {
  const os = await importOriginal<typeof import("node:os")>();
  return { ...os, type: vi.fn(os.type) };
});
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("默认编辑器只收到系统桌面会话环境", async () => {
  const secrets = ["LEXORDER_PERSONAL_CHANNEL_TOKEN", "DATABASE_URL", "STORAGE_ENCRYPTION_KEY", "AUTH_SECRET", "ARBITRARY_API_KEY"];
  for (const key of secrets) vi.stubEnv(key, "private-synthetic");
  vi.stubEnv("XDG_CONFIG_HOME", "/synthetic/desktop");
  const child = new EventEmitter();
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() => child.emit("exit", 0));
    return child as ReturnType<typeof spawn>;
  });
  await openDefaultEditor("/synthetic/case/合同.txt");
  const options = vi.mocked(spawn).mock.calls[0][2]!;
  expect(options.env?.XDG_CONFIG_HOME).toBe("/synthetic/desktop");
  for (const key of secrets) expect(options.env).not.toHaveProperty(key);
});

it.each([0, 7])("Windows 等待默认程序关联结果，即使启动助手延迟退出（退出码 %i）", async code => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  const file = "C:\\测试案 [A]\\工作稿\\合同.txt";
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  vi.useFakeTimers();
  vi.mocked(osType).mockReturnValueOnce("Windows_NT");
  try {
    const settled = vi.fn();
    const opened = openDefaultEditor(file).then(() => settled("ok"), error => settled(error.message));
    await vi.advanceTimersByTimeAsync(2000);
    expect(settled).not.toHaveBeenCalled();
    expect(child.unref).not.toHaveBeenCalled();
    const [command, args, options] = vi.mocked(spawn).mock.calls[0];
    expect(command).toBe("powershell.exe");
    expect(args).not.toContain(file);
    expect(options).toMatchObject({ shell: false, env: { LEXORDER_OPEN_WORKING_COPY: file } });
    child.emit("exit", code);
    await opened;
    expect(settled).toHaveBeenCalledWith(code === 0 ? "ok" : expect.stringContaining("系统未能打开"));
  } finally {
    vi.useRealTimers();
  }
});
