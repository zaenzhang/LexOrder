import { renderWithRouter } from "@/scripts/render-test"
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { fireEvent, screen } from "@testing-library/react/pure"
import { expect, it, vi } from "vitest"
import { MatterFolder } from "./matter-folder"

const read = vi.hoisted(() => vi.fn())
vi.mock("./personal-client", () => ({ readPersonal: read }))

it("复制写满后重新读取暂存位置，可停止复制，再选择另一个盘", async () => {
  const state = { matterId: "case", path: null, suggestedName: "本案", available: false, copyStagePath: null }
  const pending = { ...state, copyStagePath: "/原盘/.lexorder-bind-Qwerty" }
  read.mockResolvedValueOnce(state).mockRejectedValueOnce(new Error("磁盘空间不足")).mockResolvedValueOnce(pending)
    .mockResolvedValueOnce(state).mockResolvedValueOnce({ ...state, path: "/新盘/本案", available: true })
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  try {
    await act(async () => renderWithRouter(root, createElement(MatterFolder, { matterId: state.matterId })))
    const choose = (value: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value } })
    const bind = () => fireEvent.click(screen.getByRole("button", { name: "绑定案件文件夹" }))
    await act(async () => { choose("/原盘") })
    await act(async () => { bind() })
    expect(screen.getByRole("alert").textContent).toContain("磁盘空间不足")
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "停止复制并保留外盘暂存" })) })
    expect(JSON.parse(read.mock.calls[3][1].body)).toEqual({ matterId: "case", action: "cancel-copy", stagePath: pending.copyStagePath })
    expect(screen.getByRole("status").textContent).toContain(pending.copyStagePath)
    await act(async () => { choose("/新盘") })
    await act(async () => { bind() })
    expect(JSON.parse(read.mock.calls[4][1].body)).toEqual({ matterId: "case", action: "bind", root: "/新盘" })
    expect(screen.getByText("/新盘/本案")).toBeTruthy()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
