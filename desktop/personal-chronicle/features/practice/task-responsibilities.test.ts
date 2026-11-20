import { createElement, type ReactNode } from "react"
import { MemoryRouter } from "react-router"
import { renderToStaticMarkup } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TaskWorkspace, type TaskData } from "@/features/matters/task-workspace"
import { TaskResponsibilities } from "./task-responsibilities"

const { navigation } = vi.hoisted(() => ({ navigation: { query: "" } }))
vi.mock("@/kit/framework", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/kit/framework")>()),
  useSearchParams: () => new URLSearchParams(navigation.query),
}))

function renderRoute(element: ReactNode) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, element))
}

const boardRow = {
  id: "task-a",
  title: "核对证据",
  matterId: "case-a",
  matterTitle: "甲案",
  stageId: "stage-a",
  dueAt: null,
  revision: 2,
  state: "OPEN",
  canWrite: true,
}
afterEach(() => {
  navigation.query = ""
})

describe("跨案任务责任板", () => {
  it("用案件及任务 ID 区分同名任务，并按行限制处置", () => {
    const client = new QueryClient()
    client.setQueryData(["practice", "view=responsibilities&closed=0"], {
      items: [
        boardRow,
        {
          ...boardRow,
          id: "task-b",
          matterId: "case-b",
          matterTitle: "乙案",
          canWrite: false,
        },
      ],
    })
    const html = renderRoute(
      createElement(
        QueryClientProvider,
        { client },
        createElement(TaskResponsibilities)
      )
    )
    expect(html).toContain("/matters/case-a/tasks?task=task-a")
    expect(html).toContain("/matters/case-b/tasks?task=task-b")
    const desktop = html.match(/<table[^>]*>[\s\S]*?<\/table>/)?.[0]
    expect(desktop?.match(/>取消任务</g)).toHaveLength(1)
    expect(desktop?.match(/>办结</g)).toHaveLength(1)
    client.clear()
  })

  it("今日办理将等待反馈页签和当前环节带入核对工作台", () => {
    const client = new QueryClient()
    client.setQueryData(["practice", "view=responsibilities&taskView=waiting"], { items: [boardRow] })
    const html = renderRoute(createElement(QueryClientProvider, { client }, createElement(TaskResponsibilities, { view: "waiting" })))
    expect(html).toContain("/matters/case-a/materials?task=task-a&amp;stage=stage-a&amp;from=today&amp;taskView=waiting")
    client.clear()
  })

  it("从责任板回案后直接显示指定的已取消任务", () => {
    navigation.query = "task=task-a"
    const task = {
      id: "task-a",
      title: "待核对的材料",
      description: null,
      dueAt: null,
      priority: 0,
      stageId: "stage-a",
      stageName: "举证",
      procedureTitle: "一审",
      assignee: "本人",
      state: "CANCELLED" as const,
      revision: 3,
      blockingCount: 0,
    }
    const data: TaskData = {
      tasks: [
        task,
        { ...task, id: "other", title: "另一份材料", state: "OPEN" },
      ],
      procedures: [],
      untracked: [],
      canWrite: true,
      procedureTypes: {},
    }
    const html = renderRoute(
      createElement(TaskWorkspace, { matterId: "case-a", data, reload() {} })
    )
    expect(html).toContain("待核对的材料")
    expect(html).toContain("已取消")
    expect(html).not.toContain("另一份材料")
    expect(html).toContain("查看本案全部任务")

    navigation.query = "task=task-a&program=other-program"
    const wrongProgram = renderRoute(
      createElement(TaskWorkspace, { matterId: "case-a", data, reload() {} })
    )
    expect(wrongProgram).not.toContain("待核对的材料")
    expect(wrongProgram).toContain("程序不可查看")
  })
})
