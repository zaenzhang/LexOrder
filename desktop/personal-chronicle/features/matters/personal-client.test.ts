import { afterEach, expect, it, vi } from "vitest"
import { readPersonal, workspaceEndpoint } from "./personal-client"

const { invoke, isTauri } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

it("renews the desktop channel only on an explicit session failure and replays the same request", async () => {
  const request = { method: "POST", body: JSON.stringify({ requestKey: "same-id", action: "example" }) }
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403, headers: { "X-Lexorder-Channel": "required" } }))
    .mockResolvedValueOnce(Response.json({ id: "record" }))
  vi.stubGlobal("fetch", fetcher)
  isTauri.mockReturnValue(true)
  invoke.mockResolvedValue(undefined)

  await expect(readPersonal(workspaceEndpoint, request)).resolves.toEqual({ id: "record" })
  expect(invoke).toHaveBeenCalledExactlyOnceWith("renew_personal_channel")
  expect(fetcher.mock.calls).toEqual([[workspaceEndpoint, request], [workspaceEndpoint, request]])
})

it.each([["business refusal", 403, true], ["browser without desktop", 403, false]] as const)(
  "%s has no native renewal and no replay", async (_scenario, status, desktop) => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: "当前请求不可用" }, { status, headers: desktop ? {} : { "X-Lexorder-Channel": "required" } }))
    vi.stubGlobal("fetch", fetcher)
    isTauri.mockReturnValue(desktop)
    await expect(readPersonal(workspaceEndpoint)).rejects.toThrow("当前请求不可用")
    expect(invoke).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
  },
)

it("shares one native renewal across two parallel reads and stops after a second explicit session failure", async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ error: "当前会话已失效" }, { status: 403, headers: { "X-Lexorder-Channel": "required" } }))
  vi.stubGlobal("fetch", fetcher)
  isTauri.mockReturnValue(true)
  invoke.mockResolvedValue(undefined)

  const results = await Promise.allSettled([readPersonal(workspaceEndpoint), readPersonal(workspaceEndpoint)])
  expect(results.map(result => result.status)).toEqual(["rejected", "rejected"])
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledTimes(4)
})
