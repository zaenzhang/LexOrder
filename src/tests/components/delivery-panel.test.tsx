import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryPanel } from "@/components/deliveries/delivery-panel";
import type { DeliveryDetail, DeliveryOptions } from "@/server/deliveries/contracts";

const mocks = vi.hoisted(() => ({
  listDeliveryRecords: vi.fn(), getDeliveryOptions: vi.fn(), getDeliveryDetail: vi.fn(), prepareDelivery: vi.fn(),
  findDeliveryByRequest: vi.fn(), registerDeliveryEvent: vi.fn(), findDeliveryEventByRequest: vi.fn(), createClientBrief: vi.fn(), confirmDialog: vi.fn(),
}));
vi.mock("@/server/deliveries/actions", () => mocks);
vi.mock("@/components/patterns/confirm-dialog", () => ({ confirmDialog: mocks.confirmDialog }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const matterId = "cmatterdelivery000000000001", deliveryId = "cdelivery00000000000000001";
const oldId = "cdocdelivery00000000000001", newerId = "cdocdelivery00000000000002";
const options: DeliveryOptions = {
  canPrepare: true, canCreateBrief: true, clients: [],
  documents: [{ id: oldId, name: "合成分析稿", version: 1, status: "APPROVED", canDeliver: true, blockedReason: null },
    { id: newerId, name: "合成分析稿", version: 2, status: "DRAFT", canDeliver: false, blockedReason: "该成果版本须先完成文书审批" }],
};
const detail: DeliveryDetail = {
  id: deliveryId, matterId, recipientClientId: null, purpose: "合成阶段说明", recipientName: "合成客户", recipientContact: "synthetic@example.invalid",
  disclosureScope: "仅所列文书", unresolvedItems: "等待进一步指示", supersedesId: null,
  createdAt: "2026-01-01T00:00:00Z", createdByName: "合成律师", canWrite: true,
  items: [{ id: "citem000000000000000000001", documentId: oldId, position: 1, documentName: "合成分析稿", documentVersion: 1, newerVersionAvailable: true }], events: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listDeliveryRecords.mockResolvedValue({ items: [], nextCursor: null });
  mocks.getDeliveryOptions.mockResolvedValue(options);
  mocks.getDeliveryDetail.mockResolvedValue(detail);
  mocks.findDeliveryByRequest.mockResolvedValue(null);
  mocks.findDeliveryEventByRequest.mockResolvedValue(null);
  mocks.confirmDialog.mockResolvedValue(false);
});

async function enterPreparation() {
  fireEvent.click(await screen.findByRole("button", { name: "准备交付" }));
  fireEvent.change(screen.getByLabelText("交付目的"), { target: { value: "合成阶段说明" } });
  fireEvent.change(screen.getByLabelText("实际接收人"), { target: { value: "合成客户" } });
  fireEvent.change(screen.getByLabelText("实际联系方式或交接地点"), { target: { value: "synthetic@example.invalid" } });
  fireEvent.change(screen.getByLabelText("本次披露范围"), { target: { value: "仅所列文书" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 合成分析稿 第 1 版" }));
}

describe("交付面板", () => {
  it("保存失败保留草稿，关闭默认继续编辑，明确放弃才退出", async () => {
    mocks.prepareDelivery.mockRejectedValue(new Error("合成保存失败"));
    render(<DeliveryPanel matterId={matterId} />);
    await enterPreparation();
    fireEvent.click(screen.getByRole("button", { name: "核对并保存清单" }));
    expect(await screen.findByText("合成保存失败")).toBeInTheDocument();
    expect(screen.getByLabelText("交付目的")).toHaveValue("合成阶段说明");
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[0]);
    await waitFor(() => expect(mocks.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ initialFocus: "cancel", cancelText: "继续编辑" })));
    expect(screen.getByLabelText("实际接收人")).toHaveValue("合成客户");
    mocks.confirmDialog.mockResolvedValue(true);
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[0]);
    await waitFor(() => expect(screen.queryByLabelText("交付目的")).not.toBeInTheDocument());
  });

  it("选择具体旧版并保存，不能把未批准新版隐式替换进清单", async () => {
    mocks.prepareDelivery.mockResolvedValue({ id: deliveryId });
    const onLocationChange = vi.fn();
    render(<DeliveryPanel matterId={matterId} onLocationChange={onLocationChange} />);
    await enterPreparation();
    expect(screen.getByRole("checkbox", { name: "选择 合成分析稿 第 2 版" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "核对并保存清单" }));
    await waitFor(() => expect(mocks.prepareDelivery).toHaveBeenCalledWith(expect.objectContaining({ documentIds: [oldId], recipientName: "合成客户" })));
    expect(await screen.findByText("已有后续版本，本清单保留原版")).toBeInTheDocument();
    expect(onLocationChange).toHaveBeenCalledWith(deliveryId);
    expect(mocks.registerDeliveryEvent).not.toHaveBeenCalled();
  });

  it("丢响应后查询同次保存结果，回到原清单而非重复创建", async () => {
    mocks.prepareDelivery.mockRejectedValue(new Error("response lost"));
    mocks.findDeliveryByRequest.mockResolvedValue({ id: deliveryId });
    render(<DeliveryPanel matterId={matterId} />);
    await enterPreparation();
    fireEvent.click(screen.getByRole("button", { name: "核对并保存清单" }));
    expect(await screen.findByText("已有后续版本，本清单保留原版")).toBeInTheDocument();
    expect(mocks.prepareDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.findDeliveryByRequest).toHaveBeenCalledWith(mocks.prepareDelivery.mock.calls[0][0]);
  });

  it("加载失权对象只显示错误，不打开其他清单", async () => {
    mocks.getDeliveryDetail.mockRejectedValue(new Error("该版本已撤回或无权读取"));
    render(<DeliveryPanel matterId={matterId} initialDeliveryId={deliveryId} />);
    expect(await screen.findByText("该版本已撤回或无权读取")).toBeInTheDocument();
    expect(screen.queryByText("synthetic@example.invalid")).not.toBeInTheDocument();
    expect(mocks.getDeliveryDetail).toHaveBeenCalledWith(deliveryId);
    expect(mocks.prepareDelivery).not.toHaveBeenCalled();
  });

  it("实际发送登记必须人工填写，不由打开或下载触发", async () => {
    mocks.registerDeliveryEvent.mockRejectedValue(new Error("合成登记失败"));
    render(<DeliveryPanel matterId={matterId} initialDeliveryId={deliveryId} />);
    fireEvent.click(await screen.findByRole("button", { name: "登记已发送" }));
    expect(screen.getByRole("button", { name: "保存登记" })).toBeDisabled();
    expect(screen.getByText("未附凭据，仅人工登记")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("渠道"), { target: { value: "邮件" } });
    fireEvent.change(screen.getByLabelText("实际发生情况"), { target: { value: "合成人工登记，未执行任何外发" } });
    fireEvent.click(screen.getByRole("button", { name: "保存登记" }));
    expect(await screen.findByText("合成登记失败")).toBeInTheDocument();
    expect(screen.getByLabelText("实际发生情况")).toHaveValue("合成人工登记，未执行任何外发");
    expect(mocks.registerDeliveryEvent).toHaveBeenCalledWith(expect.objectContaining({ deliveryId, kind: "SENT", proofDocumentId: null, channel: "邮件" }));
  });

  it("手工简报保存为具体草稿后交还文书入口", async () => {
    mocks.createClientBrief.mockResolvedValue({ id: newerId, version: 1 });
    const openDocument = vi.fn();
    render(<DeliveryPanel matterId={matterId} onDocumentOpen={openDocument} />);
    fireEvent.click(await screen.findByRole("button", { name: "准备简报" }));
    fireEvent.change(screen.getByLabelText("简报标题"), { target: { value: "合成简报" } });
    fireEvent.change(screen.getByLabelText("简报正文"), { target: { value: "仍待核实，客户尚未决定" } });
    fireEvent.click(screen.getByRole("button", { name: "保存为文书草稿" }));
    await waitFor(() => expect(openDocument).toHaveBeenCalledWith(newerId));
    expect(mocks.createClientBrief).toHaveBeenCalledWith(expect.objectContaining({ matterId, title: "合成简报", content: "仍待核实，客户尚未决定" }));
    expect(mocks.prepareDelivery).not.toHaveBeenCalled();
    expect(mocks.registerDeliveryEvent).not.toHaveBeenCalled();
  });

  it("凭据失权明确显示受限，不冒充原本没有凭据的登记", async () => {
    mocks.getDeliveryDetail.mockResolvedValue({ ...detail, events: [{ id: "cevent0000000000000000001", kind: "SENT",
      occurredAt: "2026-01-01T00:00:00Z", recordedAt: "2026-01-01T00:00:00Z", actorName: "合成律师", channel: "邮件",
      note: null, proofUnavailable: true, proofDocumentId: null, proofName: null, correctsEventId: null }] } satisfies DeliveryDetail);
    render(<DeliveryPanel matterId={matterId} initialDeliveryId={deliveryId} />);
    expect(await screen.findByText("凭据当前不可读取，登记正文暂不显示。")).toBeInTheDocument();
    expect(screen.queryByText("仅人工登记，未附凭据")).not.toBeInTheDocument();
  });

  it("保留挂载时同一材料关闭后可重新准备，来源参数清空不清除当前草稿", async () => {
    const { rerender } = render(<DeliveryPanel matterId={matterId} initialDocumentId={oldId} />);
    const purpose = await screen.findByLabelText("交付目的");
    fireEvent.change(purpose, { target: { value: "尚未保存的目的" } });
    rerender(<DeliveryPanel matterId={matterId} initialDocumentId={null} />);
    expect(screen.getByLabelText("交付目的")).toHaveValue("尚未保存的目的");
    rerender(<DeliveryPanel matterId={matterId} initialDocumentId={oldId} />);
    expect(screen.getByLabelText("交付目的")).toHaveValue("尚未保存的目的");
    mocks.confirmDialog.mockResolvedValue(true);
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    rerender(<DeliveryPanel matterId={matterId} initialDocumentId={null} />);
    rerender(<DeliveryPanel matterId={matterId} initialDocumentId={oldId} />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("交付目的")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "选择 合成分析稿 第 1 版" })).toBeChecked();
  });

  it("其他案件的可读清单不能在当前案件正文和操作区显示", async () => {
    mocks.getDeliveryDetail.mockResolvedValue({ ...detail, matterId: "cmatterdelivery000000000002" } satisfies DeliveryDetail);
    render(<DeliveryPanel matterId={matterId} initialDeliveryId={deliveryId} />);
    expect(await screen.findByText("该交付清单不属于当前案件，请返回原案件打开")).toBeInTheDocument();
    expect(screen.queryByText(detail.recipientContact)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记已发送" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出固定材料" })).not.toBeInTheDocument();
    expect(mocks.registerDeliveryEvent).not.toHaveBeenCalled();
  });

  it("主壳明确确认的准备信号可替换草稿，普通地址变化不能替换", async () => {
    const { rerender } = render(<DeliveryPanel matterId={matterId} initialDocumentId={oldId} prepareSignal={0} />);
    fireEvent.change(await screen.findByLabelText("交付目的"), { target: { value: "尚未放弃的目的" } });
    rerender(<DeliveryPanel matterId={matterId} initialDocumentId={newerId} prepareSignal={0} />);
    expect(screen.getByLabelText("交付目的")).toHaveValue("尚未放弃的目的");
    expect(screen.getByRole("checkbox", { name: "选择 合成分析稿 第 1 版" })).toBeChecked();
    rerender(<DeliveryPanel matterId={matterId} initialDocumentId={newerId} prepareSignal={1} />);
    expect(screen.getByLabelText("交付目的")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "选择 合成分析稿 第 2 版" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 合成分析稿 第 1 版" })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("交付目的"), { target: { value: "第二次草稿" } });
    rerender(<DeliveryPanel matterId={matterId} initialDocumentId={newerId} prepareSignal={1} />);
    expect(screen.getByLabelText("交付目的")).toHaveValue("第二次草稿");
    rerender(<DeliveryPanel matterId={matterId} initialDocumentId={newerId} prepareSignal={2} />);
    expect(screen.getByLabelText("交付目的")).toHaveValue("");
  });
});
