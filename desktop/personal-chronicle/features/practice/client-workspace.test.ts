// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, screen, within } from "@testing-library/react/pure"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import { CLIENT_TABS } from "@/config/client-tabs"
import { WORKBENCH_NAV } from "@/config/nav"
import { activeHref } from "@/kit/shell/nav-active"
import { renderWithRouter } from "@/scripts/render-test"

import { ClientWorkspace } from "./client-intake"

const write = vi.hoisted(() => vi.fn())
vi.mock("./data", async original => ({
  ...await original<typeof import("./data")>(),
  writePractice: write,
}))

it("客户入口在各页签和收案详情下高亮，其他工作区页面独立匹配", () => {
  for (const tab of CLIENT_TABS) {
    expect(activeHref(tab.href, WORKBENCH_NAV.items)).toBe(CLIENT_TABS[0].href)
  }
  expect(activeHref("/practice/intakes/record", WORKBENCH_NAV.items)).toBe(CLIENT_TABS[0].href)
  expect(activeHref("/practice/intakes-other", WORKBENCH_NAV.items)).toBeNull()
  expect(activeHref("/practice/skills/templates", WORKBENCH_NAV.items)).toBe("/practice/skills")
})

it("冲突预检在表格显示命中，并区分无命中和查询失败", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const client = new QueryClient()
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  write.mockReset()
    .mockResolvedValueOnce({ hits: [{ id: "test-hit", severity: "中风险", reason: "合成核查提示" }], sameName: 1 })
    .mockResolvedValueOnce({ hits: [], sameName: 0 })
    .mockRejectedValueOnce(new Error("读取核查数据失败"))
  const submit = (name: string) => act(async () => {
    fireEvent.change(screen.getByRole("textbox", { name: "当事人姓名或名称" }), { target: { value: name } })
    fireEvent.click(screen.getByRole("button", { name: "预检" }))
  })

  try {
    await act(async () => renderWithRouter(root, createElement(QueryClientProvider, { client },
      createElement(ClientWorkspace, { view: "conflicts", creatingIntake: false }))))
    expect(screen.getByRole("tab", { name: "冲突预检" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.queryByText("未发现冲突提示。")).toBeNull()

    await submit("合成测试甲")
    expect(write).toHaveBeenNthCalledWith(1, { action: "precheck", name: "合成测试甲" })
    const table = within(screen.getByRole("table", { name: "冲突预检结果" }))
    expect(table.getByRole("cell", { name: "合成核查提示" })).toBeTruthy()

    await submit("合成测试乙")
    expect(screen.getByText("未发现冲突提示。")).toBeTruthy()
    expect(screen.queryByText("合成核查提示")).toBeNull()

    await submit("合成测试丙")
    expect(screen.getByRole("alert").textContent).toBe("读取核查数据失败")
    expect(screen.queryByText("未发现冲突提示。")).toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    client.clear()
    vi.unstubAllGlobals()
  }
})
