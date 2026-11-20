import { renderWithRouter } from "@/scripts/render-test"
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { fireEvent, screen } from "@testing-library/react/pure"
import { expect, it, vi } from "vitest"
import { QueryProvider } from "@/kit/data/query-provider"
import { MaterialsWorkspace } from "./materials-workspace"

const actOnCopy = vi.hoisted(() => vi.fn())
vi.mock("./working-copies", () => ({
  useWorkingCopies: () => ({
    act: actOnCopy, offline: false,
    copies: [
      { sessionId: "12345678-current", matterId: "current", id: "withdrawn", version: 2 },
      { sessionId: "87654321-foreign", matterId: "other", id: "hidden", version: 1 },
    ],
  }),
}))

it("材料撤回后仍可结束本案工作稿，仅暴露会话操作", async () => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  try {
    await act(async () => renderWithRouter(root, createElement(QueryProvider, {
      children: createElement(MaterialsWorkspace, {
        matterId: "current", canOrganize: false, documents: [], folders: [], filters: { q: "", folder: "*", version: "all" },
        onFilter: vi.fn(), onUploaded: vi.fn(), selection: [], hasReadOnlySelection: false, onSelectionChange: vi.fn(),
      }),
    })))
    expect(screen.queryByText(/87654321/)).toBeNull()
    expect(screen.queryByRole("button", { name: "打开本机稿" })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "保留本机稿并结束" })) })
    expect(actOnCopy).toHaveBeenCalledWith({ action: "finish", matterId: "current", sessionId: "12345678-current", keepLocal: true })
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
