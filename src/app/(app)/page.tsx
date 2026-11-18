import { formatDeadlineDue } from "@/lib/deadline-due";
/**
 * 工作台：今日行动与风险（问候 + 今日焦点）→ 行动入口四卡 →
 * 近期日程与期限 + 待我处理 → 趋势与分布（实收应收 / 案件类型 / 客户来源）。
 */
import Link from "next/link";
import { Card, Empty, Tag } from "@/components/patterns/semi-surfaces";
import { IconChevronRight as ChevronRight, IconVerify as Gavel, IconCheckList as SquareCheck, IconDuration as Timer, IconAlertTriangle as TriangleAlert, IconCalendar as CalendarIcon, IconApartment as Landmark, IconClock as Clock3, IconHistogram as ChartColumn } from "@douyinfe/semi-icons";
import { getSession } from "@/lib/auth/session";
import { canEnterAdminWorkspace } from "@/lib/auth/system-role";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { isEmailConfigured } from "@/lib/notifications/email";
import { lunarDateLabel } from "@/lib/ui/lunar";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { CategoryChart } from "@/components/dashboard/category-chart";
import { ClientSourceCard } from "@/components/dashboard/client-source-card";
import { WorkQueueCard } from "@/components/dashboard/work-queue-card";
import { EmailReminderNotice } from "@/components/dashboard/email-reminder-notice";
import { loadAlerts } from "@/components/dashboard/alerts-list";
import { matterHref } from "@/lib/matters/route";
import {
  getDashboardRevenueTrend,
  getDashboardCategoryDistribution,
  getDashboardSchedule,
  getDashboardHeroData,
  getDashboardWorkQueue,
  getDashboardOverdueReceivables,
  getDashboardClientSources
} from "@/server/dashboard/actions";

const money = (n: number) => (n >= 1_000_000 ? `¥${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M` : n >= 10_000 ? `¥${Math.round(n / 1000)}K` : `¥${Math.round(n).toLocaleString("zh-CN")}`);

export default async function DashboardPage() {
  const session = await getSession();
  const canFinance = Boolean(session?.user && hasCustomPermission(session.user, "finance.read"));
  const [revenueTrend, categoryDistribution, scheduleItems, hero, alerts, queue, overdue, sources] = await Promise.all([
    getDashboardRevenueTrend(),
    getDashboardCategoryDistribution(),
    getDashboardSchedule(),
    getDashboardHeroData(),
    loadAlerts(session?.user.id ?? null, session?.user.role ?? null, session?.user.managerAuthorized === true),
    getDashboardWorkQueue(),
    getDashboardOverdueReceivables().catch(() => null),
    getDashboardClientSources().catch(() => [])
  ]);

  const now = new Date();
  const name = session?.user?.name ?? "";
  const hour = Number(now.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Shanghai" }));
  const greeting = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 13 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const ymd = now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).replace(/\//g, " / ");
  const weekday = now.toLocaleDateString("zh-CN", { weekday: "short", timeZone: "Asia/Shanghai" });
  const lunar = lunarDateLabel(now);

  const focus = hero.focus;
  const focusHref = focus?.href ?? "/schedule";
  const urgentApprovals = queue.approvals.filter((a) => a.waitDays !== null && a.waitDays >= 2).length;

  // 只列最近 3 条：与右侧「待我处理」卡高度对齐，更多进完整日历（2026-09-19 用户确认）
  const SCHEDULE_PREVIEW = 3;
  const groups = scheduleItems.slice(0, SCHEDULE_PREVIEW).reduce<Record<string, typeof scheduleItems>>((acc, it) => {
    (acc[`${it.date}|${it.weekday}`] ??= []).push(it);
    return acc;
  }, {});

  const metrics = [
    { href: "/approvals", label: urgentApprovals ? `待我审批 · ${urgentApprovals} 件等待超 2 天` : "待我审批", value: queue.approvalTotal, icon: SquareCheck, color: "var(--semi-color-danger)" },
    { href: "/schedule", label: hero.overdueDeadlineCount ? `7 日内到期期限 · 另有逾期 ${hero.overdueDeadlineCount}` : "7 日内到期期限", value: hero.nearTermCount, icon: Timer, color: "var(--semi-color-warning)" },
    { href: "/schedule", label: "本周开庭", value: hero.weekHearingCount, icon: Landmark, color: "var(--semi-color-primary)" },
    canFinance && overdue
      ? { href: "/finance?tab=aging", label: overdue.clientCount && overdue.amount ? `逾期未回款 · ${overdue.clientCount} 家客户` : "逾期未回款", value: overdue.amount ? money(overdue.amount) : "¥0", icon: ChartColumn, color: "var(--semi-color-warning)" }
      : { href: "/schedule", label: "逾期期限 · 需立即处理", value: hero.overdueDeadlineCount, icon: TriangleAlert, color: "var(--semi-color-danger)" }
  ];

  return (
    <div className="grid min-w-0 gap-4">
      {session?.user && canEnterAdminWorkspace(session.user) && !isEmailConfigured() ? <EmailReminderNotice /> : null}
      <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <p className="mb-2 text-xs text-[var(--semi-color-text-2)]">{ymd} · {weekday}{lunar ? ` · ${lunar}` : ""}</p>
          <h1 className="mb-3 text-2xl font-semibold">{greeting}{name ? `，${name}` : ""}</h1>
          <p className="text-sm text-[var(--semi-color-text-1)]">
            今日到期期限 <b>{hero.todayDeadlineCount}</b> 项；本周开庭 <b>{hero.weekHearingCount}</b> 场
            {queue.followUps.available && queue.followUps.total > 0 ? <>；本人待跟进 <b>{queue.followUps.total}</b> 项</> : null}
            {hero.overdueDeadlineCount > 0 ? <>；<b className="text-[var(--semi-color-danger)]">{hero.overdueDeadlineCount} 项期限已逾期</b></> : null}
            ；待你审批 <b>{queue.approvalTotal}</b> 件。
          </p>
        </Card>
        <Link href={focusHref} className="min-w-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--semi-color-primary)]">
          <Card title="今日焦点" shadows="hover" className="h-full" headerExtraContent={<span className="text-[var(--semi-color-primary)]">前往{focus ? "案件" : "日程"}</span>}>
            {focus ? (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag color={focus.overdue ? "red" : "amber"}>{focus.overdue ? "逾期期限" : "最近期限"}</Tag>
                  <strong>{focus.overdue && focus.daysLeft === 0 ? "已逾期" : Math.abs(focus.daysLeft)}</strong>
                  {!(focus.overdue && focus.daysLeft === 0) ? <span>{focus.overdue ? "天 · 已逾期" : focus.daysLeft === 0 ? "天 · 今天到期" : "天"}</span> : null}
                </div>
                <div className="text-sm"><span className="font-medium">{focus.title}</span> · {formatDeadlineDue(focus.dueAt, focus.duePrecision)}</div>
                <p className="truncate text-xs text-[var(--semi-color-text-2)]">{[focus.matter, focus.internalCode, focus.procedure].filter(Boolean).join(" · ")}</p>
              </div>
            ) : <Empty description="暂无未完成期限" />}
          </Card>
        </Link>
      </section>

      <section aria-label="行动入口" className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ href, label, value, icon: Icon, color }) => (
          <Link key={label} href={href} className="min-w-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--semi-color-primary)]">
            <Card shadows="hover" className="h-full">
              <div className="flex items-center gap-3">
                <Icon size="large" style={{ color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-xl font-semibold tabular-nums" style={{ color: value && value !== "¥0" ? color : "var(--semi-color-text-2)" }}>{value}</div>
                  <div className="text-xs leading-relaxed text-[var(--semi-color-text-2)]">{label}</div>
                </div>
                <ChevronRight size="default" aria-hidden />
              </div>
            </Card>
          </Link>
        ))}
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <Card
          title={<h2 className="flex items-center gap-2"><CalendarIcon size="default" aria-hidden />近期日程与期限</h2>}
          headerExtraContent={<Link href="/schedule" className="text-[var(--semi-color-primary)]">完整日历</Link>}
        >
          {Object.keys(groups).length === 0 ? <Empty description="未来 30 天暂无开庭与期限" /> : (
            <div className="grid gap-4">
              {Object.entries(groups).map(([key, items]) => {
                const [day, week] = key.split("|");
                return (
                  <section key={key}>
                    <h3 className="mb-2 text-xs font-medium text-[var(--semi-color-text-2)]">{day} · {week}</h3>
                    {items.map((it) => {
                      const isDeadline = it.type === "deadline";
                      const d = it.daysUntil;
                      const label = it.overdue && d === 0 ? "已逾期" : d < 0 ? `逾期 ${-d} 天` : d === 0 ? "今天" : d === 1 ? "明天" : `${d} 天`;
                      const Icon = isDeadline ? Clock3 : Gavel;
                      const row = (
                        <>
                          <span className="shrink-0 text-xs text-[var(--semi-color-text-2)]">{it.time ?? (isDeadline && it.duePrecision == null ? "精度未记录" : "全天")}</span>
                          <Icon size="default" className="shrink-0 text-[var(--semi-color-primary)]" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{isDeadline || /^(开庭|庭审|询问)/.test(it.title) ? it.title : `开庭 · ${it.title}`}</span>
                            <span className="block truncate text-xs text-[var(--semi-color-text-2)]">{[it.matter, it.procedure].filter(Boolean).join(" · ")}</span>
                          </span>
                          <Tag color={d <= 3 ? "red" : d <= 7 ? "amber" : "grey"}>{label}</Tag>
                        </>
                      );
                      const rowClass = "flex items-center gap-2 rounded px-2 py-2";
                      return it.matterId
                        ? <Link key={it.id} href={matterHref({ id: it.matterId, internalCode: it.matterCode })} className={`${rowClass} hover:bg-[var(--semi-color-fill-0)]`}>{row}</Link>
                        : <div key={it.id} className={rowClass}>{row}</div>;
                    })}
                  </section>
                );
              })}
            </div>
          )}
        </Card>
        <WorkQueueCard queue={queue} alerts={alerts} />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {canFinance ? <RevenueChart data={revenueTrend} /> : (
          <Card title="近 6 个月实收与应收"><Empty description="实收与应收趋势仅对具备财务查看权限的账号展示。" /></Card>
        )}
        <div className="grid min-w-0 gap-4">
          <CategoryChart data={categoryDistribution} />
          <ClientSourceCard rows={sources} />
        </div>
      </div>
    </div>
  );
}
