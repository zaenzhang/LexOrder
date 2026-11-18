"use client";
import { Avatar, Button, Input, RadioGroup, Notification, Toast } from "@douyinfe/semi-ui";
import { customOrLegacy, hasCustomPermission, scopeFor, type RoleGrant } from "@/lib/roles/catalog";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlus as Plus, IconEdit as Pencil, IconArchive as Archive, IconTick as Check, IconClear as XCircle } from "@douyinfe/semi-icons";
import type { ExternalContactCategory, ExternalContactStatus } from "@prisma/client";

import { userRoleLabel } from "@/lib/enums";
import { ExternalContactDialog } from "./external-contact-dialog";
import {
  approveExternalContact,
  archiveExternalContact,
  rejectExternalContact
} from "@/server/external-contacts/actions";
import { PageHeader } from "@/components/patterns/workspace-surfaces";
import { confirmDialog, promptDialog } from "@/components/patterns/confirm-dialog";
import { actionErrorMessage } from "@/lib/action-error";
import type { RuntimeMode } from "@/lib/runtime/mode";

type ColleagueItem = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string; roleName?: string;
  avatar: string | null;
};

type ExternalContactItem = {
  id: string;
  name: string;
  category: ExternalContactCategory;
  organization: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
  status: ExternalContactStatus;
  createdBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
};

const EXT_CATEGORY_LABEL: Record<ExternalContactCategory, string> = {
  COURT: "法院",
  PROSECUTOR: "检察院",
  POLICE: "公安",
  NOTARY: "公证处",
  ARBITRATION: "仲裁",
  OTHER_FIRM: "他所律师",
  EXPERT: "鉴定专家",
  OTHER: "其他"
};

export function ContactsView({
  colleagues,
  externalContacts,
  currentUserId,
  currentUserRole,
  rolePermissions,
  managerAuthorized,
  runtimeMode = "SERVER"
}: {
  colleagues: ColleagueItem[];
  externalContacts: ExternalContactItem[];
  currentUserId: string;
  currentUserRole: string;
  rolePermissions?: RoleGrant[];
  managerAuthorized?: boolean;
  runtimeMode?: RuntimeMode;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExternalContactItem | null>(null);
  const [filter, setFilter] = useState<ExternalContactCategory | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const router = useRouter();
  const personal = runtimeMode === "PERSONAL";
  const roleUser = { role: currentUserRole, rolePermissions, managerAuthorized, runtimeMode };
  const canReviewContacts = personal || customOrLegacy(roleUser, "contacts.review", currentUserRole === "PRINCIPAL_LAWYER" || managerAuthorized === true);
  const pendingCount = externalContacts.filter((c) => c.status === "PENDING_REVIEW").length;

  const filteredExternal = externalContacts.filter((c) => {
    if (filter !== "ALL" && c.category !== filter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hit =
        c.name.toLowerCase().includes(q) ||
        (c.organization && c.organization.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q));
      if (!hit) return false;
    }
    return true;
  });

  async function handleArchive(c: ExternalContactItem) {
    if (!(await confirmDialog({ title: `归档联系人「${c.name}」？`, description: "归档后不再在通讯录中展示，历史引用保留。", confirmText: "归档" }))) return;
    try {
      await archiveExternalContact(c.id);
      Toast.success("已归档");
      router.refresh();
    } catch (err) {
      Notification.error({ title: "归档失败", content: actionErrorMessage(err), duration: 6 });
    }
  }

  async function handleApprove(c: ExternalContactItem) {
    if (!(await confirmDialog({ title: personal ? `确认联系人「${c.name}」？` : `通过联系人「${c.name}」？`, description: personal ? undefined : "通过后将对全所展示。", confirmText: personal ? "本人确认" : "通过" }))) return;
    try {
      await approveExternalContact({ id: c.id });
      Toast.success(personal ? "本人已确认" : "已通过");
      router.refresh();
    } catch (err) {
      Notification.error({ title: "审核失败", content: actionErrorMessage(err), duration: 6 });
    }
  }

  async function handleReject(c: ExternalContactItem) {
    const note = await promptDialog({ title: `驳回联系人「${c.name}」`, label: "驳回原因（可选）", confirmText: "驳回", danger: true });
    if (note === null) return;
    try {
      await rejectExternalContact({ id: c.id, note });
      Toast.success("已驳回");
      router.refresh();
    } catch (err) {
      Notification.error({ title: "审核失败", content: actionErrorMessage(err), duration: 6 });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader className="!mb-0" title="通讯录" sub={personal ? undefined : "本所同事与外部联系人（法院、仲裁机构、公证处、他所律师等）；外部联系人由行政审核后对全所展示。"} />

      {/* 同事 */}
      {!personal && <div className="space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-medium">本所同事 ({colleagues.length})</h2>
        </header>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {colleagues.map((u) => (
            <div key={u.id} className="flex items-start gap-3 ll-surface p-3">
              <Avatar size="default" src={u.avatar ?? undefined} alt={u.name}>{u.name.charAt(0)}</Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{u.name}</div>
                <div className="text-xs text-muted-foreground">
                  {u.roleName ?? userRoleLabel[u.role as keyof typeof userRoleLabel] ?? u.role}
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-foreground/80">
                  <div className="truncate font-mono">{u.email}</div>
                  {u.phone && <div className="font-mono">{u.phone}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {/* 外部联系人 */}
      <div className="space-y-3">
        <header className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            外部联系人 ({externalContacts.length})
            {canReviewContacts && pendingCount > 0 && (
              <span className="rounded-full border border-[var(--semi-color-warning-light-active)] bg-[var(--semi-color-warning-light-default)] px-2 py-0.5 text-xs font-medium text-[var(--semi-color-warning)]">
                {personal ? "待确认" : "待审核"} {pendingCount}
              </span>
            )}
          </h2>
          <Button theme="outline" htmlType="button"
            size="small"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            className="gap-1.5"
          >
            <Plus aria-hidden size="small" />
            新增
          </Button>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <RadioGroup type="button" buttonSize="small" aria-label="联系人类别" value={filter}
            options={[{ value: "ALL", label: "全部" }, ...(Object.keys(EXT_CATEGORY_LABEL) as ExternalContactCategory[]).map(value => ({ value, label: EXT_CATEGORY_LABEL[value] }))]}
            onChange={event => setFilter(event.target.value as ExternalContactCategory | "ALL")}
          />
          <Input
            type="text"
            value={search}
            onChange={(value) => setSearch(value)}
            aria-label="搜索联系人" placeholder="搜索姓名 / 单位 / 电话"
            className="ml-auto w-48"
          />
        </div>

        {filteredExternal.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-background py-8 text-center text-xs text-muted-foreground">
            暂无匹配联系人
          </p>
        ) : (
          <ul className="space-y-1.5">
            {filteredExternal.map((c) => {
              const canEdit =
                hasCustomPermission(roleUser, "contacts.manage") && (currentUserRole === "PRINCIPAL_LAWYER" || managerAuthorized === true ||
                scopeFor(roleUser, "contacts.manage") === "ALL" || c.createdBy.id === currentUserId);
              return (
                <li
                  key={c.id}
                  className="flex items-start gap-3 ll-surface p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {EXT_CATEGORY_LABEL[c.category]}
                      </span>
                      {c.status === "PENDING_REVIEW" && (
                        <span className="rounded-full border border-[var(--semi-color-warning-light-active)] bg-[var(--semi-color-warning-light-default)] px-2 py-0.5 text-xs font-medium text-[var(--semi-color-warning)]">
                          {personal ? "待确认" : "待审核"}
                        </span>
                      )}
                      {c.title && (
                        <span className="text-xs text-muted-foreground">{c.title}</span>
                      )}
                    </div>
                    {c.organization && (
                      <div className="text-xs text-foreground/80">{c.organization}</div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-foreground/80">
                      {c.phone && <span className="font-mono">{c.phone}</span>}
                      {c.email && <span className="font-mono">{c.email}</span>}
                      {c.wechat && <span>微信 {c.wechat}</span>}
                    </div>
                    {c.address && (
                      <div className="mt-0.5 text-xs text-muted-foreground">{c.address}</div>
                    )}
                    {c.notes && (
                      <div className="mt-1 text-xs italic text-muted-foreground">{c.notes}</div>
                    )}
                    {c.status === "PENDING_REVIEW" && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        提交人：{c.createdBy.name}
                      </div>
                    )}
                  </div>
                  {(canEdit || (canReviewContacts && c.status === "PENDING_REVIEW")) && (
                    <div className="flex flex-col items-end gap-1">
                      {canReviewContacts && c.status === "PENDING_REVIEW" && (
                        <div className="flex gap-1">
                          <Button
                            htmlType="button"
                            theme="borderless"
                            size="small"
                            onClick={() => handleApprove(c)}
                            className="gap-1"
                          >
                            <Check aria-hidden size="small" />
                            {personal ? "本人确认" : "通过"}
                          </Button>
                          <Button
                            htmlType="button"
                            theme="borderless"
                            size="small"
                            type="danger"
                            onClick={() => handleReject(c)}
                            className="gap-1"
                          >
                            <XCircle aria-hidden size="small" />
                            驳回
                          </Button>
                        </div>
                      )}
                      {canEdit && (
                        <>
                          <Button
                            htmlType="button"
                            theme="borderless"
                            size="small"
                            aria-label={`编辑联系人 ${c.name}`}
                            onClick={() => {
                              setEditing(c);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil aria-hidden size="small" />
                          </Button>
                          <Button
                            htmlType="button"
                            theme="borderless"
                            size="small"
                            aria-label={`归档联系人 ${c.name}`}
                            onClick={() => handleArchive(c)}
                          >
                            <Archive aria-hidden size="small" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ExternalContactDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} runtimeMode={runtimeMode} />
    </div>
  );
}
