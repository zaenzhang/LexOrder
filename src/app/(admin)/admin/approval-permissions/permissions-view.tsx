"use client";
import { Button, Checkbox, Form, Input, Select, TextArea, Toast } from "@douyinfe/semi-ui";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ApprovalAction, MatterCategory, SealType } from "@prisma/client";
import { ACTION_LABELS } from "@/lib/approvals/rules";
import { matterCategoryLabel } from "@/lib/enums";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPermissionAdministration, savePermissionGroup, saveSealPurpose, saveApprovalSettings, type PermissionGroupInput } from "@/server/approval-permissions/actions";
import { AdminPageHeader } from "@/components/layout/admin-page-header";
import { actionErrorMessage } from "@/lib/action-error";

type Data = Awaited<ReturnType<typeof getPermissionAdministration>>;
const sealLabels: Record<SealType, string> = { OFFICIAL_SEAL: "律所公章", CONTRACT_SEAL: "合同专用章", FINANCE_SEAL: "财务专用章", LEGAL_REP_SEAL: "法定代表人章", CONTRACT_REVIEW_SEAL: "合同审核章" };
const blankRule = (): PermissionGroupInput["rules"][number] => ({ action: "INTAKE_APPROVE", caseScope: "CATEGORIES", categories: [], allSealPurposes: false, purposeId: null, sealTypes: [] });
const blankGroup = (): PermissionGroupInput => ({ name: "", description: "", active: true, userIds: [], rules: [blankRule()] });
function Checks<T extends string>({ label, options, values, onChange }: { label: string; options: [T, string][]; values: T[]; onChange: (values: T[]) => void }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">{label}</legend><div className="flex flex-wrap gap-x-5 gap-y-2">{options.map(([id, text]) => <Checkbox key={id} checked={values.includes(id)} onChange={e => onChange((e.target.checked === true) ? [...values, id] : values.filter(v => v !== id))}>{text}</Checkbox>)}</div></fieldset>;
}
export function PermissionAdministration({ data }: { data: Data }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [group, setGroup] = useState<PermissionGroupInput | null>(null);
  const [purpose, setPurpose] = useState<{ id?: string; name: string; description: string; active: boolean; allowedSealTypes: SealType[] } | null>(null);
  const [query, setQuery] = useState("");
  const [allowSelf, setAllowSelf] = useState(data.settings.allowSelfApproval);
  function run(fn: () => Promise<unknown>, close?: () => void) { start(async () => { try { await fn(); close?.(); router.refresh(); Toast.success("已保存"); } catch (e) { Toast.error(e instanceof Error ? actionErrorMessage(e) : "保存失败"); } }); }
  function patchRule(index: number, patch: Partial<PermissionGroupInput["rules"][number]>) { if (group) setGroup({ ...group, rules: group.rules.map((r, i) => i === index ? { ...r, ...patch } : r) }); }
  return <div className="space-y-6">
    <AdminPageHeader title="审批权限" sub="审批资格与系统管理身份分开，所有人员均按案件类别和具体事项分配审批权限。" />
    <section className="rounded-xl border bg-card p-5 space-y-3"><h3 className="font-medium">按事项授权</h3>
      <p className="text-sm text-muted-foreground">系统超级管理员也必须加入相应权限组才可处理收案、文书、归档、开票、用章审批及盖章回填；仍须遵守本人审批限制，审批法定代表人章时须核对当前法定代表人。停用权限组或移除账号立即生效；无可审批人员时无法提交。</p>
      <Checkbox disabled={pending} checked={allowSelf} onChange={event => setAllowSelf(event.target.checked === true)}>允许审批本人申请（仅适用于单人执业，仍须具备对应授权）</Checkbox>
      <Button theme="solid" loading={pending} disabled={pending} onClick={() => run(() => saveApprovalSettings({ allowSelfApproval: allowSelf }))}>保存本人审批设置</Button>
    </section>
    <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">权限组</h3><Button theme="solid" size="small" onClick={() => setGroup(blankGroup())}>新增权限组</Button></div>
      {!data.groups.length && <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">先建立“民事收案审批”等权限组，再勾选负责人员。一个人可以加入多个权限组。</p>}
      {data.groups.map(g => <div key={g.id} className="rounded-xl border bg-card p-4"><div className="flex items-center justify-between"><div><h4 className="font-medium">{g.name} {!g.active && <span className="text-muted-foreground">· 已停用</span>}</h4><p className="text-sm text-muted-foreground">{g.description}</p></div><Button theme="outline" size="small" onClick={() => setGroup({ id: g.id, name: g.name, description: g.description ?? "", active: g.active, userIds: g.members.map(m => m.userId), rules: g.rules.map(r => ({ action: r.action, caseScope: r.caseScope, categories: r.categories, allSealPurposes: r.allSealPurposes, purposeId: r.purposeId, sealTypes: r.sealTypes })) })}>编辑</Button></div>
        <ul className="my-3 space-y-1 text-sm">{g.rules.map(r => <li key={r.id}>{ACTION_LABELS[r.action]} · {r.caseScope === "ALL_CASES" ? "全部案件" : r.caseScope === "NON_CASE" ? "非案件事项" : r.categories.map(c => matterCategoryLabel[c]).join("、")}{r.action.startsWith("SEAL_") && <> · {r.allSealPurposes ? "全部用章事项" : data.purposes.find(p => p.id === r.purposeId)?.name ?? "事项已失效"} · {r.sealTypes.map(t => sealLabels[t]).join("、")}</>}</li>)}</ul>
        <p className="text-xs text-muted-foreground">负责人员：{g.members.map(m => data.users.find(u => u.id === m.userId)?.name).join("、") || "尚未分配"}</p></div>)}
    </section>
    <section className="space-y-3"><div className="flex justify-between"><h3 className="font-semibold">用章事项</h3><Button size="small" theme="outline" onClick={() => setPurpose({ name: "", description: "", active: true, allowedSealTypes: [] })}>新增事项</Button></div><p className="text-sm text-muted-foreground">例如委托合同、所函介绍信、顾问合同审核、财务文件、行政文件。</p>
      {data.purposes.map(p => <div key={p.id} className="flex items-center justify-between rounded-lg border bg-card p-3"><div className="text-sm">{p.name}{!p.active && " · 已停用"}<p className="text-xs text-muted-foreground">{p.allowedSealTypes.map(t => sealLabels[t]).join("、")}</p></div><Button size="small" theme="borderless" type="tertiary" onClick={() => setPurpose({ id: p.id, name: p.name, description: p.description ?? "", active: p.active, allowedSealTypes: p.allowedSealTypes })}>编辑</Button></div>)}
    </section>

    <Dialog open={!!group} onOpenChange={open => { if (!open && !pending) setGroup(null); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{group?.id ? "编辑权限组" : "新增权限组"}</DialogTitle></DialogHeader>{group && <form className="space-y-5" onSubmit={e => { e.preventDefault(); run(() => savePermissionGroup(group), () => setGroup(null)); }}>
      <div className="space-y-1.5"><Form.Label name="permission-group-name" required>权限组名称</Form.Label><Input id="permission-group-name" required disabled={pending} maxLength={60} value={group.name} onChange={value => setGroup({ ...group, name: value })} placeholder="例如：民事案件审批" /></div>
      <div className="space-y-1.5"><Form.Label name="permission-group-description">职责说明</Form.Label><TextArea id="permission-group-description" disabled={pending} value={group.description} onChange={value => setGroup({ ...group, description: value })} maxLength={300} /></div>
      <Checkbox checked={group.active} onChange={e => setGroup({ ...group, active: (e.target.checked === true) })}>启用此权限组</Checkbox>
      {group.rules.map((r, i) => <fieldset key={i} disabled={pending} className="space-y-3 rounded-xl border p-4">
        <legend className="px-1 text-sm">授权规则 {i + 1}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Form.Label id={`permission-rule-${i}-action`}>审批事项</Form.Label>
            <Select aria-labelledby={`permission-rule-${i}-action`} className="w-full" disabled={pending} filter value={r.action} onChange={value => patchRule(i, { action: value as ApprovalAction })}>
              {Object.entries(ACTION_LABELS).map(([id, label]) => <Select.Option key={id} value={id}>{label}</Select.Option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Form.Label id={`permission-rule-${i}-scope`}>案件范围</Form.Label>
            <Select aria-labelledby={`permission-rule-${i}-scope`} className="w-full" disabled={pending} value={r.caseScope} onChange={value => patchRule(i, { caseScope: value as typeof r.caseScope })}>
              <Select.Option value="CATEGORIES">指定案件类别</Select.Option>
              <Select.Option value="ALL_CASES">全部案件类别</Select.Option>
              <Select.Option value="NON_CASE">非案件事项</Select.Option>
            </Select>
          </div>
        </div>
        {r.caseScope === "CATEGORIES" && <Checks label="案件类别（至少一项）" options={Object.values(MatterCategory).map(c => [c, matterCategoryLabel[c]])} values={r.categories} onChange={categories => patchRule(i, { categories })} />}
        {r.action.startsWith("SEAL_") && <><div className="space-y-1.5">
          <Form.Label id={`permission-rule-${i}-purpose`}>用章事项</Form.Label>
          <Select<string>
            aria-labelledby={`permission-rule-${i}-purpose`} className="w-full" disabled={pending}
            value={r.allSealPurposes ? "ALL" : r.purposeId ?? ""} onChange={value => patchRule(i, { allSealPurposes: value === "ALL", purposeId: typeof value === "string" && value && value !== "ALL" ? value : null })}
          >
            <Select.Option value="">请选择事项</Select.Option>
            <Select.Option value="ALL">全部用章事项（含以后新增）</Select.Option>
            {data.purposes.filter(p => p.active).map(p => <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>)}
          </Select>
        </div><Checks label="印章类型（至少一项）" options={Object.entries(sealLabels) as [SealType, string][]} values={r.sealTypes} onChange={sealTypes => patchRule(i, { sealTypes })} /></>}
        {group.rules.length > 1 && <Button htmlType="button" size="small" theme="borderless" type="tertiary" onClick={() => setGroup({ ...group, rules: group.rules.filter((_, n) => n !== i) })}>移除此规则</Button>}
      </fieldset>)}<Button htmlType="button" theme="outline" onClick={() => setGroup({ ...group, rules: [...group.rules, blankRule()] })}>增加授权规则</Button>
      <div className="space-y-3"><Input aria-label="搜索负责人员" placeholder="搜索负责人员" value={query} onChange={value => setQuery(value)} /><Checks label="分配给账号（支持多选）" options={data.users.filter(u => u.name.includes(query)).map(u => [u.id, `${u.name}${u.active ? "" : "（停用）"}`])} values={group.userIds} onChange={userIds => setGroup({ ...group, userIds })} /></div><Button theme="solid" htmlType="submit" loading={pending} disabled={pending}>保存权限组</Button>
    </form>}</DialogContent></Dialog>
    <Dialog open={!!purpose} onOpenChange={open => { if (!open && !pending) setPurpose(null); }}><DialogContent><DialogHeader><DialogTitle>用章事项</DialogTitle></DialogHeader>{purpose && <form className="space-y-4" onSubmit={e => { e.preventDefault(); run(() => saveSealPurpose(purpose), () => setPurpose(null)); }}><div className="space-y-1.5"><Form.Label name="seal-purpose-name" required>事项名称</Form.Label><Input id="seal-purpose-name" required disabled={pending} value={purpose.name} onChange={value => setPurpose({ ...purpose, name: value })} /></div><div className="space-y-1.5"><Form.Label name="seal-purpose-description">说明</Form.Label><TextArea id="seal-purpose-description" disabled={pending} value={purpose.description} onChange={value => setPurpose({ ...purpose, description: value })} /></div><Checks label="允许使用的印章" options={Object.entries(sealLabels) as [SealType, string][]} values={purpose.allowedSealTypes} onChange={allowedSealTypes => setPurpose({ ...purpose, allowedSealTypes })} /><Checkbox checked={purpose.active} onChange={e => setPurpose({ ...purpose, active: (e.target.checked === true) })}>启用事项</Checkbox><Button htmlType="submit" theme="solid" loading={pending} disabled={pending}>保存事项</Button></form>}</DialogContent></Dialog>
  </div>;
}
