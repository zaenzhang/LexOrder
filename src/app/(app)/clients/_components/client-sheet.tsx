"use client";

import { Button, Checkbox, Input, Select, Tag, TextArea } from "@douyinfe/semi-ui";

import type { z } from "zod";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Controller, useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, X, Loader2, Trash2, Star, Sparkles, Search } from "lucide-react";
import type { Client, Contact } from "@prisma/client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter
} from "@/components/ui/sheet";
import { PERSON_ID_TYPES, clientIdTypeLabel, personIdError, sanitizePersonIdInput } from "@/lib/clients/person-id";
import { clientCreateSchema, type ClientCreateInput } from "@/server/clients/schemas";
import { createClient, updateClient } from "@/server/clients/actions";
import {
  cooperationStatusLabel,
  COOPERATION_STATUS_OPTIONS,
  genderLabel,
  GENDER_OPTIONS
} from "@/lib/enums";
import {
  searchEnterpriseCandidates,
  getEnterpriseDetail,
  type EnterpriseSearchItem
} from "@/server/yuandian/enterprise";
import { cn } from "@/lib/utils";
import { readFormPath } from "@/lib/form-path";
import { actionErrorMessage } from "@/lib/action-error";
import { confirmDialog } from "@/components/patterns/confirm-dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturnFocus: () => void;
  editingClient: (Client & { contacts?: Contact[] }) | null;
};

const emptyDefaults: ClientCreateInput = {
  name: "",
  type: "INDIVIDUAL",
  idType: "ID_CARD",
  idNumber: "",
  address: "",
  legalRep: "",
  phone: "",
  email: "",
  source: "",
  cooperationStatus: "SIGNED",
  industry: "",
  gender: "",
  ethnicity: "",
  tags: [],
  notes: "",
  contacts: [{ name: "", title: "", phone: "", email: "", wechat: "", isPrimary: true, notes: "" }]
};

export function ClientSheet({ open, onOpenChange, onReturnFocus, editingClient }: Props) {
  const [isPending, startTransition] = useTransition();
  const formId = useId();
  const editorContent = useRef<HTMLDivElement>(null);
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  const tagInput = useRef<HTMLInputElement>(null);
  const closePending = useRef(false);
  const isEdit = !!editingClient;

  const {
    control,
    handleSubmit,
    getValues,
    setValue,
    reset,
    formState: { errors, isDirty }
  } = useForm<z.input<typeof clientCreateSchema>, unknown, ClientCreateInput>({
    resolver: zodResolver(clientCreateSchema),
    defaultValues: emptyDefaults
  });

  const { fields, append, remove } = useFieldArray({ control, name: "contacts" });
  const watchedValues = useWatch({ control });
  const watch = <T = any,>(path: string) => readFormPath<T>(watchedValues, path);
  const watchedType = watch<ClientCreateInput["type"]>("type");
  const personIdType = watch<ClientCreateInput["idType"]>("idType") || "ID_CARD";
  const watchedIdNumber = watch<string | undefined>("idNumber") ?? "";
  const watchedTags = watch<string[]>("tags");

  // 当 editing 切换时重置表单
  useEffect(() => {
    if (!open) { setOpenSelect(null); return; }
    if (editingClient) {
      reset({
        name: editingClient.name,
        type: editingClient.type,
        idType: (editingClient as any).idType ?? (editingClient.type === "INDIVIDUAL" ? "ID_CARD" : "USCC"),
        // 列表/详情在服务端完成授权和解密，浏览器不能引用服务端密钥模块。
        idNumber: editingClient.idNumber ?? "",
        address: editingClient.address ?? "",
        legalRep: (editingClient as any).legalRep ?? "",
        phone: editingClient.phone ?? "",
        email: editingClient.email ?? "",
        source: editingClient.source ?? "",
        cooperationStatus: (editingClient as any).cooperationStatus ?? "SIGNED",
        industry: (editingClient as any).industry ?? "",
        gender: (editingClient as any).gender ?? "",
        ethnicity: (editingClient as any).ethnicity ?? "",
        tags: editingClient.tags,
        notes: editingClient.notes ?? "",
        contacts:
          editingClient.contacts && editingClient.contacts.length > 0
            ? editingClient.contacts.map((c) => ({
                name: c.name,
                title: c.title ?? "",
                phone: c.phone ?? "",
                email: c.email ?? "",
                wechat: c.wechat ?? "",
                isPrimary: c.isPrimary,
                notes: c.notes ?? ""
              }))
            : emptyDefaults.contacts
      });
    } else {
      reset(emptyDefaults);
    }
  }, [editingClient, open, reset]);

  async function requestClose() {
    if (isPending || closePending.current) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closePending.current = true;
    try {
      if ((isDirty || tagInput.current?.value) && !await confirmDialog({
        title: "放弃未保存的客户资料？",
        confirmText: "放弃更改",
        cancelText: "继续编辑",
        initialFocus: "cancel"
      })) {
        requestAnimationFrame(() => {
          const target = returnFocus?.isConnected ? returnFocus : editorContent.current;
          target?.focus({ preventScroll: true });
        });
        return;
      }
      onOpenChange(false);
    } finally {
      closePending.current = false;
    }
  }

  function onSubmit(values: ClientCreateInput) {
    startTransition(async () => {
      try {
        if (isEdit && editingClient) {
          await updateClient({ id: editingClient.id, ...values });
          toast.success("客户已更新");
        } else {
          await createClient(values);
          toast.success("客户已创建");
        }
        onOpenChange(false);
      } catch (err) {
        toast.error("保存失败", {
          description: err instanceof Error ? actionErrorMessage(err) : "请稍后重试"
        });
      }
    });
  }

  function addTag(tag: string) {
    const t = tag.trim();
    if (!t) return;
    const current = watchedTags || [];
    if (current.includes(t)) return;
    setValue("tags", [...current, t], { shouldDirty: true });
  }

  function removeTag(tag: string) {
    setValue("tags", (watchedTags || []).filter((t) => t !== tag), { shouldDirty: true });
  }

  // v0.27: AI 自动填信用代码（公司 / 组织路径）
  const [candidates, setCandidates] = useState<EnterpriseSearchItem[] | null>(null);
  const [aiSearching, startAiSearch] = useTransition();
  const [aiFilling, startAiFill] = useTransition();

  function handleAILookup() {
    const name = (getValues("name") || "").trim();
    if (!name) {
      toast.warning("请先填写客户名称再点击 AI 查找");
      return;
    }
    startAiSearch(async () => {
      try {
        const r = await searchEnterpriseCandidates(name);
        if (!r.configured) {
          toast.error("元典 API 未配置", {
            description: "请在 管理后台 → AI 与外部服务 中配置 API Key"
          });
          return;
        }
        if (r.items.length === 0) {
          toast.info("未找到候选企业", { description: "试试更完整的名称或简称" });
          return;
        }
        setCandidates(r.items);
      } catch (err) {
        toast.error("查找失败", {
          description: actionErrorMessage(err)
        });
      }
    });
  }

  function handlePickCandidate(item: EnterpriseSearchItem) {
    startAiFill(async () => {
      setValue("idNumber", item.creditCode, { shouldDirty: true, shouldValidate: true });
      setValue("name", item.name, { shouldDirty: true });
      setCandidates(null);
      try {
        const r = await getEnterpriseDetail(item.id);
        if (r.configured && r.info) {
          if (r.info.legalRep) setValue("legalRep", r.info.legalRep, { shouldDirty: true });
          if (r.info.address) setValue("address", r.info.address, { shouldDirty: true });
          toast.success(`已回填：${item.name}`);
        }
      } catch (err) {
        toast.warning("法代 / 地址自动填充失败，可手动补充", {
          description: actionErrorMessage(err)
        });
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={(value) => { if (!value) void requestClose(); }}>
      <SheetContent
        ref={editorContent}
        onEscapeKeyDown={event => { if (openSelect) event.preventDefault(); }}
        side="right"
        className="flex w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <SheetHeader className="border-b border-border bg-background px-6 py-4">
          <SheetTitle className="text-lg">
            {isEdit ? "编辑客户" : "新建客户"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            客户主体信息 + 联系人，联系方式细节走联系人单独维护
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <fieldset disabled={isPending} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5">
            {/* 基本信息 */}
            <Section title="基本信息">
              <Field id={`${formId}-name`} label="客户名称" required error={errors.name?.message}>
                <Controller name={"name"} control={control} render={({ field: inputField }) => (<Input
                  id={`${formId}-name`}
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? `${formId}-name-error` : undefined}
                  placeholder={
                    watchedType === "INDIVIDUAL" ? "张三" : "上海某某有限公司"
                  }
                  {...inputField} value={inputField.value ?? ""}
                />)} />
              </Field>

              <Field id={`${formId}-type`} label="类型" required>
                <Select className="w-full" disabled={isPending} motion={false} getPopupContainer={() => editorContent.current!} id={`${formId}-type`} aria-labelledby={`${formId}-type` + "-label"} onDropdownVisibleChange={visible => setOpenSelect(previous => visible ? `${formId}-type` : previous === `${formId}-type` ? null : previous)}
                  value={watchedType}
                  onChange={(v) => {
                    setValue("type", v as ClientCreateInput["type"], { shouldDirty: true });
                    // 证件类型随主体类型联动默认值（可手动改选护照/其他）
                    // 自然人不能使用信用代码，单位不能使用个人证件：跨类切换时重置
                    const nextType = v === "INDIVIDUAL" ? "ID_CARD" : "USCC";
                    const current = watch<ClientCreateInput["idType"]>("idType");
                    const currentIsPerson = !!current && current !== "USCC" && current !== "OTHER";
                    if (!current || (v === "INDIVIDUAL" ? current === "USCC" : currentIsPerson)) {
                      setValue("idType", nextType, { shouldDirty: true });
                    }
                  }}
                >

                    <Select.Option value="INDIVIDUAL">自然人</Select.Option>
                    <Select.Option value="COMPANY">公司</Select.Option>
                    <Select.Option value="ORGANIZATION">其他组织</Select.Option>

                </Select>
              </Field>

              <Field id={`${formId}-idType`} label="证件类型" required>
                <Select className="w-full" disabled={isPending} motion={false} getPopupContainer={() => editorContent.current!} id={`${formId}-idType`} aria-labelledby={`${formId}-idType` + "-label"} onDropdownVisibleChange={visible => setOpenSelect(previous => visible ? `${formId}-idType` : previous === `${formId}-idType` ? null : previous)}
                  value={watch<ClientCreateInput["idType"]>("idType") || (watchedType === "INDIVIDUAL" ? "ID_CARD" : "USCC")}
                  onChange={(v) => {
                    setValue("idType", v as NonNullable<ClientCreateInput["idType"]>, { shouldDirty: true });
                    if (watchedType === "INDIVIDUAL") setValue("idNumber", sanitizePersonIdInput(v as string, watch("idNumber") ?? ""), { shouldDirty: true });
                  }}
                >

                    {(watchedType === "INDIVIDUAL"
                      ? PERSON_ID_TYPES.map((t) => [t, clientIdTypeLabel[t]])
                      : [["USCC", "统一社会信用代码"], ["OTHER", "其他编号"]]
                    ).map(([v, label]) => (
                      <Select.Option key={v} value={v}>{label}</Select.Option>
                    ))}

                </Select>
              </Field>

              <Field
                id={`${formId}-idNumber`}
                label={watchedType === "INDIVIDUAL" ? "证件号码" : "统一社会信用代码"}
                error={errors.idNumber?.message}
              >
                {watchedType === "INDIVIDUAL" ? (
                  <div className="space-y-1">
                    <Input
                      id={`${formId}-idNumber`}
                      aria-invalid={!!errors.idNumber}
                      aria-describedby={errors.idNumber ? `${formId}-idNumber-error` : undefined}
                      className="font-mono"
                      inputMode={personIdType === "ID_CARD" ? "numeric" : undefined}
                      placeholder={personIdType === "ID_CARD" ? "18 位，仅数字或 X" : "证件号码"}
                      value={watchedIdNumber}
                      onChange={value => setValue("idNumber", sanitizePersonIdInput(personIdType, value), { shouldDirty: true, shouldValidate: !!errors.idNumber })}
                    />
                    {watchedIdNumber && personIdError(personIdType, watchedIdNumber) ? (
                      <p className="text-[11px] text-[var(--amber,#b7791f)]">{personIdError(personIdType, watchedIdNumber)}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      <Controller name={"idNumber"} control={control} render={({ field: inputField }) => (<Input
                        id={`${formId}-idNumber`}
                        aria-invalid={!!errors.idNumber}
                        aria-describedby={errors.idNumber ? `${formId}-idNumber-error` : undefined}
                        className="flex-1 font-mono"
                        placeholder="18 位信用代码"
                        {...inputField} value={inputField.value ?? ""}
                      />)} />
                      <Button
                        htmlType="button"
                        theme="outline"
                        size="small"
                        onClick={handleAILookup}
                        disabled={aiSearching || aiFilling}
                        className="h-9 shrink-0 gap-1"
                        title="按客户名称在元典搜索，自动回填信用代码 / 法代 / 注册地址"
                      >
                        {aiSearching ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        AI 查找
                      </Button>
                    </div>
                    {candidates && candidates.length > 0 && (
                      <div className="rounded-md border border-border bg-muted/30 p-1.5">
                        <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Search className="h-3 w-3" />共 {candidates.length} 条候选，点击回填
                        </div>
                        <ul className="space-y-1">
                          {candidates.map((c) => (
                            <li key={c.id}>
                              <Button theme="borderless" size="small" block
                                htmlType="button"
                                onClick={() => handlePickCandidate(c)}
                                disabled={aiFilling}
                                style={{ height: "auto", paddingBlock: 6 }}
                                contentClassName="flex-col items-start whitespace-normal text-left text-xs"
                              >
                                <div className="font-medium">{c.name}</div>
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {c.creditCode}
                                </div>
                              </Button>
                            </li>
                          ))}
                        </ul>
                        <Button theme="borderless" size="small"
                          htmlType="button"
                          onClick={() => setCandidates(null)}
                          className="mt-1 w-full text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          关闭
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Field>

              <Field id={`${formId}-phone`} label="主要联系电话">
                <Controller name={"phone"} control={control} render={({ field: inputField }) => (<Input id={`${formId}-phone`} className="font-mono" placeholder="11 位手机号" {...inputField} value={inputField.value ?? ""} />)} />
              </Field>

              <Field id={`${formId}-email`} label="邮箱" error={errors.email?.message}>
                <Controller name={"email"} control={control} render={({ field: inputField }) => (<Input id={`${formId}-email`} aria-invalid={!!errors.email} aria-describedby={errors.email ? `${formId}-email-error` : undefined} type="email" placeholder="contact@example.com" {...inputField} value={inputField.value ?? ""} />)} />
              </Field>

              <Field id={`${formId}-address`} label="地址">
                <Controller name={"address"} control={control} render={({ field: inputField }) => (<Input id={`${formId}-address`} placeholder="详细地址" {...inputField} value={inputField.value ?? ""} />)} />
              </Field>

              {watchedType !== "INDIVIDUAL" && (
                <Field id={`${formId}-legalRep`} label="法定代表人">
                  <Controller name={"legalRep"} control={control} render={({ field: inputField }) => (<Input id={`${formId}-legalRep`} placeholder="法定代表人姓名" {...inputField} value={inputField.value ?? ""} />)} />
                </Field>
              )}

              <Field id={`${formId}-source`} label="案源">
                <Controller name={"source"} control={control} render={({ field: inputField }) => (<Input id={`${formId}-source`} placeholder="介绍人 / 公开来源 / 老客户复购" {...inputField} value={inputField.value ?? ""} />)} />
              </Field>

              <Field id={`${formId}-cooperationStatus`} label="合作状态">
                <Select className="w-full" disabled={isPending} motion={false} getPopupContainer={() => editorContent.current!} id={`${formId}-cooperationStatus`} aria-labelledby={`${formId}-cooperationStatus` + "-label"} onDropdownVisibleChange={visible => setOpenSelect(previous => visible ? `${formId}-cooperationStatus` : previous === `${formId}-cooperationStatus` ? null : previous)}
                  value={watch("cooperationStatus")}
                  onChange={(v) =>
                    setValue("cooperationStatus", v as ClientCreateInput["cooperationStatus"], {
                      shouldDirty: true
                    })
                  }
                >

                    {COOPERATION_STATUS_OPTIONS.map((s) => (
                      <Select.Option key={s} value={s}>
                        {cooperationStatusLabel[s]}
                      </Select.Option>
                    ))}

                </Select>
              </Field>

              <Field id={`${formId}-industry`} label="所属行业">
                <Controller name={"industry"} control={control} render={({ field: inputField }) => (<Input id={`${formId}-industry`} placeholder="如 制造业 / 互联网 / 房地产" {...inputField} value={inputField.value ?? ""} />)} />
              </Field>

              {watchedType === "INDIVIDUAL" && (
                <>
                  <Field id={`${formId}-gender`} label="性别">
                    <Select className="w-full" disabled={isPending} motion={false} getPopupContainer={() => editorContent.current!} id={`${formId}-gender`} aria-labelledby={`${formId}-gender` + "-label"} placeholder="未填" onDropdownVisibleChange={visible => setOpenSelect(previous => visible ? `${formId}-gender` : previous === `${formId}-gender` ? null : previous)}
                      value={watch("gender") || "UNSET"}
                      onChange={(v) =>
                        setValue(
                          "gender",
                          v === "UNSET" ? "" : (v as "MALE" | "FEMALE"),
                          { shouldDirty: true }
                        )
                      }
                    >

                        <Select.Option value="UNSET">未填</Select.Option>
                        {GENDER_OPTIONS.map((g) => (
                          <Select.Option key={g} value={g}>
                            {genderLabel[g]}
                          </Select.Option>
                        ))}

                    </Select>
                  </Field>

                  <Field id={`${formId}-ethnicity`} label="民族">
                    <Controller name={"ethnicity"} control={control} render={({ field: inputField }) => (<Input id={`${formId}-ethnicity`} placeholder="如 汉族" {...inputField} value={inputField.value ?? ""} />)} />
                  </Field>
                </>
              )}

              <Field id={`${formId}-tags`} label="标签">
                <TagInput
                  id={`${formId}-tags`}
                  inputRef={tagInput}
                  tags={watchedTags || []}
                  onAdd={addTag}
                  onRemove={removeTag}
                />
              </Field>

              <Field id={`${formId}-notes`} label="备注" full>
                <Controller name={"notes"} control={control} render={({ field: inputField }) => (<TextArea id={`${formId}-notes`} rows={3} placeholder="可选" {...inputField} value={inputField.value ?? ""} />)} />
              </Field>
            </Section>

            {/* 联系人 */}
            <Section
              title="联系人"
              action={
                <Button
                  htmlType="button"
                  theme="outline"
                  size="small"
                  onClick={() =>
                    append({
                      name: "",
                      title: "",
                      phone: "",
                      email: "",
                      wechat: "",
                      isPrimary: false,
                      notes: ""
                    })
                  }
                  className="h-7 gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加联系人
                </Button>
              }
            >
              <div className="col-span-2 space-y-3">
                {fields.map((field, idx) => (
                  <div
                    key={field.id}
                    className="rounded-lg border border-border bg-background p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        联系人 {idx + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 text-xs">
                          <Checkbox
                            checked={watch(`contacts.${idx}.isPrimary`)}
                            disabled={isPending} onChange={event => { const c = event.target.checked === true;
                              if (c) {
                                // 单选：取消其他主联系人
                                fields.forEach((_, i) => {
                                  setValue(`contacts.${i}.isPrimary`, i === idx, { shouldDirty: true });
                                });
                              } else {
                                setValue(`contacts.${idx}.isPrimary`, false, { shouldDirty: true });
                              }
                             }}
                          >
                            <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" />主要联系人</span>
                          </Checkbox>
                        </div>
                        {fields.length > 1 && (
                          <Button
                            htmlType="button"
                            theme="borderless"
                            size="small"
                            onClick={() => remove(idx)}
                            aria-label={`删除联系人 ${watch(`contacts.${idx}.name`) || idx + 1}`}
                            className="h-7 w-7 p-0 text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field
                        id={`${formId}-${field.id}-name`}
                        label="姓名"
                        required
                        error={errors.contacts?.[idx]?.name?.message}
                      >
                        <Controller name={`contacts.${idx}.name`} control={control} render={({ field: inputField }) => (<Input
                          id={`${formId}-${field.id}-name`}
                          aria-invalid={!!errors.contacts?.[idx]?.name}
                          aria-describedby={errors.contacts?.[idx]?.name ? `${formId}-${field.id}-name-error` : undefined}
                          placeholder="姓名"
                          {...inputField} value={inputField.value ?? ""}
                        />)} />
                      </Field>
                      <Field id={`${formId}-${field.id}-title`} label="职务">
                        <Controller name={`contacts.${idx}.title`} control={control} render={({ field: inputField }) => (<Input
                          id={`${formId}-${field.id}-title`}
                          placeholder="法定代表人 / 总经理 / 法务"
                          {...inputField} value={inputField.value ?? ""}
                        />)} />
                      </Field>
                      <Field id={`${formId}-${field.id}-phone`} label="电话">
                        <Controller name={`contacts.${idx}.phone`} control={control} render={({ field: inputField }) => (<Input
                          id={`${formId}-${field.id}-phone`}
                          className="font-mono"
                          {...inputField} value={inputField.value ?? ""}
                        />)} />
                      </Field>
                      <Field
                        id={`${formId}-${field.id}-email`}
                        label="邮箱"
                        error={errors.contacts?.[idx]?.email?.message}
                      >
                        <Controller name={`contacts.${idx}.email`} control={control} render={({ field: inputField }) => (<Input
                          id={`${formId}-${field.id}-email`}
                          aria-invalid={!!errors.contacts?.[idx]?.email}
                          aria-describedby={errors.contacts?.[idx]?.email ? `${formId}-${field.id}-email-error` : undefined}
                          type="email"
                          {...inputField} value={inputField.value ?? ""}
                        />)} />
                      </Field>
                      <Field id={`${formId}-${field.id}-wechat`} label="微信">
                        <Controller name={`contacts.${idx}.wechat`} control={control} render={({ field: inputField }) => (<Input id={`${formId}-${field.id}-wechat`} {...inputField} value={inputField.value ?? ""} />)} />
                      </Field>
                      <Field id={`${formId}-${field.id}-notes`} label="备注">
                        <Controller name={`contacts.${idx}.notes`} control={control} render={({ field: inputField }) => (<Input id={`${formId}-${field.id}-notes`} {...inputField} value={inputField.value ?? ""} />)} />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </fieldset>

          {/* 底栏 */}
          <SheetFooter className="border-t border-border bg-background px-6 py-4">
            <Button
              htmlType="button"
              theme="outline"
              onClick={() => { void requestClose(); }}
              disabled={isPending}
            >
              取消
            </Button>
            <Button theme="solid"
              htmlType="submit"
              disabled={isPending}
              className="gap-1.5 "
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "保存" : "创建客户"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  action,
  children
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3 w-0.5 rounded-full bg-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h3>
        </div>
        {action}
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  required,
  full,
  error,
  children
}: {
  id: string;
  label: string;
  required?: boolean;
  full?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", full && "col-span-2")}>
      <label id={`${id}-label`} htmlFor={id} className="flex items-center gap-1 text-xs">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function TagInput({
  id,
  inputRef,
  tags,
  onAdd,
  onRemove
}: {
  id: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  tags: string[];
  onAdd: (t: string) => void;
  onRemove: (t: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <Tag key={t} size="large">
          {t}
          <Button theme="borderless" type="tertiary" size="small"
            htmlType="button"
            onClick={() => onRemove(t)}
            icon={<X size={12} />}
            aria-label={`移除 ${t}`}
          />
        </Tag>
      ))}
      <Input
        id={id}
        ref={inputRef}
        type="text"
        value={draft}
        onChange={setDraft}
        placeholder={tags.length === 0 ? "输入后回车添加标签" : ""}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd(draft);
            setDraft("");
          }
        }}
        className="min-w-24 flex-1"
      />
    </div>
  );
}
