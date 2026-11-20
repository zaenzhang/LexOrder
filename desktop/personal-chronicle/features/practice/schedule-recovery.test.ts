import { renderWithRouter } from "@/scripts/render-test"
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { fireEvent, screen, within } from "@testing-library/react/pure"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, expect, it, vi } from "vitest"
import { TaskResponsibilities } from "./task-responsibilities"
import { PersonalCalendar } from "./personal-calendar"
import { ProcedureActions } from "../matters/case-management"

const container = document.body.appendChild(document.createElement("div"))
const client = new QueryClient()
let root: ReturnType<typeof createRoot>
async function show(child: React.ReactElement) {
  root = createRoot(container)
  await act(async () => renderWithRouter(root, createElement(QueryClientProvider, { client }, child)))
}
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  vi.unstubAllGlobals()
})

it.each([true, false])("处理冲突后保留原因，按最新记录决定能否重新提交（仍可处置 %s）", async canWrite => {
  const row = { id: "task-a", matterId: "case-a", matterTitle: "甲案", title: "核对材料", dueAt: null,
    revision: 2, state: "OPEN", canWrite: true }
  const submissions: { revision: number; reason: string }[] = []
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "POST") {
      submissions.push(JSON.parse(String(init.body)))
      return submissions.length === 1 ? Response.json({ error: "任务已变化" }, { status: 403 }) : Response.json({ ok: true })
    }
    return Response.json({ items: [submissions.length ? { ...row, title: "更新后的任务", revision: 3, canWrite } : row] })
  })
  await show(createElement(TaskResponsibilities))
  await act(async () => { fireEvent.click(within(await screen.findByRole("table", { name: "跨案任务清单" })).getByRole("button", { name: /^办结$/ })) })
  const dialog = within(await screen.findByRole("dialog"))
  const reason = await dialog.findByRole("textbox", { name: "处理原因" })
  await act(async () => { fireEvent.change(reason, { target: { value: "材料已核对" } }) })
  await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "办结 · 核对材料" })) })
  await dialog.findByText(canWrite ? /请核对后再次提交/ : /处理原因仍可复制/)
  expect((reason as HTMLTextAreaElement).value).toBe("材料已核对")
  expect(submissions).toHaveLength(1)
  const submit = dialog.getByRole("button", { name: "办结 · 更新后的任务" }) as HTMLButtonElement
  expect(submit.disabled).toBe(!canWrite)
  if (canWrite) {
    await act(async () => { fireEvent.click(submit) })
    expect(submissions[1]).toMatchObject({ revision: 3, reason: "材料已核对" })
  }
})

it("月历跳转到实际收案和案件任务工作台，并可筛掉内部任务", async () => {
  const id = "c" + "a".repeat(24), intake = "c" + "i".repeat(24)
  const today = "2030-05-01"
  vi.stubGlobal("fetch", async () => Response.json({ today, items: [
    { id: "a", type: "task", title: "准备材料", day: today, clock: "09:00", matter: { id: intake, title: "待转收案" }, href: "/practice/intakes/" + intake },
    { id: "b", type: "task", title: "保存材料", day: today, clock: "10:00", matter: { id, title: "已立案件" }, href: "/matters/" + id + "/materials?task=b&from=schedule&day=" + today },
  ] }))
  await show(createElement(PersonalCalendar, { today }))
  expect((await screen.findByRole("link", { name: /待转收案/ })).getAttribute("href")).toBe("/practice/intakes/" + intake)
  expect(screen.getByRole("link", { name: /已立案件/ }).getAttribute("href")).toBe("/matters/" + id + "/materials?task=b&from=schedule&day=" + today)
  await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: /内部任务/ })) })
  expect(screen.queryByRole("link", { name: /已立案件/ })).toBeNull()
  expect(screen.getByText("当天没有可见安排。")).toBeDefined()
})

it("桌面新登记分配新键，失败后原表单重试沿用原键", async () => {
  const keys: string[] = []
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    keys.push(JSON.parse(String(init.body)).data.requestKey)
    return keys.length === 1 ? Response.json({ error: "未收到回执" }, { status: 503 }) : Response.json({ id: "stored" })
  })
  await show(createElement(ProcedureActions, { matterId: "a", types: {}, reload() {}, procedure: {
    id: "p", name: "一审", type: "FIRST_INSTANCE", caseNumber: null, handlingAgency: null, customLabel: null, engagement: "ENGAGED", updatedAt: "",
  } }))
  async function open() {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "登记期限" })) })
    return (await screen.findByRole("dialog")).querySelector("form")!
  }
  const form = await open()
  await act(async () => { fireEvent.submit(form) })
  await screen.findByText("未收到回执")
  await act(async () => { fireEvent.submit(form) })
  const nextForm = await open()
  await act(async () => { fireEvent.submit(nextForm) })
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(keys[1]).toBe(keys[0])
  expect(keys[2]).not.toBe(keys[0])
})
