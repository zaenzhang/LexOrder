import { renderWithRouter } from "@/scripts/render-test"
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { fireEvent, screen } from "@testing-library/react/pure"
import { expect, it, vi } from "vitest"
import { EvidenceReview, type Issue } from "./evidence-review"
import type { FixedSource } from "./fixed-source-preview"

const { read, pins } = vi.hoisted(() => ({
  read: vi.fn(), pins: { current: new Map<string, string[]>() },
}))
vi.mock("@/kit/framework", async importOriginal => ({ ...(await importOriginal<typeof import("@/kit/framework")>()), useRouter: () => ({ push: vi.fn() }) }))
vi.mock("./matter-session", () => ({ usePinnedSources: () => pins }))
vi.mock("./personal-client", async original => ({
  ...await original<typeof import("./personal-client")>(), readPersonal: read,
}))

it.each(["已加载后撤回", "请求途中撤回", "案件只读", "争点消失"])("%s 保留填写内容并使用重读后的权限", async scenario => {
  const source = { id: "source", relation: "SUPPORTS" as const, status: "AVAILABLE", documentName: "旧文书", documentVersion: 1, locationLabel: "第 1 页" }
  const issue: Issue = { id: "issue", revision: 1, title: "争点", content: "原争点正文", confirmedAt: null, canEdit: true, restricted: false, sources: [source] }
  let issues = [issue]
  const preview: FixedSource = { status: "AVAILABLE", documentName: "旧文书", documentVersion: 1, locationLabel: "第 1 页",
    text: "已读取的原文摘录", previewUrl: null, downloadUrl: "/api/documents/doc/download", legacy: false, historicalParse: false, previewKind: "TEXT" }
  let finishRead!: (value: FixedSource) => void
  const delayed = new Promise<FixedSource>(resolve => { finishRead = resolve })
  read.mockReset().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init?.body) return { issues }
    if (JSON.parse(String(init.body)).action === "open-evidence-source") return scenario === "请求途中撤回" ? delayed : preview
    throw new Error("请重读争点")
  })
  pins.current.clear()
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  try {
    await act(async () => renderWithRouter(root, createElement(EvidenceReview, { matterId: "matter" })))
    const commission = screen.getByRole("link", { name: "委托核对" })
    expect(commission.getAttribute("href")).toBe("/matters/matter/materials?issue=issue&issueRevision=1&issueConfirmedAt=")
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /旧文书/ })) })
    if (scenario !== "请求途中撤回") expect(screen.getByText(preview.text!)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "固定页签" })) })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "记录取舍并形成研究" })) })
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "source" } })
      fireEvent.change(screen.getByLabelText("采用值"), { target: { value: "手工采用值" } })
      fireEvent.change(screen.getByLabelText("采用理由"), { target: { value: "手工理由" } })
      fireEvent.click(screen.getByRole("button", { name: "确认取舍并保存研究修订" }))
    })
    if (scenario === "争点消失") issues = []
    else if (scenario === "案件只读") issues = [{ ...issue, canEdit: false }]
    else issues = [{ ...issue, restricted: true, content: "", sources: [{ ...source, status: "UNAVAILABLE", documentName: null }] }]
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重读争点并保留输入" })) })
    await act(async () => { finishRead(preview) })
    if (scenario !== "案件只读") {
      expect(screen.queryByText(preview.text!)).toBeNull()
      expect(container.querySelector('[aria-label="案卷出处"]')).toBeNull()
      expect(pins.current.get("matter")).toEqual([])
    } else expect(container.querySelector("blockquote")?.textContent).toBe(preview.text)
    expect(screen.queryByRole("link", { name: "委托核对" })).toBeNull()
    expect(screen.getByText(/可复制下方已填写的内容/)).toBeTruthy()
    expect((screen.getByLabelText("采用值") as HTMLTextAreaElement).value).toBe("手工采用值")
    expect((screen.getByLabelText("采用理由") as HTMLTextAreaElement).value).toBe("手工理由")
    expect(screen.queryByRole("button", { name: "确认取舍并保存研究修订" })).toBeNull()
    expect(screen.queryByRole("combobox")).toBeNull()
    await act(async () => { fireEvent.click(document.querySelector('[data-slot="sheet-close"]')!) })
    expect(screen.getByText("放弃本次取舍？")).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "放弃修改" })) })
    expect(screen.queryByLabelText("采用理由")).toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
