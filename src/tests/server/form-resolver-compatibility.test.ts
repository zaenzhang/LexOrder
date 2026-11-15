// @vitest-environment node
import { describe, expect, it } from "vitest";
import { zodResolver } from "@hookform/resolvers/zod";
import { feeEntryCreateSchema } from "@/server/finance/schemas";
import { procedureCreateSchema, procedureUpdateSchema } from "@/server/procedures/schemas";

const id = "ckx1a2b3c4d5e6f7g8h9j0k1";
const options = { fields: {}, shouldUseNativeValidation: false };

describe("业务表单校验器兼容性", () => {
  it("金额与日期字符串在提交时转换为业务类型", async () => {
    const result = await zodResolver(feeEntryCreateSchema)(
      { matterId: id, type: "RECEIVED", amount: "125.50", occurredAt: "2026-11-15" },
      undefined, options
    );
    expect(result.errors).toEqual({});
    expect(result.values).toMatchObject({ amount: 125.5, occurredAt: new Date("2026-11-15") });
  });

  it("无效日期作为字段错误返回，保留中文提示而非抛出 resolver 异常", async () => {
    const result = await zodResolver(feeEntryCreateSchema)(
      { matterId: id, type: "RECEIVED", amount: "125.50", occurredAt: "" },
      undefined, options
    );
    expect(result.errors.occurredAt?.message).toBe("请选择收付日期");
  });

  it("受理日期经过表单解析后仍可由服务端复核，未提交的日期保持缺省", async () => {
    const result = await zodResolver(procedureCreateSchema)(
      { matterId: id, type: "FIRST_INSTANCE", acceptedAt: "2026-11-15" },
      undefined, options
    );
    expect(result.errors).toEqual({});
    expect(procedureCreateSchema.parse(result.values).acceptedAt).toEqual(new Date("2026-11-15"));
    expect(procedureUpdateSchema.parse({ id, caseNumber: "更新案号" })).not.toHaveProperty("acceptedAt");
  });
});
