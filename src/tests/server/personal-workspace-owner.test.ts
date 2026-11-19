// @vitest-environment node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe.skipIf(process.platform !== "linux")("Linux personal workspace owner", () => {
  let workspace: string;
  beforeEach(async () => { workspace = await mkdtemp(path.join(tmpdir(), "lexorder-owner-")); });
  afterEach(async () => { await rm(workspace, { recursive: true, force: true }); });

  // Exercise the same helper as the launcher from independent processes.
  const owner = new URL("../../../tools/workbench-m1/workspace-owner.mjs", import.meta.url).href;
  const guard = new URL("../../../tools/workbench-m1/exit-with-owner.mjs", import.meta.url).href;
  const acquire = `import { acquireWorkspaceOwner } from ${JSON.stringify(owner)};
    const lock = await acquireWorkspaceOwner(process.argv[1]);`;
  function run(code: string) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", acquire + code, workspace], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let error = "";
    child.stderr.on("data", data => { error += data; });
    const exited = once(child, "exit").then(([code, signal]) => ({ code, signal, error }));
    return { child, exited };
  }

  it("excludes concurrent owners and releases the app child's lock after SIGKILL", async () => {
    const { child, exited } = run(`
      import { spawn } from 'node:child_process';
      const app = spawn(process.execPath, ['--import', ${JSON.stringify(guard)}, '-e',
        "process.send('ready'); setInterval(() => {}, 1000);"], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc', lock.fd]
      });
      app.once('message', () => console.log('ready'));
    `);
    try {
      await once(child.stdout, "data");
      expect(await run("await lock.close()").exited).toMatchObject({ code: 1, error: expect.stringContaining("WORKSPACE_BUSY") });
      child.kill("SIGKILL");
      expect(await exited).toMatchObject({ signal: "SIGKILL" });
      await expect.poll(async () => (await run("await lock.close()").exited).code).toBe(0);
      await expect(access(path.join(workspace, ".owner"))).rejects.toHaveProperty("code", "ENOENT");
    } finally { child.kill("SIGKILL"); }
  });

  it("keeps a live legacy owner and recovers a dead legacy PID", async () => {
    const marker = path.join(workspace, ".owner");
    await writeFile(marker, String(process.pid));
    expect(await run("await lock.close()").exited).toMatchObject({ code: 1, error: expect.stringContaining("WORKSPACE_BUSY") });
    expect(await readFile(marker, "utf8")).toBe(String(process.pid));
    const former = spawn(process.execPath, ["-e", ""]);
    await once(former, "exit");
    await writeFile(marker, String(former.pid));
    expect(await run("await lock.close()").exited).toMatchObject({ code: 0 });
  });
});
