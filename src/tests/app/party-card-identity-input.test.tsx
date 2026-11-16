import React, { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PartyCard } from "@/app/(app)/matters/_components/party-card";
import { partyInputSchema } from "@/server/matters/schemas";

vi.mock("@/server/yuandian/enterprise", () => ({ searchEnterpriseCandidates: vi.fn(), getEnterpriseDetail: vi.fn() }));

const schema = z.object({ parties: z.array(partyInputSchema) });
function Harness() {
  const methods = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { parties: [{ role: "CLIENT_PARTY", partyType: "NATURAL_PERSON", name: "合成自然人客户", idType: "ID_CARD", idNumber: "", ordinal: 1 }] }
  });
  const { fields } = useFieldArray({ control: methods.control, name: "parties" });
  const [accepted, setAccepted] = useState(false);
  return <FormProvider {...methods}>
    {fields.map((field, index) => <PartyCard key={field.id} index={index} fieldPrefix="parties" onRemove={vi.fn()} errors={methods.formState.errors as never} roleSlot="委托方" showStanding={false} removable={false} defaultExpanded={false} />)}
    <button type="button" onClick={async () => setAccepted(await methods.trigger("parties", { shouldFocus: true }))}>下一步</button>
    {accepted ? <p>身份校验通过</p> : null}
  </FormProvider>;
}

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView ??= vi.fn();
});
afterEach(cleanup);

async function selectOtherIdentity() {
  fireEvent.keyDown(screen.getByText("居民身份证").closest("button")!, { key: "ArrowDown" });
  const option = await screen.findByRole("option", { name: "其他证件" });
  fireEvent.keyDown(option, { key: "Enter" });
  await waitFor(() => expect(screen.getByText("其他证件").closest("button")).toHaveFocus());
}

describe("收案已有自然人客户的身份补全", () => {
  it("校验展开后可连续输入完整证件号，字段和焦点保持到合法值以后", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByText("自然人需填写证件号码（用于利益冲突检索）");
    await selectOtherIdentity();
    const input = screen.getByPlaceholderText("证件号码");
    act(() => input.focus());
    const value = "SYNTHETIC-UI-1116";
    for (let length = 1; length <= value.length; length++) {
      fireEvent.change(input, { target: { value: value.slice(0, length) } });
      await waitFor(() => expect(screen.getByPlaceholderText("证件号码")).toBe(input));
      expect(input).toHaveValue(value.slice(0, length));
      expect(input).toHaveFocus();
      if (length === 1) expect(await screen.findByText("证件号码应为 5–30 位字母、数字或连字符")).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "收起" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByText("身份校验通过")).toBeVisible();
    expect(screen.queryByText("证件号码应为 5–30 位字母、数字或连字符")).not.toBeInTheDocument();
  });

  it("手动展开后切换证件类型保持编辑，输入过滤与短号码拒绝仍生效", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "补全身份" }));
    await selectOtherIdentity();
    const input = screen.getByPlaceholderText("证件号码");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: " s y " } });
    expect(input).toHaveValue("SY");
    expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByText("证件号码应为 5–30 位字母、数字或连字符")).toBeVisible();
    expect(screen.queryByText("身份校验通过")).not.toBeInTheDocument();
  });
});
