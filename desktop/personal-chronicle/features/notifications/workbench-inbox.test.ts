// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react/pure"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NotificationsInbox } from "@/kit/notifications/notifications-inbox"
import { renderWithRouter } from "@/scripts/render-test"

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  })
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function show(props: ComponentProps<typeof NotificationsInbox>) {
  return act(async () => renderWithRouter(root, createElement(NotificationsInbox, props)))
}

function click(name: string) {
  return act(async () => { fireEvent.click(screen.getByRole("button", { name })) })
}

describe("工作台通知收件箱", () => {
  it("通知分页未包含较早的未读项时仍可筛选和批量标记", async () => {
    const onFilterChange = vi.fn()
    const onMarkRead = vi.fn()
    const props = {
      workbench: true,
      items: [{
        id: "recent",
        title: "已读通知",
        body: "",
        href: "/practice/notifications",
        read: true,
        at: "2023-09-01T23:30:00Z",
      }],
      unreadCount: 2,
      loading: false,
      onFilterChange,
      onMarkRead,
    }
    await show(props)
    expect(screen.getByRole("heading", { name: /^2023年9月2日/ })).toBeTruthy()
    await click("未读 (2)")
    expect(onFilterChange).toHaveBeenCalledWith("unread")

    await show({ ...props, items: [] })
    expect(screen.getByText("没有未读通知")).toBeTruthy()
    await click("全部标为已读")
    expect(onMarkRead).toHaveBeenCalledWith("all")

    await show({ ...props, items: [], readPending: true })
    expect((screen.getByRole("button", { name: "全部标为已读" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("读取失败时可以重试", async () => {
    const onRetry = vi.fn()
    await show({
      workbench: true,
      items: undefined,
      loading: false,
      error: new Error("测试读取失败"),
      onRetry,
      onMarkRead: vi.fn(),
    })
    expect(screen.getByText("无法读取通知")).toBeTruthy()
    expect(screen.getByText("测试读取失败")).toBeTruthy()
    await click("重试")
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
