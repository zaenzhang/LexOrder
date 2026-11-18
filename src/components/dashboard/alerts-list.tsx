import { prisma } from "@/lib/prisma";
import { matterVisibilityFilter } from "@/lib/permissions";
import { matterHref } from "@/lib/matters/route";

export type AlertItem = {
  id: string;
  source: "preservation" | "sms" | "approval";
  title: string;
  detail: string;
  href: string;
  date: Date | null;
  tone: "danger" | "warn" | "ok" | "muted";
};

function classifyByDays(days: number): AlertItem["tone"] {
  if (days < 0) return "danger";
  if (days <= 3) return "danger";
  if (days <= 7) return "warn";
  if (days <= 30) return "muted";
  return "ok";
}

export async function loadAlerts(userId: string | null, role: string | null, managerAuthorized = false): Promise<AlertItem[]> {
  const now = new Date();
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const isManager = role === "PRINCIPAL_LAWYER" || managerAuthorized;

  const [preservationProperties, unprocessedSms, pendingSeals] = await Promise.all([
    userId && role
      ? prisma.preservationProperty.findMany({
          where: {
            status: { in: ["ACTIVE", "RENEWED"] },
            expiryDate: { lte: in30 },
            target: {
              case: {
                OR: [
                  { matter: { deletedAt: null, ...matterVisibilityFilter(userId, role) } },
                  { matterId: null, ownerId: userId }
                ]
              }
            }
          },
          orderBy: { expiryDate: "asc" },
          take: 6,
          select: {
            id: true,
            expiryDate: true,
            propertyType: true,
            target: {
              select: {
                name: true,
                case: {
                  select: {
                    matter: { select: { id: true, internalCode: true, title: true } }
                  }
                }
              }
            }
          }
        })
      : Promise.resolve([]),
    userId
      ? prisma.smsMessage.findMany({
          where: { receivedById: userId, processed: false },
          orderBy: { receivedAt: "desc" },
          take: 5,
          select: {
            id: true,
            smsType: true,
            parsedJson: true,
            receivedAt: true
          }
        })
      : Promise.resolve([]),
    // 待审批用章申请（仅管理员 / 主任律师可见，作为审批人提醒）
    isManager
      ? prisma.sealRequest.findMany({
          where: { status: "PENDING" },
          orderBy: { requestedAt: "asc" },
          take: 6,
          select: {
            id: true,
            documentTitle: true,
            purpose: true,
            requestedAt: true,
            matter: { select: { id: true, internalCode: true, title: true } }
          }
        })
      : Promise.resolve([])
  ]);

  const items: AlertItem[] = [];

  for (const p of preservationProperties) {
    const days = Math.ceil((p.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const label = days < 0 ? `保全已过期 ${-days} 天` : days === 0 ? "保全今日到期" : `保全 ${days} 天后到期`;
    const matter = p.target.case.matter;
    items.push({
      id: `pres-${p.id}`,
      source: "preservation",
      title: `${label} · ${p.target.name}`,
      detail: matter
        ? `${matter.internalCode} ${matter.title}`
        : "未关联案件（诉前保全）",
      href: matter ? matterHref(matter) : "/preservation",
      date: p.expiryDate,
      tone: classifyByDays(days)
    });
  }

  for (const m of unprocessedSms) {
    const parsed = (m.parsedJson as { summary?: string; court?: string } | null) ?? {};
    items.push({
      id: `sms-${m.id}`,
      source: "sms",
      title: parsed.summary || "未处理法院短信",
      detail: parsed.court ?? "—",
      href: "/inbox",
      date: m.receivedAt,
      tone: "warn"
    });
  }

  for (const s of pendingSeals) {
    items.push({
      id: `seal-${s.id}`,
      source: "approval",
      title: `待审批用章 · ${s.documentTitle}`,
      detail: s.matter ? `${s.matter.internalCode} ${s.matter.title}` : s.purpose,
      href: "/approvals/seals",
      date: s.requestedAt,
      tone: "warn"
    });
  }

  // 按 tone 优先（danger > warn > muted > ok），相同 tone 按时间近的优先
  const toneOrder = { danger: 0, warn: 1, muted: 2, ok: 3 };
  items.sort((a, b) => {
    if (toneOrder[a.tone] !== toneOrder[b.tone]) return toneOrder[a.tone] - toneOrder[b.tone];
    if (!a.date || !b.date) return 0;
    return a.date.getTime() - b.date.getTime();
  });

  return items.slice(0, 12);
}
