"use client";

import { Table, Empty, Button, Dropdown, Form, Input, Notification, Select, Tag, Toast } from "@douyinfe/semi-ui";
import { useId, useRef, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { IconMore } from "@douyinfe/semi-icons";
import { IconPlus as Plus, IconSearch as Search } from "@douyinfe/semi-icons";
import type { SystemRole, UserRole } from "@prisma/client";
import { WorkspaceDialog, DrawerContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogContent } from "@/components/patterns/workspace-dialog";
import {
  createUser,
  updateUserRole,
  updateUserSystemRole,
  setUserActive,
  setUserManagerAuthorized,
  unlockUserLogin,
  resetUserPassword,
  forceEnforceTotp
} from "@/server/users/actions";
import { AccountPasswordInput } from "@/components/users/account-password-input";
import { ProfileBasicsForm } from "@/components/users/profile-basics-form";
import { IdentityForm } from "@/components/users/identity-form";
import { IdentityDocumentFields, type IdentityDocumentDraft } from "@/components/users/identity-document-fields";
import { identityDocumentInputSchema } from "@/lib/identity-documents";
import { userRoleLabel } from "@/lib/enums";
import { AdminPageHeader } from "@/components/layout/admin-page-header";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { formatDate, formatDateTime } from "@/lib/utils";
import { actionErrorMessage } from "@/lib/action-error";

type CustomRoleOption = { id: string; name: string; active: boolean };
const assignment = (value: string) => ROLES.includes(value as UserRole) ? { role: value as UserRole, roleDefinitionId: null } : { role: "CUSTOM" as const, roleDefinitionId: value };
const ROLES: UserRole[] = ["PRINCIPAL_LAWYER", "INDEPENDENT_LAWYER", "LAWYER", "ASSISTANT", "FINANCE"];

const createSchema = z.object({
  name: z.string().min(1).max(40),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.string().min(1, "请选择角色"),
  phone: z.string().max(30).optional()
});
type CreateValues = z.infer<typeof createSchema>;

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  systemRole: SystemRole;
  managerAuthorized?: boolean;
  roleDefinitionId?: string | null;
  roleName?: string;
  roleActive?: boolean;
  phone: string | null;
  active: boolean;
  openResponsibilityCount?: number;
  lastLoginAt: Date | null;
  lockedUntil?: Date | null;
  failedLoginAttempts?: number;
  totpEnabled?: boolean;
  totpEnforced?: boolean;
  createdAt: Date;
  updatedAt: Date;
  approvalMemberships: { group: { id: string; name: string } }[];
  _count: { ownedMatters: number; memberships: number };
};

export function UsersView({
  users,
  currentUserId,
  customRoles = [],
  builtinNames = {}
}: {
  users: UserRow[];
  currentUserId: string;
  customRoles?: CustomRoleOption[];
  builtinNames?: Record<string, string>;
}) {
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = users.find(user => user.id === editingId) ?? null;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const searchText = query.trim().toLowerCase();
  const visibleUsers = users.filter(user => {
    if (status !== "all" && user.active !== (status === "active")) return false;
    const assignment = user.roleName ?? userRoleLabel[user.role];
    const admin = user.systemRole === "SUPER_ADMIN" ? "系统超级管理员" : "普通账号";
    const approvals = user.approvalMemberships.map(({ group }) => group.name).join(" ");
    return `${user.name} ${user.email} ${assignment} ${admin} ${approvals}`.toLowerCase().includes(searchText);
  });

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="用户与岗位"
        sub={<>共 <b>{users.length}</b> 个账号 · 岗位决定功能范围，审批资格在「审批权限」单独分配</>}
        actions={<Button theme="solid" onClick={() => setSheetOpen(true)} size="small"><Plus aria-hidden />新增用户</Button>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input className="min-w-56 flex-1" aria-label="搜索账号" placeholder="按姓名、邮箱、角色或权限组搜索" value={query} onChange={setQuery} prefix={<Search size="default" aria-hidden />} />
        <Select<string> insetLabel="状态" insetLabelId="user-list-status-label" aria-labelledby="user-list-status-label" value={status} onChange={value => setStatus(String(value))} motion={false}>
          <Select.Option value="all">全部状态</Select.Option>
          <Select.Option value="active">已启用</Select.Option>
          <Select.Option value="inactive">已停用</Select.Option>
        </Select>
        <a className="shrink-0 text-sm text-primary" href="/admin/roles">管理角色</a>
        <a className="shrink-0 text-sm text-primary" href="/admin/approval-permissions">管理审批权限</a>
      </div>
      <div className="overflow-x-auto card">
        <Table<UserRow>
          rowKey="id"
          pagination={false}
          scroll={{ x: 986 }}
          dataSource={visibleUsers}
          empty={<Empty description={users.length ? "没有匹配的账号" : "暂无账号"} />}
          columns={[
            { title: "姓名 / 邮箱", key: "name", width: 200, render: (_, user) => (<> <div className="font-medium">{user.name}</div>
        <div className="truncate text-xs text-muted-foreground" title={user.email}>{user.email}</div>
        {user.lockedUntil && new Date(user.lockedUntil) > new Date() && (
          <div className="mt-0.5 text-xs text-[var(--semi-color-warning)]">登录锁定至 {formatDateTime(new Date(user.lockedUntil))}</div>
        )}
        <div className="mt-1 text-xs text-muted-foreground">审批权限组：{user.approvalMemberships.map(m => m.group.name).join("、") || "未分配"}</div></>) },
            { title: "角色", key: "role", width: 138, render: (_, user) => (<UserActionCell cell="role" user={user} customRoles={customRoles} builtinNames={builtinNames}
                  isSelf={user.id === currentUserId} isPending={isPending} startTransition={startTransition}
                  onResetPassword={() => setResetUser(user)} onEdit={() => setEditingId(user.id)} />) },
            { title: "系统管理", key: "system", width: 124, render: (_, user) => (<div className="flex flex-col items-start gap-1">
          <Tag color={user.systemRole === "SUPER_ADMIN" ? "violet" : "grey"}>
            {user.systemRole === "SUPER_ADMIN" ? "系统超级管理员" : "无"}
          </Tag>
          <Tag color={user.managerAuthorized || user.role === "PRINCIPAL_LAWYER" ? "blue" : "grey"}>
            {user.role === "PRINCIPAL_LAWYER" ? "岗位自带" : user.managerAuthorized ? "业务管理权" : "无业务管理权"}
          </Tag>
        </div>) },
            { title: "案件", key: "matters", width: 112, render: (_, user) => (<span className="whitespace-nowrap">主办 {user._count.ownedMatters} · 参与 {user._count.memberships}</span>) },
            { title: "最近登录", key: "lastLogin", width: 112, render: (_, user) => (
              <span className="whitespace-nowrap">{user.lastLoginAt ? formatDate(new Date(user.lastLoginAt)) : "从未登录"}</span>
            ) },
            { title: "状态", key: "status", width: 80, render: (_, user) => (<> <Tag color={user.active ? "green" : "grey"}>
          {user.active ? "已激活" : "已禁用"}
        </Tag>
        {(!user.active||!user.roleActive)&&Boolean(user.openResponsibilityCount)&&<p className="mt-1 text-xs text-[var(--semi-color-warning)]">{user.openResponsibilityCount} 项责任待交接</p>}</>) },
            { title: "登录安全", key: "security", width: 110, render: (_, user) => (<div className="flex flex-col items-start gap-1">
          <Tag size="small" color={user.totpEnabled ? "green" : "grey"}>
            {user.totpEnabled ? "双步已绑定" : "双步未开启"}
          </Tag>
          {user.totpEnforced && (
            <Tag color="amber">已强制要求</Tag>
          )}
        </div>) },
            { title: "操作", key: "actions", width: 110, fixed: "right", render: (_, user) => (<UserActionCell cell="actions" user={user} customRoles={customRoles} builtinNames={builtinNames}
                  isSelf={user.id === currentUserId} isPending={isPending} startTransition={startTransition}
                  onResetPassword={() => setResetUser(user)} onEdit={() => setEditingId(user.id)} />) },
          ]}
        />
      </div>

      <WorkspaceDialog open={!!editing} onOpenChange={open => { if (!open) setEditingId(null); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>编辑账号资料</DialogTitle><DialogDescription>维护基本资料，或核对并更正身份证件及照片。</DialogDescription></DialogHeader>
          {editing && <div className="space-y-5">
            <ProfileBasicsForm key={`${editing.id}-${editing.updatedAt}`} adminTargetId={editing.id} isSelf={editing.id === currentUserId}
              profile={{ name: editing.name, email: editing.email, phone: editing.phone, updatedAt: new Date(editing.updatedAt).toISOString() }} onSaved={() => setEditingId(null)} />
            <IdentityForm key={`${editing.id}-${editing.updatedAt}`} adminTargetId={editing.id} />
          </div>}
        </DialogContent>
      </WorkspaceDialog>
      <CreateUserSheet customRoles={customRoles} builtinNames={builtinNames} open={sheetOpen} onOpenChange={setSheetOpen} />
      <ResetPasswordDialog
        user={resetUser}
        onClose={() => setResetUser(null)}
      />
    </div>
  );
}

function UserActionCell({
  cell,
  isPending,
  startTransition,
  user,
  customRoles,
  builtinNames,
  isSelf,
  onResetPassword,
  onEdit
}: {
  cell: "role" | "actions";
  isPending: boolean;
  startTransition: React.TransitionStartFunction;
  user: UserRow;
  customRoles: CustomRoleOption[];
  builtinNames: Record<string, string>;
  isSelf: boolean;
  onResetPassword: () => void;
  onEdit: () => void;
}) {
  const moreActions = useRef<HTMLDivElement>(null);

  function runMenuAction(action: () => void | Promise<void>) {
    moreActions.current?.querySelector("button")?.focus();
    void action();
  }

  async function handleRoleChange(value: string) {
    if (value === (user.roleDefinitionId ?? user.role)) return;
    const target = customRoles.find(r => r.id === value)?.name ?? builtinNames[value] ?? userRoleLabel[value as UserRole];
    if (!(await confirmDialog({ title: `调整 ${user.name} 的岗位？`, description: `将从「${user.roleName ?? userRoleLabel[user.role]}」改为「${target}」，该账号需重新登录。`, confirmText: "调整" }))) return;
    startTransition(async () => {
      try {
        await updateUserRole({ id: user.id, ...assignment(value), expectedRole: user.role, expectedRoleDefinitionId: user.roleDefinitionId ?? null });
        Toast.success("角色已更新");
      } catch (err) {
        Notification.error({ title: "更新失败", content: actionErrorMessage(err) });
      }
    });
  }

  // v1.x P0-3: 解除登录锁定
  async function handleUnlock() {
    if (!(await confirmDialog({ title: `解除 ${user.name} 的登录锁定？`, confirmText: "解除锁定" }))) return;
    startTransition(async () => {
      try {
        await unlockUserLogin({ id: user.id });
        Toast.success("已解除锁定");
      } catch (err) {
        Notification.error({ title: "操作失败", content: actionErrorMessage(err) });
      }
    });
  }

  async function handleToggleActive() {
    if (
      !(await confirmDialog(user.active ? { title: `禁用 ${user.name}？`, description: "禁用后该用户无法登录。", confirmText: "禁用", danger: true, initialFocus: "cancel" } : { title: `重新激活 ${user.name}？`, confirmText: "激活" }))
    )
      return;
    startTransition(async () => {
      try {
        const res = await setUserActive({ id: user.id, active: !user.active });
        Toast.success(res.active ? "已激活" : "已禁用");
      } catch (err) {
        Notification.error({ title: "操作失败", content: actionErrorMessage(err) });
      }
    });
  }

  async function handleSystemRoleChange() {
    const next: SystemRole = user.systemRole === "SUPER_ADMIN" ? "NONE" : "SUPER_ADMIN";
    const action = next === "SUPER_ADMIN" ? "授予系统超级管理员资格" : "撤销系统超级管理员资格";
    if (!(await confirmDialog({ title: `${action}：${user.name}？`, description: "该账号的现有会话将失效。", confirmText: "确认", danger: next !== "SUPER_ADMIN" }))) return;
    startTransition(async () => {
      try {
        await updateUserSystemRole({ id: user.id, systemRole: next, expectedSystemRole: user.systemRole });
        Toast.success(next === "SUPER_ADMIN" ? "已授予系统管理资格" : "已撤销系统管理资格");
      } catch (err) {
        Notification.error({ title: "操作失败", content: actionErrorMessage(err) });
      }
    });
  }

  // 业务管理权与岗位解耦（2026-09-19）：按人授予，即时生效，不撤销在线会话
  async function handleManagerAuthorizationChange() {
    const next = !user.managerAuthorized;
    const action = next ? "授予业务管理权" : "撤销业务管理权";
    if (!(await confirmDialog({
      title: `${action}：${user.name}？`,
      description: next
        ? "等同合伙人的业务权限：全所案件、收案、客户与财务可见，可进入报表、导入、公告与联系人审核等管理功能。写入与撤销均实时生效并记录审计。"
        : "撤销后该账号即时失去业务管理权限；其岗位本身的权限不受影响。",
      confirmText: "确认",
      danger: !next
    }))) return;
    startTransition(async () => {
      try {
        await setUserManagerAuthorized({ id: user.id, managerAuthorized: next, expectedManagerAuthorized: user.managerAuthorized === true });
        Toast.success(next ? "已授予业务管理权" : "已撤销业务管理权");
      } catch (err) {
        Notification.error({ title: "操作失败", content: actionErrorMessage(err) });
      }
    });
  }

  // v1.x P1 收尾 c: 管理员强制账号开启双步验证（TOTP）
  async function handleToggleTotpEnforce() {
    const next = !user.totpEnforced;
    if (isSelf && next && !user.totpEnabled) {
      Toast.warning("你自己尚未绑定动态码：强制后将无法登录，请先在「个人设置 → 登录安全」完成绑定");
      return;
    }
    const warning = next
      ? user.totpEnabled
        ? `要求 ${user.name} 登录时使用双步验证？该账号已绑定动态码，每次登录都须验证。`
        : `要求 ${user.name} 开启双步验证？该账号尚未绑定动态码，完成绑定前将无法登录（需线下协助绑定）。`
      : `解除 ${user.name} 的双步验证强制要求？已绑定的动态码不受影响。`;
    if (!(await confirmDialog({ title: next ? "要求双步验证" : "解除双步验证强制", description: warning, confirmText: "确认" }))) return;
    startTransition(async () => {
      try {
        const res = await forceEnforceTotp({ id: user.id, enabled: next });
        Toast.success(res.enforced ? "已要求开启双步验证" : "已解除强制要求");
      } catch (err) {
        Notification.error({ title: "操作失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    cell === "role" ? (isSelf ? (
          <Tag color="grey">
            {user.roleName ?? userRoleLabel[user.role]}（自己）
          </Tag>
        ) : (
          <Select<string>
            className="w-full"
            insetLabelId={`user-role-${user.id}`}
            aria-labelledby={`user-role-${user.id}`}
            insetLabel={<span className="sr-only">{user.name}的岗位</span>}
            value={user.roleDefinitionId ?? user.role}
            onChange={value => void handleRoleChange(String(value))}
            disabled={isPending}
            motion={false}
          >
              {ROLES.map((r) => (
                <Select.Option key={r} value={r}>
                  {builtinNames[r] ?? userRoleLabel[r]}
                </Select.Option>
              ))}
              {customRoles.filter(r => r.active || r.id === user.roleDefinitionId).map(r => <Select.Option key={r.id} value={r.id} disabled={!r.active}>{r.name}{!r.active ? "（已停用）" : ""}</Select.Option>)}
            </Select>
        )) : (
      <div className="flex items-center gap-1">
        <Button theme="borderless" type="primary" size="small" onClick={onEdit}>资料</Button>
        <div ref={moreActions}>
          <Dropdown trigger="click" position="bottomRight" motion={false} render={
            <Dropdown.Menu>
              <Dropdown.Item disabled={isPending} onClick={() => runMenuAction(onResetPassword)}>改密码</Dropdown.Item>
              <Dropdown.Item disabled={isPending} onClick={() => runMenuAction(handleToggleTotpEnforce)}>
                {user.totpEnforced ? "解除强制" : "强制双步"}
              </Dropdown.Item>
              {user.role !== "PRINCIPAL_LAWYER" && (
                <Dropdown.Item disabled={isPending} onClick={() => runMenuAction(handleManagerAuthorizationChange)}>
                  {user.managerAuthorized ? "撤销业务管理权" : "授予业务管理权"}
                </Dropdown.Item>
              )}
              {!isSelf && <>
                <Dropdown.Item disabled={isPending} onClick={() => runMenuAction(handleSystemRoleChange)}>
                  {user.systemRole === "SUPER_ADMIN" ? "撤销系统管理资格" : "授予系统管理资格"}
                </Dropdown.Item>
                {user.lockedUntil && new Date(user.lockedUntil) > new Date() && (
                  <Dropdown.Item disabled={isPending} onClick={() => runMenuAction(handleUnlock)}>解除登录锁定</Dropdown.Item>
                )}
                <Dropdown.Item type={user.active ? "danger" : "primary"} disabled={isPending} onClick={() => runMenuAction(handleToggleActive)}>
                  {user.active ? "禁用账号" : "激活账号"}
                </Dropdown.Item>
              </>}
            </Dropdown.Menu>
          }>
            <Button theme="borderless" type="tertiary" size="small" icon={<IconMore aria-hidden />} aria-label={`更多操作：${user.name}`} />
          </Dropdown>
        </div>
      </div>
    )
  );
}

function CreateUserSheet({
  customRoles,
  builtinNames,
  open,
  onOpenChange
}: {
  customRoles: CustomRoleOption[];
  builtinNames: Record<string, string>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [identity, setIdentity] = useState<IdentityDocumentDraft>({
    documentType: "PRC_RESIDENT_ID",
    documentName: "",
    documentNumber: "",
    primaryFile: null,
    secondaryFile: null
  });
  const fieldPrefix = useId();
  const [identityErrors, setIdentityErrors] = useState<Partial<Record<"documentType" | "documentName" | "documentNumber" | "primaryFile", string>>>({});
  const {
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors }
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "LAWYER",
      phone: ""
    }
  });
  const role = useWatch({ control, name: "role" });

  function onSubmit(values: CreateValues) {
    const parsedIdentity = identityDocumentInputSchema.safeParse({
      identityDocumentType: identity.documentType,
      identityDocumentName: identity.documentName,
      identityDocumentNumber: identity.documentNumber
    });
    const nextErrors: typeof identityErrors = {};
    if (!parsedIdentity.success) {
      for (const issue of parsedIdentity.error.issues) {
        if (issue.path[0] === "identityDocumentName") nextErrors.documentName = issue.message;
        if (issue.path[0] === "identityDocumentNumber") nextErrors.documentNumber = issue.message;
        if (issue.path[0] === "identityDocumentType") nextErrors.documentType = issue.message;
      }
    }
    setIdentityErrors(nextErrors);
    if (!parsedIdentity.success) return;
    startTransition(async () => {
      try {
        const roleAssignment = assignment(values.role);
        const formData = new FormData();
        formData.set("name", values.name);
        formData.set("email", values.email);
        formData.set("password", values.password);
        formData.set("phone", values.phone ?? "");
        formData.set("role", roleAssignment.role);
        if (roleAssignment.roleDefinitionId) formData.set("roleDefinitionId", roleAssignment.roleDefinitionId);
        formData.set("identityDocumentType", parsedIdentity.data.identityDocumentType);
        formData.set("identityDocumentName", parsedIdentity.data.identityDocumentName ?? "");
        formData.set("identityDocumentNumber", parsedIdentity.data.identityDocumentNumber);
        if (identity.primaryFile) formData.set("identityImagePrimary", identity.primaryFile);
        if (identity.secondaryFile) formData.set("identityImageSecondary", identity.secondaryFile);
        await createUser(formData);
        Toast.success("用户已创建");
        reset();
        setIdentity({ documentType: "PRC_RESIDENT_ID", documentName: "", documentNumber: "", primaryFile: null, secondaryFile: null });
        setIdentityErrors({});
        onOpenChange(false);
      } catch (err) {
        Notification.error({ title: "创建失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <WorkspaceDialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="flex w-screen max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border bg-background px-6 py-4">
          <DialogTitle>新增用户</DialogTitle>
          <DialogDescription className="text-xs">
            用户可在登录后修改初始密码。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            <SheetField id={`${fieldPrefix}-name`} label="姓名" required error={errors.name?.message}>
              <Controller name="name" control={control} render={({ field }) => (
                <Input {...field} id={`${fieldPrefix}-name`} autoComplete="name" disabled={isPending} validateStatus={errors.name ? "error" : "default"} aria-describedby={errors.name ? `${fieldPrefix}-name-error` : undefined} />
              )} />
            </SheetField>
            <SheetField id={`${fieldPrefix}-email`} label="邮箱" required error={errors.email?.message}>
              <Controller name="email" control={control} render={({ field }) => (
                <Input {...field} id={`${fieldPrefix}-email`} type="email" autoComplete="email" disabled={isPending} validateStatus={errors.email ? "error" : "default"} aria-describedby={errors.email ? `${fieldPrefix}-email-error` : undefined} />
              )} />
            </SheetField>
            <SheetField id={`${fieldPrefix}-password`} label="初始密码（至少 8 位）" required error={errors.password?.message}>
              <Controller name="password" control={control} render={({ field }) => (
                <AccountPasswordInput {...field} id={`${fieldPrefix}-password`} autoComplete="new-password" disabled={isPending} validateStatus={errors.password ? "error" : "default"} aria-describedby={errors.password ? `${fieldPrefix}-password-error` : undefined} />
              )} />
            </SheetField>
            <SheetField id={`${fieldPrefix}-role`} label="角色" required composite>
              <Select<string>
                aria-labelledby={`${fieldPrefix}-role-label`}
                className="w-full"
                value={role}
                disabled={isPending}
                onChange={value => setValue("role", String(value), { shouldDirty: true })}
              >
                {ROLES.map(role => <Select.Option key={role} value={role}>{builtinNames[role] ?? userRoleLabel[role]}</Select.Option>)}
                {customRoles.filter(r => r.active).map(r => <Select.Option key={r.id} value={r.id}>{r.name}</Select.Option>)}
              </Select>
            </SheetField>
            <SheetField id={`${fieldPrefix}-phone`} label="电话" error={errors.phone?.message}>
              <Controller name="phone" control={control} render={({ field }) => (
                <Input {...field} id={`${fieldPrefix}-phone`} type="tel" autoComplete="tel" disabled={isPending} validateStatus={errors.phone ? "error" : "default"} aria-describedby={errors.phone ? `${fieldPrefix}-phone-error` : undefined} />
              )} />
            </SheetField>
            {Object.keys(identityErrors).length > 0 && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">请补全并核对身份证件信息。</div>}
            <IdentityDocumentFields
              value={identity}
              disabled={isPending}
              errors={identityErrors}
              onChange={next => { setIdentity(next); setIdentityErrors({}); }}
              onRecognizedName={name => setValue("name", name, { shouldDirty: true, shouldValidate: true })}
            />
          </div>

          <DialogFooter className="border-t border-border bg-background px-6 py-4">
            <Button
              htmlType="button"
              theme="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button theme="solid" htmlType="submit" disabled={isPending} loading={isPending}>
              创建
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </WorkspaceDialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose
}: {
  user: UserRow | null;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [pwd, setPwd] = useState("");

  function handleReset() {
    if (!user) return;
    if (pwd.length < 8) {
      Toast.warning("密码至少 8 位");
      return;
    }
    startTransition(async () => {
      try {
        await resetUserPassword({ id: user.id, newPassword: pwd });
        Toast.success(`已重置 ${user.name} 的密码`);
        setPwd("");
        onClose();
      } catch (err) {
        Notification.error({ title: "失败", content: actionErrorMessage(err) });
      }
    });
  }

  return (
    <WorkspaceDialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重置 {user?.name} 的密码</DialogTitle>
          <DialogDescription>
            管理员重置后，用户使用新密码登录。建议线下告知用户。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Form.Label name="reset-user-password" required>新密码（至少 8 位）</Form.Label>
          <AccountPasswordInput
            id="reset-user-password"
            autoComplete="new-password"
            disabled={isPending}
            value={pwd}
            onChange={setPwd}
          />
        </div>
        <DialogFooter>
          <Button theme="outline" onClick={onClose} disabled={isPending}>
            取消
          </Button>
          <Button type="danger" theme="solid" onClick={handleReset} loading={isPending} disabled={isPending}>
            重置
          </Button>
        </DialogFooter>
      </DialogContent>
    </WorkspaceDialog>
  );
}

function SheetField({
  id,
  label,
  required,
  composite,
  error,
  children
}: {
  id: string;
  label: string;
  required?: boolean;
  composite?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Form.Label name={composite ? undefined : id} id={`${id}-label`} text={label} required={required} />
      {children}
      {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
