import { renderWithRouter } from "@/scripts/render-test"
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
// DOM test helpers come from the root package, alongside the API regression suite.
import { fireEvent, screen } from "@testing-library/react/pure"
import { expect, it, vi } from "vitest"
import { MatterSectionPage } from "./matter-section-page"
import { SavedResearchRevision } from "./research-revision"

vi.mock("@/kit/framework", async importOriginal => ({ ...(await importOriginal<typeof import("@/kit/framework")>()), useRouter: () => ({ replace: vi.fn() }) }))
vi.mock("./personal-client", async importOriginal => ({
  ...await importOriginal<typeof import("./personal-client")>(),
  readPersonal: async (url: string) => {
    const query = new URL(url, "http://localhost").searchParams
    const latest = { id: "v2", version: 2, readable: false, checkedAt: null }
    const older = { id: "v1", version: 1, readable: true, checkedAt: null }
    if (query.has("research")) return { records: [latest, older], nextVersion: null }
    if (query.get("record") === "v2") return { ...latest, current: true, content: null, issue: null, sources: [] }
    if (query.get("record") === "v1") return {
      ...older, current: false, content: { question: "旧版研究问题", conclusion: "第一版的结论", queryLog: [] }, sources: [],
    }
    return { records: [latest, { ...latest, id: "only", version: 1 }] }
  },
}))

it.each(["列表", "独立详情"])("从%s打开合法旧版，隐藏受限正文、出处和操作", async entry => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  const showRevision = (id: string) => renderWithRouter(root, createElement(SavedResearchRevision, { key: id, matterId: "case", recordId: id }))
  const navigate = (event: MouseEvent) => {
    const link = (event.target as Element).closest("a")
    if (!link) return
    event.preventDefault()
    const pathname = new URL(link.href).pathname
    expect(pathname).toBe("/matters/case/research/v1")
    showRevision(pathname.split("/").pop()!)
  }
  document.addEventListener("click", navigate)
  try {
    if (entry === "列表") {
      await act(async () => renderWithRouter(root, createElement(MatterSectionPage, { matterId: "case", section: "research", title: "研究" })))
      const open = await screen.findByRole("button", { name: "查看修订" })
      await act(async () => { fireEvent.click(open) })
    } else {
      await act(async () => showRevision("v2"))
    }
    expect(await screen.findByText("当前无权查看该研究修订。")).toBeTruthy()
    expect(screen.queryByText("查询与阅读")).toBeNull()
    expect(screen.queryByRole("button", { name: "据此版本生成分析工作稿" })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "查看修订历史" })) })
    const oldLink = await screen.findByRole("link", { name: "查看第 1 版" })
    await act(async () => { fireEvent.click(oldLink) })
    expect(await screen.findByText("第一版的结论")).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "查看修订历史" })) })
    expect(await screen.findByText("第 2 版 · 来源受限")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "查看第 2 版" })).toBeNull()
  } finally {
    document.removeEventListener("click", navigate)
    await act(async () => root.unmount())
    container.remove()
  }
})
