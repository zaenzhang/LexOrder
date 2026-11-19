// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { fireEvent, screen } from "@testing-library/react/pure"
import { expect, it, vi } from "vitest"
import { DeliveryWorkspace } from "./delivery-workspace"

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock("./personal-client", async original => ({
  ...await original<typeof import("./personal-client")>(), readPersonal: read,
}))

it.each(["准备交付", "另建补发清单"])("%s 采用打开时的审批状态并保存正确的原清单关系", async entry => {
  let approved = false
  const saved = vi.fn()
  read.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.body) {
      saved(JSON.parse(String(init.body)))
      return { id: "new" }
    }
    const query = new URL(url, "https://example.test").searchParams
    if (query.has("options")) return { canPrepare: true, clients: [], documents: [
      { id: "approved", name: "待签发文书", version: 2, canDeliver: approved, blockedReason: approved ? null : "待复核" },
    ] }
    if (query.get("record") !== "new") throw new Error("撤回清单不可读取")
    return { id: "new", purpose: "补发", items: [], events: [] }
  })
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(DeliveryWorkspace, {
      matterId: "matter", rows: [{ id: "withdrawn", itemCount: 2, purpose: null, recipientName: null, state: "UNAVAILABLE" }], reload: vi.fn(),
    })))
    expect(screen.queryByRole("button", { name: "查看清单" })).toBeNull()
    approved = true
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: entry })) })
    const version = screen.getByRole("checkbox", { name: /待签发文书/ }) as HTMLInputElement
    expect(version.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(version)
      fireEvent.change(screen.getByLabelText("接收人"), { target: { value: "委托人" } })
      fireEvent.change(screen.getByLabelText("实际联系方式或交接地点"), { target: { value: "办公处" } })
      fireEvent.change(screen.getByLabelText("交付目的"), { target: { value: "交付" } })
      fireEvent.change(screen.getByLabelText("披露范围"), { target: { value: "本案" } })
      fireEvent.click(screen.getByRole("button", { name: "保存固定清单" }))
    })
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ action: "prepare-delivery", data: expect.objectContaining({
      matterId: "matter", documentIds: ["approved"], supersedesId: entry === "另建补发清单" ? "withdrawn" : null,
    }) }))
    expect(read.mock.calls.some(([url]) => url.includes("record=withdrawn"))).toBe(false)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
