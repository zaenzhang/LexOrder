// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { openDefaultEditor } from "@/server/desktop/default-editor";

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
