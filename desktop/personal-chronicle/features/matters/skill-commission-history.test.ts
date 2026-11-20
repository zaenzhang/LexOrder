import { renderWithRouter } from "@/scripts/render-test"
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { fireEvent, screen } from "@testing-library/react/pure"
import { expect, it, vi } from "vitest"
import { SkillCommissionDesk } from "./skill-commission-desk"

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock("@/kit/framework", async importOriginal => ({ ...(await importOriginal<typeof import("@/kit/framework")>()), useRouter: () => ({ push: vi.fn() }) }))
vi.mock("./personal-client", async original => ({
  ...await original<typeof import("./personal-client")>(), readPersonal: read,
}))

it("reopens saved lawyer decisions and loads just the selected immutable excerpt", async () => {
  const run = {
    id: "saved", createdAt: "2026-11-20T08:00:00Z", exportedAt: null, submittedAt: "2026-11-20T09:00:00Z",
    adoptedResearchId: "research-v2", aiState: "SUCCEEDED", issueRevision: 3, researchVersion: 1, baselineCurrent: false,
  }
  const text = "清单载有设备签收 12 台。本次仅核对数量及外观。"
  const quote = "签收 12 台"
  const start = text.indexOf(quote)
  read.mockImplementation(async (url: string) => {
    const query = new URLSearchParams(url.split("?")[1])
    if (query.get("issue") === "issue" && query.get("before") === "older") return { items: [], nextCursor: null }
    if (query.get("issue") === "issue") return { items: [run], nextCursor: "older" }
    if (query.get("record") !== run.id) throw new Error("Unexpected record")
    if (query.get("fragment") === "1") return { text }
    return {
      ...run, issue: "签收能否证明验收", canWrite: true, method: { version: "1.0" }, grants: [], aiProvider: null,
      fragments: [{ index: 1, name: "固定清单", version: 1, documentId: "document-v1", location: "第 1 页" }],
      aiExecution: { state: "SUCCEEDED", model: "fixture", usage: { inputTokens: 340, outputTokens: 76 } },
      result: { host: "INTERNAL_AI", candidates: [{ kind: "QUANTITY", assessment: "SUPPORTED", finding: "模型发现",
        citations: [{ fragment: 1, start, end: start + quote.length, quote, relation: "SUPPORTS" }] }] },
      decisions: [{ candidate: 0, disposition: "PARTIAL", value: "律师确认 12 台", reason: "限现场签收" }],
      continuation: { researchId: "research-v2", issueSupplements: [], items: [{ kind: "QUANTITY", commissionId: run.id, newerMaterials: [{
        previous: { id: "document-v1", name: "固定清单", version: 1 }, latest: { id: "document-v2", name: "新版清单", version: 2 },
      }] }] },
    }
  })
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  try {
    await act(async () => renderWithRouter(root, createElement(SkillCommissionDesk, {
      matterId: "matter", scope: { kind: "issue", id: "issue" }, close: vi.fn(),
    })))
    expect(screen.getByText(/争点 V3 · 研究 V1/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "下一页" })) })
    expect(screen.getByText("当前没有可读取的委托记录。")).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "上一页" })) })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "打开委托" })) })
    expect(screen.getByText(/律师确认 12 台/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "复核签收数量" }).getAttribute("href"))
      .toBe("/matters/matter/materials?research=research-v2&priorCommission=saved&focus=QUANTITY")
    expect(screen.getByText("固定清单 · V1 → 新版清单 · V2")).toBeTruthy()
    expect(screen.getByRole("link", { name: "选此新版复核" }).getAttribute("href"))
      .toBe("/matters/matter/materials?research=research-v2&priorCommission=saved&focus=QUANTITY&suggestedMaterial=document-v2")
    expect(screen.getByText(/输入 340 Token · 输出 76 Token/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "生成待核稿" })).toBeNull()
    expect(screen.queryByText(text)).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "查看固定片段" })) })
    expect(document.querySelector("mark")?.textContent).toBe(quote)
    expect(document.querySelector("mark")?.parentElement?.textContent).toBe(text)
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "收起片段" })) })
    expect(document.querySelector("mark")).toBeNull()
    expect(read.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it("asks for confirmation of added issue sources and retries the same acceptance without submitting an AI run", async () => {
  read.mockReset()
  const material = { id: "a118", name: "A-118 独立补件", version: 1 }
  const issue = { kind: "CURRENT", issueId: "issue", revision: 2, confirmedAt: null }
  const pendingIssueUpdate = { researchId: "r2", expectedVersion: 2, issue, materials: [material] }
  const acceptedRequests: unknown[] = []
  read.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      acceptedRequests.push(JSON.parse(String(init.body)))
      if (acceptedRequests.length === 1) throw new Error("暂时无法保存")
      return { id: "r3" }
    }
    return {
      id: "saved", createdAt: "2026-11-20T08:00:00Z", submittedAt: "2026-11-20T09:00:00Z",
      adoptedResearchId: "r2", issue: "设备验收", canWrite: true, method: { version: "1.0" }, grants: [], fragments: [],
      pendingIssueUpdate: acceptedRequests.length < 2 ? pendingIssueUpdate : null,
      continuation: acceptedRequests.length < 2 ? null : { researchId: "r3", issueSupplements: [{ ...material, eligibleKinds: ["PERFORMANCE"] }],
        items: [{ kind: "PERFORMANCE", commissionId: "saved", newerMaterials: [] }] },
    }
  })
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  try {
    await act(async () => renderWithRouter(root, createElement(SkillCommissionDesk, {
      matterId: "matter", scope: { kind: "issue", id: "issue" }, close: vi.fn(), initialId: "saved",
    })))
    expect(screen.getByText("A-118 独立补件 · V1")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "选入性能验收复核" })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "纳入新增出处" })) })
    expect(screen.getByRole("alert").textContent).toContain("暂时无法保存")
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "纳入新增出处" })) })
    expect(acceptedRequests).toHaveLength(2)
    expect(acceptedRequests[1]).toEqual(acceptedRequests[0])
    expect(acceptedRequests[0]).toMatchObject({ action: "accept-issue-supplements", matterId: "matter",
      researchId: "r2", expectedVersion: 2, issue })
    expect(screen.getByRole("link", { name: "选入性能验收复核" }).getAttribute("href"))
      .toBe("/matters/matter/materials?research=r3&priorCommission=saved&focus=PERFORMANCE&suggestedMaterial=a118")
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
