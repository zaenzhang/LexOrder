"use client";

import { useId, useEffect, useMemo, useState, useTransition } from "react";
import type { LitigationStanding, MatterCategory, PartyRole, PartyType, ProcedureType } from "@prisma/client";
import { Select, Button, Checkbox, Input, Toast } from "@douyinfe/semi-ui";
import { Loader2, Plus, X } from "lucide-react";
import { DialogFooter } from "@/components/patterns/workspace-dialog";
import { FormDialogBody } from "@/components/patterns/form-dialog";
import { EnterpriseNameInput } from "@/components/matters/enterprise-name-input";
import { JurisdictionSelect } from "@/app/(app)/intakes/_components/jurisdiction-select";
import { litigationStandingLabel, matterCategoryKind, partyTypeLabel, procedureToStandingOptions, procedureTypeLabel } from "@/lib/enums";
import { PERSON_ID_TYPES, clientIdTypeLabel, personIdError, sanitizePersonIdInput, type PersonIdType } from "@/lib/clients/person-id";
import { agencyOptionsForProcedure, isAgencyAllowedForProcedure, isNationalAgency } from "@/lib/china-regions";
import { actionErrorMessage } from "@/lib/action-error";
import { cn } from "@/lib/utils";
import { shDayKey } from "@/lib/ui/sh-time";
import { updateProcedureInfo } from "@/server/matters/actions";
import type { EditorFormActions, MatterEditorSection, ProcedureMeta, PartyLite, ProcedurePartyRow, PartyEditDraft, NewProcedurePartyDraft } from "./matter-editor-types";

const formControlClass = "h-9 text-sm";
const formSectionClass = "space-y-3";
const nestedPanelClass = "rounded-md border border-border bg-card";
const formLabelClass = "text-xs font-medium text-muted-foreground";

const PARTY_ROLE_LABEL: Record<PartyRole, string> = {
  CLIENT_PARTY: "客户",
  OPPOSING_PARTY: "相对方",
  THIRD_PARTY: "第三人",
  CO_LITIGANT: "共同诉讼人",
  AGENT: "代理人",
  WITNESS: "证人",
  OTHER: "其他"
};

const PARTY_ROLE_OPTIONS: PartyRole[] = [
  "CLIENT_PARTY",
  "OPPOSING_PARTY",
  "THIRD_PARTY", "CO_LITIGANT", "AGENT", "WITNESS", "OTHER"
];

const PARTY_TYPE_OPTIONS: PartyType[] = [
  "NATURAL_PERSON",
  "COMPANY",
  "PARTNERSHIP",
  "INDIVIDUAL_BUSINESS",
  "INSTITUTION",
  "SOCIAL_ORG",
  "GOVERNMENT",
  "OTHER_ORG", "ORGANIZATION"
];

const REQUIRED_STANDINGS_BY_PROCEDURE: Partial<Record<ProcedureType, LitigationStanding[]>> = {
  FIRST_INSTANCE: ["PLAINTIFF", "DEFENDANT"],
  REMAND_FIRST: ["PLAINTIFF", "DEFENDANT"],
  SECOND_INSTANCE: ["APPELLANT", "APPELLEE"],
  REMAND_SECOND: ["APPELLANT", "APPELLEE"],
  RETRIAL_REVIEW: ["RETRIAL_APPLICANT", "RETRIAL_RESPONDENT"],
  RETRIAL: ["RETRIAL_APPLICANT", "RETRIAL_RESPONDENT"],
  PROSECUTORIAL_SUPERVISION: ["RETRIAL_APPLICANT", "RETRIAL_RESPONDENT"],
  COMMERCIAL_ARBITRATION: ["ARBITRATION_CLAIMANT", "ARBITRATION_RESPONDENT"],
  LABOR_ARBITRATION: ["ARBITRATION_CLAIMANT", "ARBITRATION_RESPONDENT"],
  ENFORCEMENT: ["ENFORCEMENT_APPLICANT", "EXECUTED_PERSON"],
  ENFORCEMENT_OBJECTION: ["ENFORCEMENT_APPLICANT", "EXECUTED_PERSON"],
  ADMIN_RECONSIDERATION: [
    "ADMIN_RECONSIDERATION_APPLICANT",
    "ADMIN_RECONSIDERATION_RESPONDENT"
  ],
  NON_LITIGATION_PHASE: ["NON_LITIGATION_PARTY"],
  CUSTOM: ["NON_LITIGATION_PARTY"]
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold">{children}</h3>;
}

const ARBITRATION_TYPES: ProcedureType[] = [
  "COMMERCIAL_ARBITRATION",
  "LABOR_ARBITRATION",
  "ARBITRATION_SET_ASIDE",
  "ARBITRATION_ENFORCEMENT_REVIEW"
];

const EXECUTION_TYPES: ProcedureType[] = [
  "ENFORCEMENT",
  "ENFORCEMENT_OBJECTION",
  "ADMIN_NON_LITIGATION_ENFORCEMENT",
  "CRIMINAL_ENFORCEMENT"
];

function toInputDate(d: Date | null | undefined) {
  return d ? shDayKey(d) : "";
}

function procedureJudgeLabel(type: ProcedureType) {
  if (ARBITRATION_TYPES.includes(type)) return "首席仲裁员";
  if (EXECUTION_TYPES.includes(type)) return "执行法官";
  return "主审法官";
}

function standingOrder(type: ProcedureType, rows: ProcedurePartyRow[]) {
  const base = procedureToStandingOptions(type, "ours");
  const required = REQUIRED_STANDINGS_BY_PROCEDURE[type] ?? [];
  const assigned = rows.map((row) => row.standing);
  return [...new Set([...required, ...base, ...assigned])];
}

function buildInitialProcedureParties(procedure: ProcedureMeta) {
  return procedure.procedureParties.map(row => ({ partyId: row.partyId, standing: row.standing }));
}

function partyToEditDraft(party: PartyLite): PartyEditDraft {
  return {
    partyId: party.id,
    name: party.name ?? "",
    role: party.role,
    partyType: party.partyType,
    idType: party.idType ?? "",
    idNumber: party.idNumber ?? "",
    enterpriseSocialCode: party.enterpriseSocialCode ?? "",
    legalRep: party.legalRep ?? "",
    contactName: party.contactName ?? "",
    phone: party.phone ?? "",
    address: party.address ?? ""
  };
}

function initialNewPartyForm(partyStandingOptions: LitigationStanding[]) {
  return {
    name: "",
    role: "OPPOSING_PARTY" as PartyRole,
    partyType: "NATURAL_PERSON" as PartyType,
    idType: "ID_CARD",
    idNumber: "",
    enterpriseSocialCode: "",
    standings: partyStandingOptions.slice(0, 1)
  };
}

function toProcedureForm(procedure: ProcedureMeta | null | undefined) {
  return {
    jurisdiction: procedure?.jurisdiction ?? "",
    handlingAgency: procedure?.handlingAgency ?? "",
    caseNumber: procedure?.caseNumber ?? "",
    presidingJudge: procedure?.presidingJudge ?? "",
    presidingJudgeContact: procedure?.presidingJudgeContact ?? "",
    judgeAssistant: procedure?.judgeAssistant ?? "",
    judgeAssistantContact: procedure?.judgeAssistantContact ?? "",
    ourStanding: (procedure?.ourStanding ?? "") as LitigationStanding | "",
    acceptedAt: toInputDate(procedure?.acceptedAt),
    concludedAt: toInputDate(procedure?.concludedAt)
  };
}


export function ProcedureInfoEditor({ currentProcedure, parties, category, initialSection, onStateChange, onSaved, onCancel }: EditorFormActions & {
  currentProcedure: ProcedureMeta; parties: PartyLite[]; category: MatterCategory; initialSection: MatterEditorSection;
}) {
  const selectLabelId = useId();
  const procedureStandingOptions = procedureToStandingOptions(currentProcedure.type, "ours");
  const partyStandingOptions = standingOrder(currentProcedure.type, currentProcedure.procedureParties);
  const [procedureForm, setProcedureForm] = useState(() => toProcedureForm(currentProcedure));
  const [procedureParties, setProcedureParties] = useState(() =>
    buildInitialProcedureParties(currentProcedure)
  );
  const [partyEdits, setPartyEdits] = useState<Record<string, PartyEditDraft>>(() =>
    Object.fromEntries(parties.map((party) => [party.id, partyToEditDraft(party)]))
  );
  const [newPartyForm, setNewPartyForm] = useState(() => initialNewPartyForm(partyStandingOptions));
  const [newProcedureParties, setNewProcedureParties] = useState<NewProcedurePartyDraft[]>([]);
  const [showNewPartyForm, setShowNewPartyForm] = useState(false);


  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const originalForm = toProcedureForm(currentProcedure);
  const changedParties = parties.filter(party => !party.id.startsWith("client:") && Object.entries(partyToEditDraft(party)).some(([key, value]) => partyEdits[party.id][key as keyof PartyEditDraft] !== value));
  const originalParties = buildInitialProcedureParties(currentProcedure);
  const assignmentsChanged = originalParties.length !== procedureParties.length || originalParties.some(old => !procedureParties.some(row => row.partyId === old.partyId && row.standing === old.standing));
  const hasUnaddedParty = Boolean(newPartyForm.name.trim() || newPartyForm.idNumber.trim() || newPartyForm.enterpriseSocialCode.trim());
  const dirty = Object.entries(originalForm).some(([key, value]) => procedureForm[key as keyof typeof procedureForm] !== value) || assignmentsChanged || changedParties.length > 0 || newProcedureParties.length > 0 || hasUnaddedParty;
  useEffect(() => onStateChange({ dirty, pending: isPending }), [dirty, isPending, onStateChange]);
  const procedureLabel = currentProcedure.customLabel ?? procedureTypeLabel[currentProcedure.type];
  const judgeLabel = procedureJudgeLabel(currentProcedure.type);
  const isLitigationMatter = matterCategoryKind(category) === "litigation";
  const isArbitrationProc = ["COMMERCIAL_ARBITRATION", "LABOR_ARBITRATION"].includes(currentProcedure.type);
  const isCriminalProc = ["INVESTIGATION", "PROSECUTION_REVIEW"].includes(currentProcedure.type);
  const assistantLabel = isArbitrationProc ? "仲裁秘书" : isCriminalProc ? "检察官助理" : "书记员";
  const procedureAgencyOptions = useMemo(() => agencyOptionsForProcedure(procedureForm.jurisdiction, currentProcedure.type), [procedureForm.jurisdiction, currentProcedure.type]);

  function setProcedureField<K extends keyof typeof procedureForm>(
    key: K,
    value: (typeof procedureForm)[K]
  ) {
    setProcedureForm((cur) => ({ ...cur, [key]: value }));
  }

  function handleJurisdictionChange(value: string) {
    setProcedureForm((cur) => ({
      ...cur,
      jurisdiction: value,
      handlingAgency:
        isNationalAgency(cur.handlingAgency) ||
        !isAgencyAllowedForProcedure(cur.handlingAgency, currentProcedure?.type)
          ? ""
          : cur.handlingAgency
    }));
  }

  function handleHandlingAgencyChange(value: string) {
    setProcedureForm((cur) => ({
      ...cur,
      handlingAgency: value,
      jurisdiction: isNationalAgency(value) ? "" : cur.jurisdiction
    }));
  }

  function toggleProcedureParty(partyId: string, standing: LitigationStanding, checked: boolean) {
    setProcedureParties((rows) => {
      const next = rows.filter((row) => !(row.partyId === partyId && row.standing === standing));
      return checked ? [...next, { partyId, standing }] : next;
    });
  }

  function hasProcedureStanding(partyId: string, standing: LitigationStanding) {
    return procedureParties.some((row) => row.partyId === partyId && row.standing === standing);
  }

  function setPartyEditValue<K extends keyof PartyEditDraft>(
    partyId: string,
    key: K,
    value: PartyEditDraft[K]
  ) {
    setPartyEdits((cur) => ({
      ...cur,
      [partyId]: {
        ...cur[partyId],
        [key]: value
      }
    }));
  }

  function setNewPartyFormValue<K extends keyof typeof newPartyForm>(
    key: K,
    value: (typeof newPartyForm)[K]
  ) {
    setNewPartyForm((cur) => ({ ...cur, [key]: value }));
  }

  function toggleNewPartyFormStanding(standing: LitigationStanding, checked: boolean) {
    setNewPartyForm((cur) => ({
      ...cur,
      standings: checked
        ? [...new Set([...cur.standings, standing])]
        : cur.standings.filter((s) => s !== standing)
    }));
  }

  function toggleNewDraftStanding(tempId: string, standing: LitigationStanding, checked: boolean) {
    setNewProcedureParties((rows) =>
      rows.map((row) =>
        row.tempId === tempId
          ? {
              ...row,
              standings: checked
                ? [...new Set([...row.standings, standing])]
                : row.standings.filter((s) => s !== standing)
            }
          : row
      )
    );
  }

  function addNewProcedureParty() {
    const name = newPartyForm.name.trim();
    if (!name) {
      setError("请填写当事人名称");
      return;
    }
    if (newPartyForm.standings.length === 0) {
      setError("请选择程序地位");
      return;
    }
    if (newPartyForm.partyType === "NATURAL_PERSON" && !newPartyForm.idNumber.trim()) {
      setError("请填写证件号");
      return;
    }
    const newIdError =
      newPartyForm.partyType === "NATURAL_PERSON"
        ? personIdError(newPartyForm.idType, newPartyForm.idNumber)
        : personIdError("USCC", newPartyForm.enterpriseSocialCode);
    if (newIdError) {
      setError(newIdError);
      return;
    }
    if (newPartyForm.partyType !== "NATURAL_PERSON" && !newPartyForm.enterpriseSocialCode.trim()) {
      setError("请填写统一社会信用代码");
      return;
    }
    setError("");
    setNewProcedureParties((rows) => [
      ...rows,
      {
        tempId: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        role: newPartyForm.role,
        partyType: newPartyForm.partyType,
        idType: newPartyForm.partyType === "NATURAL_PERSON" ? newPartyForm.idType : "",
        idNumber: newPartyForm.idNumber.trim(),
        enterpriseSocialCode: newPartyForm.enterpriseSocialCode.trim(),
        standings: newPartyForm.standings
      }
    ]);
    setNewPartyForm((cur) => ({
      ...cur,
      name: "",
      idNumber: "",
      enterpriseSocialCode: ""
    }));
    setShowNewPartyForm(false);
  }


  function save() {
    if (isPending) return;
    if (hasUnaddedParty) { setError("请先确认添加正在填写的当事人，再保存程序"); return; }
    if (newProcedureParties.some(party => party.standings.length === 0)) { setError("新增当事人需至少选择一个程序地位"); return; }
    if (!isAgencyAllowedForProcedure(procedureForm.handlingAgency, currentProcedure.type)) { setError("商事仲裁程序不能选择法院作为管辖机构"); return; }
    for (const party of changedParties) {
      if (!party.updatedAt) { setError("当事人版本缺失，请关闭后重新打开"); return; }
      const draft = partyEdits[party.id];
      if (!draft.name.trim()) { setError("当事人名称不能为空"); return; }
      if (draft.partyType === "NATURAL_PERSON") {
        const idError = personIdError(draft.idType, draft.idNumber);
        if (idError) { setError(`当事人「${draft.name}」：${idError}`); return; }
      }
    }
    setError("");
    startTransition(async () => {
      try {
        await updateProcedureInfo({
          procedureId: currentProcedure.id, expectedUpdatedAt: currentProcedure.updatedAt,
          ...procedureForm, ourStanding: procedureForm.ourStanding || null,
          acceptedAt: procedureForm.acceptedAt ? new Date(`${procedureForm.acceptedAt}T00:00:00+08:00`) : null,
          concludedAt: procedureForm.concludedAt ? new Date(`${procedureForm.concludedAt}T00:00:00+08:00`) : null,
          procedureParties,
          updatedParties: changedParties.map(party => {
            const draft = partyEdits[party.id];
            return { ...draft, expectedUpdatedAt: party.updatedAt as Date,
              idType: draft.partyType === "NATURAL_PERSON" && draft.idType ? draft.idType as PersonIdType : null };
          }),
          newProcedureParties: newProcedureParties.map(({ name, role, partyType, idType, idNumber, enterpriseSocialCode, standings }) => ({
            name, role, partyType, idNumber, enterpriseSocialCode, standings,
            idType: partyType === "NATURAL_PERSON" ? idType as PersonIdType : null
          }))
        });
        Toast.success("程序与当事人已保存");
        onSaved();
      } catch (err) { setError(actionErrorMessage(err) || "保存失败，请稍后重试"); }
    });
  }

  return <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); save(); }}>
    <FormDialogBody>
      <fieldset disabled={isPending} className="space-y-6">
            <section data-editor-autofocus={initialSection === "procedure"} tabIndex={-1} aria-label="当前程序信息" className={formSectionClass}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionTitle>当前程序信息</SectionTitle>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {procedureLabel}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {isLitigationMatter ? (<>
                <div className="space-y-1.5">
                  <label className={formLabelClass}>管辖地（省/市/区县）</label>
                  <JurisdictionSelect
                    value={procedureForm.jurisdiction}
                    onChange={handleJurisdictionChange}
                    triggerClassName={formControlClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={formLabelClass}>{isArbitrationProc ? "仲裁机构" : isCriminalProc ? "办案机关" : "管辖机构"}</label>
                  <Input
                    list={`matter-info-agency-${currentProcedure.id}`}
                    aria-label="管辖机构"
                    value={procedureForm.handlingAgency}
                    onChange={inputValue => handleHandlingAgencyChange(inputValue)}
                    placeholder="如：最高人民法院 / 广州市天河区人民法院"
                    className={formControlClass}
                  />
                  <datalist id={`matter-info-agency-${currentProcedure.id}`}>
                    {procedureAgencyOptions.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <label className={formLabelClass}>案号</label>
                  <Input
                    aria-label="案号"
                    value={procedureForm.caseNumber}
                    onChange={inputValue => setProcedureField("caseNumber", inputValue)}
                    className={cn(formControlClass, "font-mono")}
                  />
                </div>
                <div className="space-y-1.5">
                  <label id={selectLabelId + "-1"} className={formLabelClass}>我方程序地位</label>
                  <Select
                    value={procedureForm.ourStanding || "unset"}
                    onChange={v => { if (typeof v === "string") setProcedureField("ourStanding", v === "unset" ? "" : v as LitigationStanding); }}
                    aria-labelledby={selectLabelId + "-1"}
                    placeholder="选择地位"
                    className="w-full"
                    disabled={isPending} motion={false}><Select.Option value="unset">未设置</Select.Option>{procedureStandingOptions.map((s) => (
                        <Select.Option key={s} value={s}>
                          {litigationStandingLabel[s]}
                        </Select.Option>
                      ))}</Select>
                </div>
                <div className="space-y-1.5">
                  <label className={formLabelClass}>{judgeLabel}</label>
                  <Input
                    aria-label="主审人员"
                    value={procedureForm.presidingJudge}
                    onChange={inputValue => setProcedureField("presidingJudge", inputValue)}
                    className={formControlClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={formLabelClass}>{judgeLabel}联系方式</label>
                  <Input
                    aria-label="主审人员联系方式"
                    value={procedureForm.presidingJudgeContact}
                    onChange={inputValue => setProcedureField("presidingJudgeContact", inputValue)}
                    className={cn(formControlClass, "font-mono")}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={formLabelClass}>{assistantLabel}</label>
                  <Input
                    aria-label="辅助人员"
                    value={procedureForm.judgeAssistant}
                    onChange={inputValue => setProcedureField("judgeAssistant", inputValue)}
                    className={formControlClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={formLabelClass}>{assistantLabel}联系方式</label>
                  <Input
                    aria-label="辅助人员联系方式"
                    value={procedureForm.judgeAssistantContact}
                    onChange={inputValue => setProcedureField("judgeAssistantContact", inputValue)}
                    className={cn(formControlClass, "font-mono")}
                  />
                </div>
                </>) : null}
                <div className="space-y-1.5">
                  <label className={formLabelClass}>{isLitigationMatter ? (isArbitrationProc ? "受理时间" : "立案时间") : "开始时间"}</label>
                  <Input
                    type="date"
                    aria-label="受理或开始日期"
                    value={procedureForm.acceptedAt}
                    onChange={inputValue => setProcedureField("acceptedAt", inputValue)}
                    className={formControlClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={formLabelClass}>{isLitigationMatter ? "裁决 / 结案时间" : "完成时间"}</label>
                  <Input
                    type="date"
                    aria-label="结案或完成日期"
                    value={procedureForm.concludedAt}
                    onChange={inputValue => setProcedureField("concludedAt", inputValue)}
                    className={formControlClass}
                  />
                </div>
              </div>
            </section>

            <section data-editor-autofocus={initialSection === "parties"} tabIndex={-1} aria-label="当前程序当事人" className={formSectionClass}>
              <div className="flex items-center justify-between gap-3">
                <SectionTitle>当前程序当事人</SectionTitle>
                <Button
                  onClick={() => setShowNewPartyForm((visible) => !visible)}
                  className="h-7 gap-1.5 px-2 text-xs"
                  htmlType="button"
                  type="tertiary" theme="outline"
                  size="small"
                >
                  {showNewPartyForm ? (
                    <X className="h-3.5 w-3.5" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {showNewPartyForm ? "收起新增当事人" : "添加当事人"}
                </Button>
              </div>

              {parties.length === 0 ? (
                <div className={cn(nestedPanelClass, "px-3 py-2 text-xs text-muted-foreground")}>
                  暂无案件当事人
                </div>
              ) : (
                <div className={cn(nestedPanelClass, "divide-y divide-border")}>
                  {parties.map((party) => {
                    const draft = partyEdits[party.id] ?? partyToEditDraft(party);
                    const isOrg = draft.partyType !== "NATURAL_PERSON";
                    return (
                      <div key={party.id} className="space-y-2 border-t border-border p-2.5 first:border-t-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-xs font-medium" title={draft.name}>
                            {draft.name || "—"}
                          </span>
                          {party.standing && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {litigationStandingLabel[party.standing]}
                            </span>
                          )}
                          {party.role === "CLIENT_PARTY" && (
                            <span className="shrink-0 rounded border border-primary/20 bg-primary/10 px-1 py-0 text-[10px] font-medium leading-4 text-primary">
                              客户
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-2">
                          {partyStandingOptions.map((standing) => (
                            <div key={`${party.id}-${standing}`} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <Checkbox checked={hasProcedureStanding(party.id, standing)} onChange={({ target: { checked } }) => toggleProcedureParty(party.id, standing, checked === true)}>
                              <span>{litigationStandingLabel[standing]}</span>
                            </Checkbox></div>
                          ))}
                        </div>
                        {party.id.startsWith("client:") ? <p className="text-xs text-muted-foreground">客户资料请在客户详情修改；此处仅设置程序地位。</p> : <div className="rounded-md border border-border bg-muted/30 p-2">
                          <div className="mb-2 text-[11px] font-medium text-muted-foreground">
                            主体基础信息
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <label className={formLabelClass}>{isOrg ? "单位 / 组织名称" : "姓名"}</label>
                              {isOrg ? (
                                <EnterpriseNameInput
                                  value={draft.name}
                                  onChange={(name) => setPartyEditValue(party.id, "name", name)}
                                  onPick={(pick) => {
                                    setPartyEditValue(party.id, "name", pick.name);
                                    setPartyEditValue(party.id, "enterpriseSocialCode", pick.creditCode);
                                    if (pick.legalRep) setPartyEditValue(party.id, "legalRep", pick.legalRep);
                                    if (pick.address) setPartyEditValue(party.id, "address", pick.address);
                                  }}
                                  className={formControlClass}
                                />
                              ) : (
                                <Input
                                  value={draft.name}
                                  onChange={inputValue => setPartyEditValue(party.id, "name", inputValue)}
                                  className={formControlClass}
                                />
                              )}
                            </div>
                            <div className="space-y-1.5">
                              <label id={selectLabelId + "-2" + "-" + party.id} className={formLabelClass}>当事人角色</label>
                              <Select
                                value={draft.role}
                                onChange={v => { if (typeof v === "string") setPartyEditValue(party.id, "role", v as PartyRole); }}
                                aria-labelledby={selectLabelId + "-2" + "-" + party.id}
                                className="w-full"
                                disabled={isPending} motion={false}>{PARTY_ROLE_OPTIONS.map((role) => (
                                    <Select.Option key={role} value={role}>
                                      {PARTY_ROLE_LABEL[role]}
                                    </Select.Option>
                                  ))}</Select>
                            </div>
                            <div className="space-y-1.5">
                              <label id={selectLabelId + "-3" + "-" + party.id} className={formLabelClass}>主体类型</label>
                              <Select
                                value={draft.partyType}
                                onChange={v => { if (typeof v === "string") setPartyEditValue(party.id, "partyType", v as PartyType); }}
                                aria-labelledby={selectLabelId + "-3" + "-" + party.id}
                                className="w-full"
                                disabled={isPending} motion={false}>{PARTY_TYPE_OPTIONS.map((partyType) => (
                                    <Select.Option key={partyType} value={partyType}>
                                      {partyTypeLabel[partyType]}
                                    </Select.Option>
                                  ))}</Select>
                            </div>
                            {!isOrg && (
                              <div className="space-y-1.5">
                                <label id={selectLabelId + "-4" + "-" + party.id} className={formLabelClass}>证件类型</label>
                                <Select
                                  value={draft.idType}
                                  onChange={v => { if (typeof v !== "string") return;
                                    setPartyEditValue(party.id, "idType", v);
                                    setPartyEditValue(party.id, "idNumber", sanitizePersonIdInput(v, draft.idNumber));
                                  }}
                                  aria-labelledby={selectLabelId + "-4" + "-" + party.id}
                                  className="w-full"
                                  disabled={isPending} motion={false}>{PERSON_ID_TYPES.map((t) => (
                                      <Select.Option key={t} value={t}>
                                        {clientIdTypeLabel[t]}
                                      </Select.Option>
                                    ))}</Select>
                              </div>
                            )}
                            <div className="space-y-1.5">
                              <label className={formLabelClass}>
                                {isOrg ? "统一社会信用代码" : "证件号码"}
                                {!isOrg && draft.idType === "ID_CARD" ? (
                                  <span className="ml-1 font-normal text-muted-foreground">（{draft.idNumber.length}/18）</span>
                                ) : null}
                              </label>
                              <Input
                                className={cn(formControlClass, "font-mono")}
                                inputMode={!isOrg && draft.idType === "ID_CARD" ? "numeric" : undefined}
                                placeholder={isOrg ? "18 位信用代码" : draft.idType === "ID_CARD" ? "18 位，仅数字或 X" : "证件号码"}
                                value={isOrg ? draft.enterpriseSocialCode : draft.idNumber}
                                onChange={inputValue => isOrg
                                    ? setPartyEditValue(party.id, "enterpriseSocialCode", inputValue.toUpperCase().replace(/\s+/g, "").slice(0, 18))
                                    : setPartyEditValue(party.id, "idNumber", sanitizePersonIdInput(draft.idType, inputValue))}
                              />
                              {(() => {
                                const err = isOrg ? personIdError("USCC", draft.enterpriseSocialCode) : personIdError(draft.idType, draft.idNumber);
                                return err ? <p className="text-[11px] text-[var(--amber,#b7791f)]">{err}</p> : null;
                              })()}
                            </div>
                            {isOrg && (
                              <div className="space-y-1.5">
                                <label className={formLabelClass}>{draft.partyType === "COMPANY" ? "法定代表人" : "法定代表人 / 负责人"}</label>
                                <Input
                                  value={draft.legalRep}
                                  onChange={inputValue => setPartyEditValue(party.id, "legalRep", inputValue)}
                                  className={formControlClass}
                                />
                              </div>
                            )}
                            <div className="space-y-1.5">
                              <label className={formLabelClass}>{isOrg ? "经办联系人" : "联系人"}</label>
                              <Input
                                value={draft.contactName}
                                onChange={inputValue => setPartyEditValue(party.id, "contactName", inputValue)}
                                className={formControlClass}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={formLabelClass}>联系方式</label>
                              <Input
                                className={cn(formControlClass, "font-mono")}
                                value={draft.phone}
                                onChange={inputValue => setPartyEditValue(party.id, "phone", inputValue)}
                              />
                            </div>
                            <div className="space-y-1.5 sm:col-span-2">
                              <label className={formLabelClass}>地址</label>
                              <Input
                                value={draft.address}
                                onChange={inputValue => setPartyEditValue(party.id, "address", inputValue)}
                                className={formControlClass}
                              />
                            </div>
                          </div>
                        </div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {newProcedureParties.length > 0 && (
                <div className={nestedPanelClass}>
                  {newProcedureParties.map((party) => (
                    <div key={party.tempId} className="border-t border-border p-2 first:border-t-0">
                      <div className="mb-2 flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-xs font-medium" title={party.name}>
                          {party.name}
                        </span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {PARTY_ROLE_LABEL[party.role]} · {partyTypeLabel[party.partyType]}
                        </span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {party.partyType === "NATURAL_PERSON"
                            ? party.idNumber
                            : party.enterpriseSocialCode}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setNewProcedureParties((rows) =>
                              rows.filter((row) => row.tempId !== party.tempId)
                            )
                          }
                          className="ml-auto rounded p-0.5 text-muted-foreground hover:text-destructive"
                          aria-label={`移除待添加的${party.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-2">
                        {partyStandingOptions.map((standing) => (
                          <div key={`${party.tempId}-${standing}`} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Checkbox checked={party.standings.includes(standing)} onChange={({ target: { checked } }) => toggleNewDraftStanding(party.tempId, standing, checked === true)}>
                            <span>{litigationStandingLabel[standing]}</span>
                          </Checkbox></div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showNewPartyForm && (
                <div className="rounded-md border border-dashed border-border bg-muted/30 p-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input
                      value={newPartyForm.name}
                      onChange={inputValue => setNewPartyFormValue("name", inputValue)}
                      placeholder="新增当事人名称"
                      className={cn(formControlClass, "h-8 text-xs")}
                    />

                    <> <span className="sr-only" id={selectLabelId + "-5"}>角色</span><Select
                      value={newPartyForm.role}
                      onChange={v => { if (typeof v === "string") setNewPartyFormValue("role", v as PartyRole); }}
                      aria-labelledby={selectLabelId + "-5"}
                      className="w-full"
                      disabled={isPending} motion={false}>{PARTY_ROLE_OPTIONS.map((role) => (
                          <Select.Option key={role} value={role}>
                            {PARTY_ROLE_LABEL[role]}
                          </Select.Option>
                        ))}</Select></>
                    <> <span className="sr-only" id={selectLabelId + "-6"}>主体类型</span><Select
                      value={newPartyForm.partyType}
                      onChange={v => { if (typeof v === "string") setNewPartyFormValue("partyType", v as PartyType); }}
                      aria-labelledby={selectLabelId + "-6"}
                      className="w-full"
                      disabled={isPending} motion={false}>{PARTY_TYPE_OPTIONS.map((partyType) => (
                          <Select.Option key={partyType} value={partyType}>
                            {partyTypeLabel[partyType]}
                          </Select.Option>
                        ))}</Select></>
                    {newPartyForm.partyType === "NATURAL_PERSON" ? (
                      <> <span className="sr-only" id={selectLabelId + "-7"}>{"证件类型"}</span><Select
                        value={newPartyForm.idType}
                        onChange={v => { if (typeof v === "string") setNewPartyForm((cur) => ({ ...cur, idType: v, idNumber: sanitizePersonIdInput(v, cur.idNumber) })); }}
                        aria-labelledby={selectLabelId + "-7"}
                        className="w-full"
                        disabled={isPending} motion={false}>{PERSON_ID_TYPES.map((t) => (
                            <Select.Option key={t} value={t}>
                              {clientIdTypeLabel[t]}
                            </Select.Option>
                          ))}</Select></>
                    ) : (
                      <div className="hidden sm:block" />
                    )}
                    <Input
                      value={
                        newPartyForm.partyType === "NATURAL_PERSON"
                          ? newPartyForm.idNumber
                          : newPartyForm.enterpriseSocialCode
                      }
                      onChange={inputValue => newPartyForm.partyType === "NATURAL_PERSON"
                          ? setNewPartyFormValue("idNumber", sanitizePersonIdInput(newPartyForm.idType, inputValue))
                          : setNewPartyFormValue("enterpriseSocialCode", inputValue.toUpperCase().replace(/\s+/g, "").slice(0, 18))}
                      placeholder={
                        newPartyForm.partyType === "NATURAL_PERSON"
                          ? newPartyForm.idType === "ID_CARD" ? "18 位，仅数字或 X" : "证件号码"
                          : "统一社会信用代码"
                      }
                      className={cn(formControlClass, "h-8 text-xs")}
                    />
                    <Button
                      onClick={addNewProcedureParty}
                      className="h-8 px-2 text-xs"
                      htmlType="button"
                      type="tertiary" theme="outline"
                    >
                      确认添加
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
                    {partyStandingOptions.map((standing) => (
                      <div key={`new-form-${standing}`} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Checkbox checked={newPartyForm.standings.includes(standing)} onChange={({ target: { checked } }) => toggleNewPartyFormStanding(standing, checked === true)}>
                        <span>{litigationStandingLabel[standing]}</span>
                      </Checkbox></div>
                    ))}
                  </div>
                </div>
              )}
            </section>


      </fieldset>
    </FormDialogBody>
    <DialogFooter className="px-6 py-4">
      {error && <p role="alert" className="basis-full text-sm text-destructive">{error}</p>}
      <Button onClick={onCancel} disabled={isPending} htmlType="button" type="tertiary" theme="outline">取消</Button>
      <Button disabled={isPending || !dirty} htmlType="submit" theme="solid">{isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存程序与当事人</Button>
    </DialogFooter>
  </form>;
}
