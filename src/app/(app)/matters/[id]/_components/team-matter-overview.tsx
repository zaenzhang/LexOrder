import { Tag } from "@douyinfe/semi-ui";
import Link from "next/link";
import { BookOpen, CalendarClock, ChevronLeft, Eye, Landmark, Users } from "lucide-react";
import type { getMatterById } from "@/server/matters/actions";
import { listNotes } from "@/server/notes/actions";
import { matterStatusLabel, matterCategoryLabel, matterCategoryKind, procedureTypeLabel, litigationStandingLabel } from "@/lib/enums";
import { avatarTone, matterStatusTone } from "@/lib/ui/moan-tones";
import { InitialAvatar } from "@/components/patterns/moan";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { ActionError } from "@/lib/action-error";
import { requireSession } from "@/lib/auth/session";
import { matterHref } from "@/lib/matters/route";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { procedureStateLabel } from "@/lib/procedure-status";

type Matter = NonNullable<Awaited<ReturnType<typeof getMatterById>>>;
const date = (value: Date | null) => (value ? formatDate(new Date(value)) : "—");

/**
 * 团队只读视图（与案件详情同一套墨案版式：案卷头 + 程序栏 + 主栏/侧栏）。
 * 只换外观，可见内容与权限不变：不加载财务与私有附件，业务操作按案件经办权限开放。
 */
export async function TeamMatterOverview({ matter }: { matter: Matter }) {
  const { user } = await requireSession("matters.read");
  const canReadNotes = hasCustomPermission(user, "schedule.read");
  const notesResult = canReadNotes
    ? await listNotes(matter.id).then(notes => ({ notes, error: "" })).catch(error => ({
      notes: null,
      error: error instanceof ActionError ? error.message : "记录暂不可读取，请稍后重试"
    }))
    : null;
  const roleText = (role: string) => (role === "LEAD" ? "主办" : role === "CO_LEAD" ? "协办" : "助理");
  const kind = matterCategoryKind(matter.category);
  const ours = matter.parties.filter((p) => p.role === "CLIENT_PARTY");
  const opposing = matter.parties.filter((p) => p.role === "OPPOSING_PARTY");
  const others = matter.parties.filter((p) => p.role !== "CLIENT_PARTY" && p.role !== "OPPOSING_PARTY");
  const claim = matter.claimAmount == null ? null : `¥${Number(matter.claimAmount).toLocaleString("zh-CN")}`;
  const order = { LEAD: 0, CO_LEAD: 1, ASSISTANT: 2 } as const;
  const members = [
    ...(matter.owner && !matter.members.some((m) => m.userId === matter.ownerId) ? [{ id: matter.owner.id, name: matter.owner.name, role: "LEAD" as const, roleName: (matter.owner as { roleName?: string }).roleName }] : []),
    ...matter.members.map((m) => ({ id: m.userId, name: m.user.name, role: m.role, roleName: m.user.roleName }))
  ].sort((a, b) => order[a.role] - order[b.role]);
  const partyStanding = (party: Matter["parties"][number]) =>
    party.standing ? litigationStandingLabel[party.standing] : party.role === "CLIENT_PARTY" ? "委托方" : party.role === "OPPOSING_PARTY" ? "相对方" : "其他当事人";

  return (
    <div className="mo-matter mo-dossier">
      {/* ① 案卷头 */}
      <section className="card dos-head" aria-label="案卷头">
        <div className="dos-head-top">
          <div className="min-w-0 flex-1">
            <div className="dos-eyebrow">
              <Link href="/matters" className="ctx-back no-underline">
                <ChevronLeft className="h-3.5 w-3.5" />
                案件列表
              </Link>
              <span className="code">{matter.internalCode}</span>
              {matter.firmCaseNo ? <span className="code">所内 {matter.firmCaseNo}</span> : null}
              <span>{[matterCategoryLabel[matter.category], matter.cause?.name ?? matter.causeFreeText].filter(Boolean).join(" · ")}</span>
            </div>
            <h1 className="ctx-title dos-title">{matter.title}</h1>
            <div className="dos-sides">
              <span className="k">委托方</span>
              <span className="v">{ours.map((p) => p.name).join("、") || matter.primaryClient?.name || "—"}</span>
              <span className="k">{kind === "litigation" ? "对方" : "主办"}</span>
              <span className="v">{kind === "litigation" ? opposing.map((p) => p.name).join("、") || "—" : matter.owner.name}</span>
            </div>
            <div className="ctx-badges">
              <span className={cn("badge", `b-${matterStatusTone(matter.status)}`)}>
                <span className="bdot" />
                {matterStatusLabel[matter.status]}
              </span>
              <span className="badge b-slate" title="你不在本案团队内，只能查看概况">
                <Eye className="h-3 w-3" />
                团队只读
              </span>
              {claim ? <span className="badge b-white">{kind === "litigation" ? "标的" : "金额"} <span className="mono">{claim}</span></span> : null}
              {matter.intakeDate ? <span className="badge b-white">收案 <span className="mono">{date(matter.intakeDate)}</span></span> : null}
              <span className="badge b-white">主办 {matter.owner.name}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ② 程序栏：只读，不能切换或新增 */}
      <section className="dos-procs" aria-label="程序">
        <div className="dos-procs-h">
          <span className="t">程序</span>
        </div>
        <div className="dos-procs-list">
          {matter.procedures.length === 0 ? (
            <span className="t-xs t-mute">暂无程序</span>
          ) : (
            matter.procedures.map((proc) => (
              <div key={proc.id} className="dos-proc">
                <div className="dos-proc-main">
                  <span className="top">
                    <span className="nm">{proc.customLabel ?? procedureTypeLabel[proc.type]}</span>
                    <span className={cn("badge", proc.status === "CONCLUDED" ? "b-slate" : proc.status === "IN_PROGRESS" ? "b-teal" : "b-white")} style={{ fontSize: 10 }}>
                      {procedureStateLabel(proc)}
                    </span>
                    {proc.engagement === "INFORMATIONAL" && <Tag color="grey">信息记录</Tag>}
                  </span>
                  <span className="no">{proc.caseNumber || "案号未登记"}</span>
                  <span className="ag">{proc.handlingAgency || "受理机构未登记"}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="dos-work">
        <div className="dos-main">
          {matter.procedures.map((proc) => {
            const stages = proc.stages.filter(stage => stage.status === "ACTIVE");
            const upcoming = [
              ...proc.hearings.map((h) => ({ id: h.id, at: h.startsAt, text: `开庭 · ${h.title}`, done: false })),
              ...proc.deadlines.map((d) => ({ id: d.id, at: d.dueAt, text: d.title, done: d.completed }))
            ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
            return (
              <section key={proc.id} className="card">
                <div className="panel-head">
                  <div className="panel-title">
                    <Landmark className="ic" strokeWidth={1.8} />
                    {proc.customLabel ?? procedureTypeLabel[proc.type]}
                    <span className="t-xs t-mute" style={{ fontWeight: 400 }}>{proc.caseNumber || "案号未登记"}</span>
                  </div>
                  <span className="t-xs t-mute">{procedureStateLabel(proc)}</span>
                </div>
                <div className="panel-body">
                  {stages.length > 0 ? <ul className="space-y-2" aria-label="已记录环节">
                    {stages.map(stage => <li key={stage.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{stage.name}</span>
                      <span className="text-xs text-muted-foreground">{stage.completedAt ? `已记录完成 · ${date(stage.completedAt)}` : stage.startedAt ? `已记录开始 · ${date(stage.startedAt)}` : "未记录进度"}</span>
                    </li>)}
                  </ul> : <p className="t-xs t-mute">尚未创建环节</p>}
                  <div className="mt-3 space-y-1.5">
                    {!canReadNotes ? <p className="t-xs t-mute">无日程查看权限</p> : upcoming.length === 0 ? (
                      <p className="t-xs t-mute">暂无开庭与期限</p>
                    ) : (
                      upcoming.map((u) => (
                        <div key={u.id} className="flex items-center gap-3 text-[12.5px]">
                          <span className="w-[120px] shrink-0 font-mono text-[12px] text-[var(--t-secondary)]">{formatDateTime(u.at)}</span>
                          <span className={u.done ? "t-mute line-through" : ""}>{u.text}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            );
          })}

          {notesResult ? <section className="card" aria-label="记录">
            <div className="panel-head">
              <div className="panel-title">
                <BookOpen className="ic" strokeWidth={1.8} />
                记录
                {notesResult.notes ? <span className="badge b-white" style={{ marginLeft: 2 }}>{notesResult.notes.length}</span> : null}
              </div>
            </div>
            {notesResult.notes === null ? (
              <div className="panel-body">
                <p className="t-xs text-destructive" role="alert">记录读取失败：{notesResult.error}</p>
                <a href={matterHref(matter)} className="mt-2 inline-block t-xs underline underline-offset-2">重新加载</a>
              </div>
            ) : notesResult.notes.length === 0 ? (
              <div className="panel-body t-xs t-mute">暂无记录</div>
            ) : (
              <div className="panel-body space-y-3">
                {notesResult.notes.map((note) => (
                  <div key={note.id} className="border-b border-[var(--bd-hair)] pb-3 last:border-0 last:pb-0">
                    <div className="t-xs t-mute">
                      {note.author.name} · {formatDateTime(note.occurredAt)}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed">{note.content}</p>
                  </div>
                ))}
              </div>
            )}
          </section> : null}

          <section className="card">
            <div className="panel-head">
              <div className="panel-title">
                <CalendarClock className="ic" strokeWidth={1.8} />
                案件进展
              </div>
            </div>
            {matter.timelineEvents.length === 0 ? (
              <div className="panel-body t-xs t-mute">暂无进展</div>
            ) : (
              <div className="panel-body">
                <div className="timeline">
                  {matter.timelineEvents.map((event) => (
                    <div key={event.id} className="tl-item">
                      <div className="text-[12.5px] font-medium">{event.title}</div>
                      <div className="t-xs t-mute">{date(event.occurredAt)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="dos-rail">
          <section className="card">
            <div className="rail-sec-head">
              <Users className="h-[15px] w-[15px] text-[var(--t-muted)]" strokeWidth={1.8} />
              承办团队
            </div>
            {members.length === 0 ? (
              <div className="panel-body t-xs t-mute">暂无团队成员</div>
            ) : (
              members.map((m) => (
                <div key={`${m.id}-${m.role}`} className="member">
                  <InitialAvatar name={m.name} tone={avatarTone(m.name)} />
                  <div className="min-w-0">
                    <div className="n truncate">{m.name}</div>
                    <div className="r truncate">{m.roleName ?? "—"}</div>
                  </div>
                  <span className={cn("badge role-tag", m.role === "LEAD" ? "b-teal" : "b-slate")} style={{ fontSize: 10 }}>
                    {roleText(m.role)}
                  </span>
                </div>
              ))
            )}
            <div className="panel-body" style={{ padding: "8px 14px" }}>
              <span className="t-xs t-mute">原始立案人 {matter.registeredBy?.name ?? "历史记录未确认"}</span>
            </div>
          </section>

          <section className="card">
            <div className="rail-sec-head">
              当事人
              <span className="badge b-white" style={{ marginLeft: 2 }}>{matter.parties.length}</span>
            </div>
            {matter.parties.length === 0 ? (
              <div className="panel-body t-xs t-mute">暂无当事人</div>
            ) : (
              [...ours, ...opposing, ...others].map((party) => (
                <div key={party.id} className="member" style={{ alignItems: "flex-start" }}>
                  <div className="min-w-0 flex-1">
                    <div className="n truncate">{party.name}</div>
                    <div className="r truncate">{partyStanding(party)}</div>
                  </div>
                </div>
              ))
            )}
          </section>

          <p className="t-xs t-mute px-1">团队只读视图：财务、材料下载和业务操作按案件经办权限开放。</p>
        </aside>
      </div>
    </div>
  );
}
