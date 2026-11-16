"use client";

import { useEffect, useState, useTransition } from "react";
import type { LitigationStanding, ProcedureType } from "@prisma/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
        toast.success("案件信息已保存");
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
                <Label htmlFor="matter-title" className={formLabelClass}>案件名称</Label>
                <Input
                  id="matter-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="案件名称"
                  className={formControlClass}
                />
              </div>

              {isLitigationMatter ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>{matterMeta.category === "CRIMINAL" ? "涉嫌罪名" : "案由"}</Label>
                  <CauseCombobox
                    category={matterMeta.category}
                    procedureType={procedureType}
                    value={causeId}
                    onChange={(id) => setCauseId(id)}
                    triggerClassName={formControlClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>自由文本案由（不在标准库时填）</Label>
                  <Input
                    aria-label="自由文本案由"
                    value={causeFreeText}
                    onChange={(e) => setCauseFreeText(e.target.value)}
                    className={formControlClass}
                  />
                </div>
              </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {matterMeta.category !== "CRIMINAL" && categoryKind !== "counsel" ? (
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>{isLitigationMatter ? "标的额（元）" : "项目金额（元）"}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    aria-label={isLitigationMatter ? "标的额（元）" : "项目金额（元）"}
                    value={claimAmount}
                    onChange={(e) => setClaimAmount(e.target.value)}
                    placeholder="非金钱标的留空"
                    className={cn(formControlClass, "font-mono")}
                  />
                </div>
                ) : null}
                {isLitigationMatter ? (
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>我方诉讼地位</Label>
                  <Select
                    value={ourStanding || "unset"}
                    onValueChange={(v) => setOurStanding(v === "unset" ? "" : v as LitigationStanding)}
                  >
                    <SelectTrigger className={formControlClass}>
                      <SelectValue placeholder="选择地位" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">未设置</SelectItem>
                      {availableStandings.map((s) => (
                        <SelectItem key={s} value={s}>
                          {litigationStandingLabel[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                ) : null}
              </div>

              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs">
                <Checkbox
                  className="mt-0.5"
                  checked={teamAccessRestricted}
                  onCheckedChange={(checked) => setTeamAccessRestricted(checked === true)}
                />
                <span>
                  <span className="font-medium">受限事项</span>
                  <span className="ml-1 text-muted-foreground">
                    勾选后本案不进入律师团队汇总视图（团队负责人与额外查看人不再自动可见）；个人直接授权不受影响。
                  </span>
                </span>
              </label>
            </section>

      </fieldset>
    </FormDialogBody>
    <DialogFooter className="px-6 py-4">
      {error && <p role="alert" className="basis-full text-sm text-destructive">{error}</p>}
      <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>取消</Button>
      <Button type="submit" disabled={isPending || !dirty}>{isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存案件信息</Button>
    </DialogFooter>
  </form>;
}
