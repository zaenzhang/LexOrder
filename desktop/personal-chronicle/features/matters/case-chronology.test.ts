// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { fireEvent, screen, within } from "@testing-library/react/pure"
import { expect, it, vi } from "vitest"
import { CaseChronology, type EvidenceNote } from "./case-chronology"

const read = vi.hoisted(() => vi.fn())
vi.mock("./personal-client", async original => ({
  ...await original<typeof import("./personal-client")>(), readPersonal: read,
}))

it("时间轴、矩阵和事实经过共享要点；矩阵打开固定版本，刷新失权后清除原文", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  const dated: EvidenceNote = { id: "payment", title: "付款", kind: "FACT", content: "已保存的案内付款记载", revision: 4,
    confirmedAt: "2026-11-19T08:00:00Z", restricted: false, canEdit: true,
    eventDate: { precision: "RANGE", start: "2026-05-01", end: "2026-05-03", text: "五月初" },
    sources: [
      { id: "receipt", documentId: "receipt-v1", documentName: "回单.pdf", documentVersion: 1, relation: "SUPPORTS",
        locationLabel: "第 1 页", status: "AVAILABLE", legacy: false },
      { id: "reply", documentId: "reply-v2", documentName: "回函.docx", documentVersion: 2, relation: "REBUTS",
        locationLabel: "第 2 段", status: "AVAILABLE", legacy: false },
    ] }
  const pending: EvidenceNote = { ...dated, id: "notice", title: "送达通知", kind: "CLAIM", content: "一方的陈述",
    eventDate: null, confirmedAt: null, sources: [] }
  read.mockResolvedValue({ status: "AVAILABLE", documentName: "回单.pdf", documentVersion: 1,
    locationLabel: "第 1 页", text: "50 万到账原文", previewUrl: null, downloadUrl: "/api/documents/receipt-v1/download" })
  const show = (items: EvidenceNote[]) => act(async () => root.render(createElement(CaseChronology, { matterId: "case", items, onEdit: vi.fn() })))
  const click = (name: string) => act(async () => { fireEvent.click(screen.getByRole("button", { name })) })
  try {
    await show([pending, dated])
    expect(screen.getByText("时间未明与受限要点")).toBeTruthy()
    expect(within(screen.getByRole("region", { name: "要点与出处" })).getByText("已保存的案内付款记载")).toBeTruthy()
    await click("对照矩阵")
    const matrix = screen.getByRole("table")
    expect(within(matrix).getByRole("columnheader", { name: "回函.docx · V2" })).toBeTruthy()
    await click("支持 · 第 1 页")
    expect(await screen.findByText("50 万到账原文")).toBeTruthy()
    expect(JSON.parse(read.mock.calls[0][1].body)).toEqual({ action: "open-evidence-source", matterId: "case", evidenceItemId: "payment", revision: 4, sourceId: "receipt" })
    await click("事实经过")
    expect(screen.getByText("一方的陈述")).toBeTruthy()
    expect(screen.getByText("50 万到账原文")).toBeTruthy()
    await show([pending, { ...dated, restricted: true, title: "来源不可用", content: "", sources: [], eventDate: null }])
    expect(screen.queryByText("50 万到账原文")).toBeNull()
    expect(screen.queryByText("已保存的案内付款记载")).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: "仅待核对" })) })
    expect(screen.queryByText("来源不可用")).toBeNull()
    expect(screen.getAllByText("一方的陈述").length).toBeGreaterThan(0)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})