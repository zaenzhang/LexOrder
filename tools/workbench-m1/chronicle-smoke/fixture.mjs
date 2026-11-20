import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function fixture() {
  // These tests write synthetic finance records, files and matters; the fixture
  // manifest belongs to a dedicated disposable workspace, never a normal user.
  const workspace = path.resolve(process.env.M1_WORKSPACE || "");
  if (!process.env.M1_WORKSPACE || !process.env.M1_READY_FILE)
    throw Error(
      "Set M1_WORKSPACE and M1_READY_FILE to the isolated Personal runtime.",
    );
  const [manifest, ready, cases] = await Promise.all(
    [
      readFile(path.join(workspace, "workspace.json"), "utf8"),
      readFile(process.env.M1_READY_FILE, "utf8"),
      readFile(path.join(workspace, "chronicle-smoke-cases.json"), "utf8"),
    ].map(async (data) => JSON.parse(await data)),
  );
  const { origin, token } = ready;
  const base = new URL(origin);
  assert(
    base.origin === origin &&
      base.protocol === "http:" &&
      base.hostname === "127.0.0.1" &&
      base.port,
  );
  assert(/^[a-f0-9]{64}$/.test(token) && manifest.mode === "PERSONAL");
  assert(
    cases.length === 2 &&
      cases[0].id !== cases[1].id &&
      cases.every((m) => /^c[a-z0-9]{24,}$/.test(m.id)),
  );
  if (cases.some((m) => !m.internalCode.startsWith("CHRONICLE-TEST-")))
    throw Error("Use two disposable CHRONICLE-TEST- cases for smoke runs.");
  const desktopOrigin = process.env.M1_CHRONICLE_ORIGIN;
  if (desktopOrigin) {
    const desktop = new URL(desktopOrigin);
    assert(
      desktop.origin === desktopOrigin &&
        desktop.protocol === "http:" &&
        desktop.hostname === "127.0.0.1" &&
        desktop.port,
    );
  }
  async function request(url, body, expected = 200) {
    assert(url.startsWith("/api/") && !url.startsWith("//"));
    const target = desktopOrigin ?? origin;
    const headers = {
      Cookie: "lexorder_local_channel=" + token,
      Origin: target,
    };
    if (body && !(body instanceof FormData))
      headers["Content-Type"] = "application/json";
    const response = await fetch(target + url, {
      method: body ? "POST" : "GET",
      headers,
      body: body instanceof FormData ? body : body && JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    });
    if (response.status !== expected) {
      const details = await response.json().catch(() => ({}));
      throw Error(
        url.split("?")[0] +
          " returned " +
          response.status +
          ", expected " +
          expected +
          ". " +
          (details.error || ""),
      );
    }
    return response;
  }
  return { workspace, manifest, cases, request };
}
