// @vitest-environment jsdom
import { act, createElement, useState } from "react"
import { createRoot } from "react-dom/client"
import { fireEvent, screen, within } from "@testing-library/react/pure"
import { expect, it, vi } from "vitest"
import { ResearchRevision } from "./research-revision"

const read = vi.hoisted(() => vi.fn())
vi.mock("./personal-client", async importOriginal => ({
  ...await importOriginal<typeof import("./personal-client")>(), readPersonal: read,
}))

it("编辑时回查固定原文，失权和保存失败均保留输入，重试打开新修订", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  const content = {
    question: "付款争点", unresolved: "待补对方回函", rule: "", exceptions: "", supportingAnalysis: "",
    opposingAnalysis: "", conclusion: "旧结论", nextSteps: "", queryLog: [],
  }
  const payloads: Record<string, unknown>[] = []
  read.mockImplementation(async (url: string, init?: RequestInit) => {
    const payload = init?.body ? JSON.parse(String(init.body)) : null
    if (payload?.action === "open-research-source") {
      if (payload.sourceId === "opposing") return { status: "UNAVAILABLE" }
      return { status: "AVAILABLE", documentName: "确认函.docx", documentVersion: 1, locationLabel: "固定段落",
        text: "固定引文金额 50 万", downloadUrl: "/api/documents/file/download" }
    }
    if (payload?.action === "revise-research") {
      payloads.push(payload)
      if (payloads.length === 1) throw new Error("合成响应中断")
      return { id: "v2" }
    }
    const newer = new URL(url, "http://localhost").searchParams.get("record") === "v2"
    return { id: newer ? "v2" : "v1", version: newer ? 2 : 1, current: true, readable: true, canRevise: true,
      content: newer ? { ...content, conclusion: "核对后的结论" } : content,
      issue: { title: "付款", revision: 1, sources: [
        { id: "support", relation: "SUPPORTS", documentName: "确认函.docx", documentVersion: 1, locationLabel: "固定段落" },
        { id: "opposing", relation: "REBUTS", documentName: "回函.docx", documentVersion: 2, locationLabel: "第 2 页" },
      ] }, sources: [] }
  })
  function Harness() {
    const [id, setId] = useState("v1")
    return createElement(ResearchRevision, { key: id, matterId: "case", recordId: id, onClose: vi.fn(), onRevised: setId })
  }
  try {
    await act(async () => root.render(createElement(Harness)))
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "编辑成果" })) })
    const input = screen.getByRole("textbox", { name: "结论与成立条件" }) as HTMLTextAreaElement
    await act(async () => { fireEvent.change(input, { target: { value: "核对后的结论" } }) })
    const support = within(screen.getByRole("region", { name: "支持依据" })).getByRole("button")
    await act(async () => { fireEvent.click(support) })
    expect(await screen.findByText("固定引文金额 50 万")).toBeTruthy()
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "关闭原文" })) })
    expect(document.activeElement).toBe(support)
    await act(async () => { fireEvent.click(within(screen.getByRole("region", { name: "反向依据" })).getByRole("button")) })
    expect(await screen.findByText("此修订所引原件当前不可用。")).toBeTruthy()
    expect(screen.queryByText("固定引文金额 50 万")).toBeNull()
    expect(input.value).toBe("核对后的结论")
    const save = screen.getByRole("button", { name: "保存新修订" })
    await act(async () => { fireEvent.click(save) })
    expect(await screen.findByText("合成响应中断")).toBeTruthy()
    expect(input.value).toBe("核对后的结论")
    await act(async () => { fireEvent.click(save) })
    expect(await screen.findByText("第 2 版 · 待核对")).toBeTruthy()
    expect(within(screen.getByRole("article", { name: "研究成果" })).getByText("核对后的结论")).toBeTruthy()
    expect(payloads).toHaveLength(2)
    expect(payloads[0]).toEqual(payloads[1])
    expect(payloads[0]).toMatchObject({ matterId: "case", supersedesId: "v1", expectedVersion: 1,
      analysis: { conclusion: "核对后的结论", unresolved: "待补对方回函" } })
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})