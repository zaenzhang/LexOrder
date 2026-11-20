import { renderWithRouter } from "@/scripts/render-test"
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { fireEvent, screen } from "@testing-library/react/pure"
import { expect, it, vi } from "vitest"
import { MaterialVersionComparison } from "./material-version-comparison"

const read = vi.hoisted(() => vi.fn())
vi.mock("./personal-client", async original => ({
  ...await original<typeof import("./personal-client")>(), readPersonal: read,
}))

it("版本对照只打开同案获准版本，历史入口默认与当前版本并排", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  const material = { id: "old", name: "合成合同" }
  read.mockResolvedValueOnce({ versions: [
    { ...material, id: "new", version: 3, isLatest: true, preview: "office" },
    { ...material, id: "middle", version: 2, isLatest: false, preview: null },
    { ...material, version: 1, isLatest: false, preview: "inline" },
  ] })
  try {
    await act(async () => renderWithRouter(root, createElement(MaterialVersionComparison, { matterId: "matter-a", selection: material, close: vi.fn() })))
    expect(read.mock.calls[0][0]).toContain("matter=matter-a&section=material-versions&document=old")
    expect(screen.getByTitle("左侧原文 V1").getAttribute("src")).toBe("/api/documents/old/download?inline=1")
    expect(screen.getByTitle("右侧原文 V3").getAttribute("src")).toBe("/api/documents/new/preview")
    await act(async () => { fireEvent.change(screen.getByLabelText("右侧版本"), { target: { value: "middle" } }) })
    expect(screen.queryByTitle("右侧原文 V3")).toBeNull()
    expect(screen.getByRole("link", { name: "下载 V2" }).getAttribute("href")).toBe("/api/documents/middle/download")
    expect(read).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
