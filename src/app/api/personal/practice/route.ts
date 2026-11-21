import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import {
  buildIntakeConflictQueries,
  conflictSeverityLabel,
} from "@/lib/approvals/intake-detail";
import { decryptIdNumber } from "@/lib/clients/id-number-crypto";
import { clientActivitySchema } from "@/lib/clients/relationship";
import {
  clientTypeLabel,
  conflictConclusionLabel,
  cooperationStatusLabel,
  intakeStatusLabel,
  litigationStandingLabel,
  matterCategoryLabel,
} from "@/lib/enums";
import { isPersonalMode } from "@/lib/runtime/mode";
import { personalChannelAllowed } from "@/lib/runtime/personal-channel";
import { shDayKey } from "@/lib/ui/sh-time";
import {
  addContact,
  createClient,
  getClientById,
  listClients,
} from "@/server/clients/actions";
import {
  getClientRelationship,
  getPersonalFollowUps,
  recordClientActivity,
} from "@/server/clients/relationship-actions";
import {
  clientCreateSchema,
  contactInputSchema,
} from "@/server/clients/schemas";
import {
  runCheckAndSave,
  setConflictConclusion,
} from "@/server/conflicts/actions";
import {
  convertIntakeToMatter,
  createIntake,
  getIntakeById,
  listIntakes,
  resubmitIntake,
} from "@/server/intakes/actions";
import {
  getIntakeEditForm,
  reviseIntakeSummary,
  withdrawIntake,
} from "@/server/intakes/revision-actions";
import {
  createExternalContact,
  listExternalContacts,
} from "@/server/external-contacts/actions";
import { requireSession } from "@/lib/auth/session";
import { personalRuntime } from "@/lib/runtime/personal-channel";
import { intakeCreateSchema } from "@/server/intakes/schemas";
import {
  getNotificationSummary,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/notifications/actions";
import { createPersonalCalendarEntry, readPersonalCalendar, readPersonalToday, savePersonalCalendarEntry } from "@/server/schedule/personal-calendar";
import {
  personalTaskAction,
  readPersonalTaskBoard,
  taskBoardViews,
  resolvePersonalTask,
} from "@/server/tasks/personal-schedule";

const id = z.cuid();
const action = z.discriminatedUnion("action", [
  personalTaskAction,
  createPersonalCalendarEntry,
  z.object({ action: z.literal("create-client"), input: clientCreateSchema }),
  z.object({
    action: z.literal("client-contact"),
    id,
    input: contactInputSchema,
  }),
  z.object({
    action: z.literal("create-contact"),
    name: z.string().trim().min(1).max(60),
    category: z.enum([
      "COURT",
      "PROSECUTOR",
      "POLICE",
      "NOTARY",
      "ARBITRATION",
      "OTHER_FIRM",
      "EXPERT",
      "OTHER",
    ]),
    phone: z.string().max(30),
    organization: z.string().max(120),
  }),
  z.object({
    action: z.literal("revise-intake"),
    id,
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000),
  }),
  z.object({
    action: z.literal("withdraw-intake"),
    id,
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({
    action: z.literal("client-activity"),
    input: clientActivitySchema,
  }),
  z.object({ action: z.literal("create-intake"), input: intakeCreateSchema }),
  z.object({ action: z.literal("check-intake"), id }),
  z.object({
    action: z.literal("decide-conflict"),
    id,
    conclusion: z.enum(["SAME_SUBJECT", "DIFFERENT", "NEED_INFO"]),
    note: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal("precheck"),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({ action: z.literal("submit-intake"), id }),
  z.object({ action: z.literal("convert-intake"), id }),
  z.object({ action: z.literal("read-notification"), id: z.string().min(1).max(160) }),
  z.object({ action: z.literal("read-all-notifications") }),
]);

async function intakeDetail(key: string) {
  const intake = await getIntakeById(key);
  if (!intake || intake.teamReadOnly)
    throw new ActionError("收案不存在或不可办理。");
  return intake;
}

async function read(query: URLSearchParams) {
  const page = z.coerce
    .number()
    .int()
    .positive()
    .max(100000)
    .parse(query.get("page") ?? 1);
  const search = z
    .string()
    .trim()
    .max(120)
    .parse(query.get("q") ?? "");
  const view = query.get("view");
  if (view === "workspace") {
    await requireSession("personal");
    return { id: personalRuntime().workspaceId };
  }
  if (view === "contacts") {
    const rows = await listExternalContacts({ search });
    return rows.map(
      ({ id, name, category, organization, title, phone, status }) => ({
        id,
        name,
        category,
        organization,
        title,
        phone,
        status,
      }),
    );
  }
  if (view === "intake-edit") {
    const { values, revision } = await getIntakeEditForm(
      id.parse(query.get("id")),
    );
    return { title: values.title, description: values.description, revision };
  }
  if (view === "today") return readPersonalToday();
  if (view === "responsibilities") {
    const taskView = z.enum(taskBoardViews).optional().parse(query.get("taskView") ?? undefined);
    return readPersonalTaskBoard(query.get("closed") === "1", taskView);
  }
  if (view === "schedule") {
    const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(value => value >= "0001-01")
      .parse(query.get("month") ?? shDayKey(new Date()).slice(0, 7));
    return readPersonalCalendar(month, query.get("grid") === "1");
  }
  if (view === "clients") {
    const data = await listClients({ page, pageSize: 20, search });
    return {
      ...data,
      items: data.items.map((row) => ({
        id: row.id,
        name: row.name,
        description: clientTypeLabel[row.type],
        detail: row.phone ?? "",
        state: cooperationStatusLabel[row.cooperationStatus],
      })),
    };
  }
  if (view === "client") {
    const key = id.parse(query.get("id"));
    const [row, relationship] = await Promise.all([
      getClientById(key),
      getClientRelationship(key),
    ]);
    if (!row) throw new ActionError("客户不存在。");
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      contacts: row.contacts.map(({ id, name, title, phone }) => ({
        id,
        name,
        title,
        phone,
      })),
      matters: row.matters,
      relationship,
    };
  }
  if (view === "follow-ups") return getPersonalFollowUps({ page });
  if (view === "intakes") {
    const data = await listIntakes({
      page,
      pageSize: 20,
      search,
      scope: "mine",
    });
    return {
      ...data,
      items: data.items.map((row) => ({
        id: row.id,
        name: row.title,
        description: matterCategoryLabel[row.category],
        detail: row.client?.name ?? "",
        state: intakeStatusLabel[row.status],
      })),
      categories: matterCategoryLabel,
      standings: litigationStandingLabel,
    };
  }
  if (view === "intake") {
    const intake = await intakeDetail(id.parse(query.get("id")));
    const latest = intake.conflictChecks[0];
    return {
      id: intake.id,
      title: intake.title,
      status: intake.status,
      label: intakeStatusLabel[intake.status],
      description: intake.description,
      client: intake.client?.name,
      matter: intake.matter,
      reason: intake.declinedReason,
      check: latest
        ? {
            id: latest.id,
            conclusion: conflictConclusionLabel[latest.conclusion],
            note: latest.note,
            hits: latest.hits.map((hit) => ({
              id: hit.id,
              severity: conflictSeverityLabel[hit.severity],
              reason: hit.reason,
            })),
          }
        : null,
    };
  }
  if (view === "notifications") {
    if (query.get("summary") === "1") return getNotificationSummary();
    const items = await getNotifications({
      limit: 100,
      unreadOnly: query.get("unread") === "1",
    });
    return {
      items: items.map(({ id, title, content, createdAt, read }) => ({
        id,
        title,
        content,
        createdAt,
        read,
      })),
    };
  }
  throw new ActionError("未知业务页面。");
}

async function handle(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const json = (body: unknown, status = 200) =>
    Response.json(body, { headers, status });
  if (!isPersonalMode()) return new Response(null, { status: 404, headers });
  if (!personalChannelAllowed(request.headers, { method: request.method }))
    return new Response(null, { status: 403, headers });
  try {
    if (request.method === "GET")
      return json(await read(new URL(request.url).searchParams));
    const data = action.parse(await request.json().catch(() => null));
    switch (data.action) {
      case "create-calendar-entry":
        return json(await savePersonalCalendarEntry(data));
      case "resolve-schedule-task":
        return json(await resolvePersonalTask(data));
      case "create-client":
        return json(await createClient(data.input));
      case "client-contact":
        return json(await addContact(data.id, data.input));
      case "create-contact": {
        const row = await createExternalContact({ ...data, tags: [] });
        return json({ id: row.id });
      }
      case "withdraw-intake":
        return json(await withdrawIntake(data.id, data.reason));
      case "revise-intake":
        return json(await reviseIntakeSummary(data));
      case "client-activity":
        return json(await recordClientActivity(data.input));
      case "create-intake":
        return json(
          await createIntake({
            ...data.input,
            ownerUserId: undefined,
            coUserIds: [],
          }),
        );
      case "check-intake": {
        const intake = await intakeDetail(data.id);
        await runCheckAndSave({
          intakeId: data.id,
          queries: buildIntakeConflictQueries(intake, decryptIdNumber),
        });
        return json({ ok: true });
      }
      case "precheck": {
        const result = await runCheckAndSave({
          queries: [{ name: data.name }],
        });
        return json({
          hits: result.hits.map((hit) => ({
            id: hit.id,
            severity: conflictSeverityLabel[hit.severity],
            reason: hit.reason,
          })),
          sameName: result.sameNameClients.length,
        });
      }
      case "decide-conflict":
        return json(
          await setConflictConclusion({
            checkId: data.id,
            conclusion: data.conclusion,
            note: data.note,
          }),
        );
      case "submit-intake":
        return json(await resubmitIntake(data.id));
      case "convert-intake":
        return json(await convertIntakeToMatter(data.id));
      case "read-all-notifications":
        return json(await markAllNotificationsRead());
      case "read-notification":
        await markNotificationRead(data.id);
        return json({ ok: true });
    }
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues.map((i) => i.message).join("；") },
        400,
      );
    if (error instanceof ActionError)
      return json({ error: error.message }, 409);
    throw error;
  }
}
export { handle as GET, handle as POST };
