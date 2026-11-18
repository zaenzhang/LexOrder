"use client";

import { useId, useEffect, useState, useTransition } from "react";
import type { LitigationStanding, ProcedureType } from "@prisma/client";
import { Select, Button, Checkbox, Input, Toast } from "@douyinfe/semi-ui";
import { Loader2 } from "lucide-react";
import { DialogFooter } from "@/components/ui/dialog";
import { FormDialogBody } from "@/components/patterns/form-dialog";
import { CauseCombobox } from "@/app/(app)/matters/_components/cause-combobox";
import { litigationStandingLabel, matterCategoryLabel, matterCategoryKind } from "@/lib/enums";
import { standingsByCategory } from "@/lib/procedures-by-category";
import { actionErrorMessage } from "@/lib/action-error";
import { cn, formatDate } from "@/lib/utils";
import { updateMatterBasicInfo } from "@/server/matters/actions";
import type { EditorFormActions, MatterMeta } from "./matter-editor-types";

const formControlClass = "h-9 text-sm";
const formLabelClass = "text-xs font-medium text-muted-foreground";

export function MatterBasicEditor({ matterId, matterMeta, procedureType, onStateChange, onSaved, onCancel }: EditorFormActions & {
  matterId: string; matterMeta: MatterMeta; procedureType?: ProcedureType;
}) {
  const selectLabelId = useId();
  const [title, setTitle] = useState(matterMeta.title);
  const [causeId, setCauseId] = useState(matterMeta.causeId ?? "");
  const [causeFreeText, setCauseFreeText] = useState(matterMeta.causeFreeText ?? "");
  const [claimAmount, setClaimAmount] = useState(matterMeta.claimAmount === null ? "" : String(matterMeta.claimAmount));
  const [ourStanding, setOurStanding] = useState<LitigationStanding | "">(matterMeta.ourStanding ?? "");
  const [teamAccessRestricted, setTeamAccessRestricted] = useState(!!matterMeta.teamAccessRestricted);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const dirty = title !== matterMeta.title || causeId !== (matterMeta.causeId ?? "") || causeFreeText !== (matterMeta.causeFreeText ?? "") ||
    claimAmount !== (matterMeta.claimAmount === null ? "" : String(matterMeta.claimAmount)) || ourStanding !== (matterMeta.ourStanding ?? "") || teamAccessRestricted !== !!matterMeta.teamAccessRestricted;
  useEffect(() => onStateChange({ dirty, pending: isPending }), [dirty, isPending, onStateChange]);
  const categoryKind = matterCategoryKind(matterMeta.category);
  const isLitigationMatter = categoryKind === "litigation";
  const availableStandings = standingsByCategory[matterMeta.category];

  function save() {
    if (isPending) return;
    if (!title.trim()) { setError("案件名称不能为空"); return; }
    const parsedAmount = claimAmount.trim() === "" ? null : Number(claimAmount);
    if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) { setError("标的额格式有误"); return; }
    setError("");
    startTransition(async () => {
      try {
        await updateMatterBasicInfo({ id: matterId, expectedUpdatedAt: matterMeta.updatedAt, title, causeId, causeFreeText,
          claimAmount: parsedAmount, ourStanding: ourStanding || null, teamAccessRestricted });
        Toast.success("案件信息已保存");
        onSaved();
      } catch (err) { setError(actionErrorMessage(err) || "保存失败，请稍后重试"); }
    });
  }

  return <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); save(); }}>
    <FormDialogBody>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">收案日</dt><dd>{matterMeta.intakeDate ? formatDate(matterMeta.intakeDate) : "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">类别</dt><dd>{matterCategoryLabel[matterMeta.category]}</dd></div>
      </dl>
      <fieldset disabled={isPending}>
            <section aria-label="案件基础信息" className="space-y-4">

              <div className="space-y-1.5">
                <label htmlFor="matter-title" className={formLabelClass}>案件名称</label>
                <Input
                  id="matter-title"
                  value={title}
                  onChange={inputValue => setTitle(inputValue)}
                  placeholder="案件名称"
                  className={formControlClass}
                />
              </div>

              {isLitigationMatter ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={formLabelClass}>{matterMeta.category === "CRIMINAL" ? "涉嫌罪名" : "案由"}</label>
                  <CauseCombobox
                    category={matterMeta.category}
                    procedureType={procedureType}
                    value={causeId}
                    onChange={(id) => setCauseId(id)}
                    triggerClassName={formControlClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={formLabelClass}>自由文本案由（不在标准库时填）</label>
                  <Input
                    aria-label="自由文本案由"
                    value={causeFreeText}
                    onChange={inputValue => setCauseFreeText(inputValue)}
                    className={formControlClass}
                  />
                </div>
              </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {matterMeta.category !== "CRIMINAL" && categoryKind !== "counsel" ? (
                <div className="space-y-1.5">
                  <label className={formLabelClass}>{isLitigationMatter ? "标的额（元）" : "项目金额（元）"}</label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    aria-label={isLitigationMatter ? "标的额（元）" : "项目金额（元）"}
                    value={claimAmount}
                    onChange={inputValue => setClaimAmount(inputValue)}
                    placeholder="非金钱标的留空"
                    className={cn(formControlClass, "font-mono")}
                  />
                </div>
                ) : null}
                {isLitigationMatter ? (
                <div className="space-y-1.5">
                  <label id={selectLabelId + "-1"} className={formLabelClass}>我方诉讼地位</label>
                  <Select
                    value={ourStanding || "unset"}
                    onChange={v => { if (typeof v === "string") setOurStanding(v === "unset" ? "" : v as LitigationStanding); }}
                    aria-labelledby={selectLabelId + "-1"}
                    placeholder="选择地位"
                    className="w-full"
                    disabled={isPending} motion={false}><Select.Option value="unset">未设置</Select.Option>{availableStandings.map((s) => (
                        <Select.Option key={s} value={s}>
                          {litigationStandingLabel[s]}
                        </Select.Option>
                      ))}</Select>
                </div>
                ) : null}
              </div>

              <div className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs">
                <Checkbox checked={teamAccessRestricted} onChange={({ target: { checked } }) => setTeamAccessRestricted(checked === true)} className="mt-0.5">
                <span>
                  <span className="font-medium">受限事项</span>
                  <span className="ml-1 text-muted-foreground">
                    勾选后本案不进入律师团队汇总视图（团队负责人与额外查看人不再自动可见）；个人直接授权不受影响。
                  </span>
                </span>
              </Checkbox></div>
            </section>

      </fieldset>
    </FormDialogBody>
    <DialogFooter className="px-6 py-4">
      {error && <p role="alert" className="basis-full text-sm text-destructive">{error}</p>}
      <Button onClick={onCancel} disabled={isPending} htmlType="button" type="tertiary" theme="outline">取消</Button>
      <Button disabled={isPending || !dirty} htmlType="submit" theme="solid">{isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存案件信息</Button>
    </DialogFooter>
  </form>;
}
