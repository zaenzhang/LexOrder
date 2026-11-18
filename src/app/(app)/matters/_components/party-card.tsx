"use client";

import { Tag as SemiTag } from "@/components/patterns/semi-surfaces";
import { Button as SemiButton } from "@douyinfe/semi-ui";

/**
 * 收案当事人卡（墨案 05 效果图 entity-card）。
 * 折叠态：主体标识 + 名称 + 角色/地位徽章 + 证件摘要，「补全身份」展开编辑；
 * 新建或有校验错误的行默认展开。字段与联动沿用原收案表单：
 * 主体类型切换清空对侧证件、单位名称自动匹配元典企业并回填信用代码/法代/地址。
 * 校验落在 zod superRefine（partyInputSchema）；本组件只负责 UI + 字段联动。
 */
import { useId, useState, type ReactNode } from "react";
import { Controller, useController, useFormContext, type FieldErrors } from "react-hook-form";
import { IconClose as X } from "@douyinfe/semi-icons";
import type { PartyType } from "@prisma/client";
import { Input, Select } from "@douyinfe/semi-ui";
import { partyTypeLabel, PARTY_TYPE_OPTIONS } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { PERSON_ID_TYPES, clientIdTypeLabel, personIdError, sanitizePersonIdInput, type PersonIdType } from "@/lib/clients/person-id";
import { EnterpriseNameInput } from "@/components/matters/enterprise-name-input";
import { ChoiceField } from "@/components/patterns/choice-field";

type Props = {
  index: number;
  fieldPrefix: string; // e.g. "parties"
  onRemove: () => void;
  errors?: FieldErrors<Record<string, unknown>>;
  /** 角色徽章或角色选择 */
  roleSlot: ReactNode;
  /** 诉讼地位选择（showStanding 为 false 时忽略） */
  standingSlot?: ReactNode;
  standingLabel?: string | null;
  showStanding?: boolean;
  removable?: boolean;
  /** 提供时替换内置"姓名/名称"输入框（如委托方行注入客户选择器）。 */
  nameSlot?: ReactNode;
  /** 右上角额外标记（如「已关联」） */
  badge?: ReactNode;
  defaultExpanded?: boolean;
  logoTone?: "navy" | "teal" | "slate";
};

const LOGO_BG = { navy: "var(--bg-navy)", teal: "var(--semi-color-primary-active)", slate: "var(--semi-color-text-1)" } as const;

export function PartyCard({
  index,
  fieldPrefix,
  onRemove,
  errors,
  roleSlot,
  standingSlot,
  standingLabel,
  showStanding = true,
  removable = true,
  nameSlot,
  badge,
  defaultExpanded,
  logoTone = "navy"
}: Props) {
  const selectLabelId = useId();
  const { control, watch, setValue, trigger } = useFormContext();
  const p = `${fieldPrefix}.${index}`;
  // Field events keep useFieldArray row identities stable; setValue on a nested
  // array field can regenerate every row key and replace the focused input.
  const { field: { name: idNumberName, ref: idNumberRef, onBlur: blurIdNumber, onChange: changeIdNumber, value: storedIdNumber } } = useController({ control, name: `${p}.idNumber`, defaultValue: "" });
  const { field: idTypeField } = useController({ control, name: `${p}.idType`, defaultValue: "ID_CARD" });
  const { field: { name: nameKey, onChange: setName, onBlur: blurName, ref: registerName } } = useController({ control, name: `${p}.name`, defaultValue: "" });
  const partyType = (watch(`${p}.partyType`) as PartyType) ?? "NATURAL_PERSON";
  const isOrg = partyType !== "NATURAL_PERSON";
  const name = (watch(`${p}.name`) as string) ?? "";
  const idValue = ((isOrg ? watch(`${p}.enterpriseSocialCode`) : storedIdNumber) as string) ?? "";
  const idType = ((idTypeField.value as string) || "ID_CARD") as PersonIdType;
  // 即时校验（与服务端 zod 同一规则）：身份证只允许数字与末位 X、必须 18 位
  const liveIdError = !isOrg && idValue ? personIdError(idType, idValue) : null;
  const legalRep = (watch(`${p}.legalRep`) as string) ?? "";

  const fieldErr = (errors as Record<string, Record<number, Record<string, { message?: string }>>> | undefined)?.[fieldPrefix]?.[index] ?? {};
  const nameErr = fieldErr.name;
  const idErr = partyType === "NATURAL_PERSON" ? fieldErr.idNumber : fieldErr.enterpriseSocialCode;
  const standingErr = fieldErr.standing;
  const hasErr = Boolean(nameErr || idErr || standingErr);

  const [expanded, setExpanded] = useState(defaultExpanded ?? !name);
  const open = expanded || hasErr;

  function changeType(next: PartyType) {
    setValue(`${p}.partyType`, next, { shouldDirty: true, shouldValidate: true });
    if (next === "NATURAL_PERSON") {
      setValue(`${p}.enterpriseSocialCode`, "");
      setValue(`${p}.enterpriseName`, "");
      setValue(`${p}.legalRep`, "");
      if (!watch(`${p}.idType`)) setValue(`${p}.idType`, "ID_CARD");
    } else {
      setValue(`${p}.idNumber`, "");
      setValue(`${p}.idType`, "");
    }
  }

  const meta = [idValue ? `${isOrg ? "" : `${clientIdTypeLabel[idType]} `}${idValue}` : `${isOrg ? "统一社会信用代码" : "证件号码"} 待补充`, isOrg && legalRep ? `法定代表人 ${legalRep}` : null].filter(Boolean).join(" · ");

  return (
    <div className={cn("entity-card flex-col !items-stretch", hasErr && "!border-[var(--semi-color-danger-light-active)]")} style={{ marginBottom: 10 }}>
      <div className="flex items-center gap-[11px]">
        <div className="entity-logo" style={{ background: LOGO_BG[logoTone] }}>{name.trim().charAt(0) || "?"}</div>
        <div className="min-w-0 flex-1">
          <div className="entity-name flex flex-wrap items-center gap-1.5">
            <span className="truncate">{name || <span className="t-faint font-normal">待填写主体</span>}</span>
            {roleSlot}
            {showStanding && standingLabel ? <SemiTag size="small" color="grey">{standingLabel}</SemiTag> : null}
            {badge}
          </div>
          <div className={cn("entity-meta truncate", !idValue && "!font-sans")}>{meta}</div>
        </div>
        <SemiButton htmlType="button" theme="borderless" type="tertiary" onClick={() => setExpanded((v) => !v)} aria-expanded={open}>
          {open ? "收起" : idValue ? "编辑" : "补全身份"}
        </SemiButton>
        {removable ? (
          <SemiButton htmlType="button" theme="borderless" type="tertiary" className="!px-2" onClick={onRemove} aria-label="移除当事人">
            <X aria-hidden />
          </SemiButton>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 border-t border-[var(--semi-color-border)] pt-3" onFocusCapture={() => setExpanded(true)}>
          <div className="frow">
            <div className="fitem">
              <label className="flabel">主体类型</label>
              <ChoiceField ariaLabel="主体类型" options={PARTY_TYPE_OPTIONS.map((t) => ({ value: t, label: partyTypeLabel[t] }))} value={partyType} onChange={changeType} />
            </div>
            {showStanding && standingSlot ? (
              <div className="fitem">
                <label className="flabel">
                  诉讼地位<span className="star">*</span>
                </label>
                {standingSlot}
                {standingErr?.message ? <div className="mt-1 text-xs text-[var(--semi-color-danger)]">{standingErr.message}</div> : null}
              </div>
            ) : (
              <div className="fitem" />
            )}
          </div>
          <div className="frow">
            <div className="fitem">
              <label className="flabel" htmlFor={nameSlot ? undefined : selectLabelId + "-name"}>
                {isOrg ? "单位 / 组织名称" : "姓名"}
                <span className="star">*</span>
              </label>
              {nameSlot ??
                (isOrg ? (
                  <EnterpriseNameInput
                    id={selectLabelId + "-name"}
                    value={name}
                    onChange={setName}
                    onBlur={blurName}
                    inputRef={registerName}
                    name={nameKey}
                    invalid={Boolean(nameErr)}
                    onPick={item => {
                      setName(item.name);
                      setValue(p + ".enterpriseSocialCode", item.creditCode, { shouldDirty: true, shouldValidate: true });
                      setValue(p + ".enterpriseName", item.name, { shouldDirty: true });
                      if (item.legalRep) setValue(p + ".legalRep", item.legalRep, { shouldDirty: true });
                      if (item.address) setValue(p + ".address", item.address, { shouldDirty: true });
                    }}
                  />
                ) : (
                  <Input
                    id={selectLabelId + "-name"}
                    ref={registerName}
                    name={nameKey}
                    value={name}
                    onChange={setName}
                    onBlur={blurName}
                    validateStatus={nameErr ? "error" : "default"}
                    placeholder="姓名"
                  />
                ))}
              {nameErr?.message ? <div className="mt-1 text-xs text-[var(--semi-color-danger)]">{nameErr.message}</div> : null}
            </div>
            {!isOrg ? (
              <div className="fitem" style={{ maxWidth: 210 }}>
                <label id={selectLabelId + "-1"} className="flabel">证件类型</label>
                <Select
                  value={idType}
                  onChange={v => { if (typeof v !== "string") return;
                  idTypeField.onChange(v);
                  changeIdNumber(sanitizePersonIdInput(v, idValue));
                  if (idErr) void trigger(idNumberName);
                }}
                  aria-labelledby={selectLabelId + "-1"}
                  className="w-full"
                  motion={false}>{PERSON_ID_TYPES.map((t) => <Select.Option key={t} value={t}>{clientIdTypeLabel[t]}</Select.Option>)}</Select>
              </div>
            ) : null}
            <div className="fitem">
              <label htmlFor={selectLabelId + "-identity"} className="flabel">
                {isOrg ? "统一社会信用代码" : idType === "ID_CARD" ? "身份证号" : "证件号码"}
                <span className="star">*</span>
              </label>
              {isOrg ? (
                <Controller control={control} name={p + ".enterpriseSocialCode"} render={({ field }) => (
                  <Input id={selectLabelId + "-identity"} name={field.name} ref={field.ref}
                    value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur}
                    validateStatus={idErr ? "error" : "default"} placeholder="18 位信用代码" />
                )} />
              ) : (
                <Input
                  id={selectLabelId + "-identity"}
                  name={idNumberName}
                  ref={idNumberRef}
                  onBlur={blurIdNumber}
                  validateStatus={idErr ? "error" : liveIdError ? "warning" : "default"}
                  placeholder={idType === "ID_CARD" ? "18 位，仅数字或末位 X" : "证件号码"}
                  inputMode={idType === "ID_CARD" ? "text" : undefined}
                  maxLength={idType === "ID_CARD" ? 18 : 30}
                  value={idValue}
                  onChange={value => {
                    changeIdNumber(sanitizePersonIdInput(idType, value));
                    if (idErr) void trigger(idNumberName);
                  }}
                />
              )}
              {idErr?.message ? (
                <div className="mt-1 text-xs text-[var(--semi-color-danger)]">{idErr.message}</div>
              ) : liveIdError ? (
                <div className="mt-1 text-xs text-[var(--semi-color-warning)]">{liveIdError}</div>
              ) : !isOrg && idType === "ID_CARD" ? (
                <div className="mt-1 text-xs text-[var(--semi-color-text-3)]">只能输入数字或 X，共 18 位（{idValue.length}/18）</div>
              ) : null}
            </div>
          </div>
          <div className="frow">
            {isOrg ? (
              <div className="fitem">
                <label htmlFor={selectLabelId + "-legalRep"} className="flabel">法定代表人 / 负责人</label>
              <Controller control={control} name={p + ".legalRep"} render={({ field }) => (
                <Input id={selectLabelId + "-legalRep"} name={field.name} ref={field.ref}
                  value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur} />
              )} />
              </div>
            ) : null}
            <div className="fitem">
              <label htmlFor={selectLabelId + "-contactName"} className="flabel">联系人</label>
              <Controller control={control} name={p + ".contactName"} render={({ field }) => (
                <Input id={selectLabelId + "-contactName"} name={field.name} ref={field.ref}
                  value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur} />
              )} />
            </div>
            <div className="fitem">
              <label htmlFor={selectLabelId + "-phone"} className="flabel">联系电话</label>
              <Controller control={control} name={p + ".phone"} render={({ field }) => (
                <Input id={selectLabelId + "-phone"} name={field.name} ref={field.ref}
                  value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur} />
              )} />
            </div>
          </div>
          <div className="frow" style={{ marginBottom: 0 }}>
            <div className="fitem">
              <label htmlFor={selectLabelId + "-address"} className="flabel">{isOrg ? "注册地址" : "住址"}</label>
              <Controller control={control} name={p + ".address"} render={({ field }) => (
                <Input id={selectLabelId + "-address"} name={field.name} ref={field.ref}
                  value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur} />
              )} />
            </div>
            <div className="fitem">
              <label htmlFor={selectLabelId + "-notes"} className="flabel">备注</label>
              <Controller control={control} name={p + ".notes"} render={({ field }) => (
                <Input id={selectLabelId + "-notes"} name={field.name} ref={field.ref}
                  value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur} />
              )} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
