import { isCivilDay } from "@/features/calendar/dates"
import { useParams, useSearchParams } from "react-router"
import NotFound from "@/app/not-found"
import { MatterSectionPage } from "@/features/matters/matter-section-page"
import { matterSections } from "@/features/matters/sections"
import { commissionItemLabels, type CommissionFollowUp, type CommissionIssue, type CommissionKind } from "@/features/matters/personal-client"
import { ArchiveWorkspace } from "@/features/practice/archive-workspace"
import { CourtInbox } from "@/features/practice/court-inbox"

export default function Page() {
  const { matterId = "", section = "" } = useParams()
  const searchParams = Object.fromEntries(useSearchParams()[0])
  const match = matterSections.find(([key]) => key === section)
  if (!/^c[a-z0-9]{24,}$/.test(matterId) || !match || match[0] === "evidence") return <NotFound />
  if (match[0] === "archive") return <ArchiveWorkspace key={matterId} matterId={matterId} />
  if (match[0] === "court") {
    const { record, from } = searchParams
    const initialRecord = typeof record === "string" && /^c[a-z0-9]{24,}$/.test(record) ? record : undefined
    return <CourtInbox key={matterId + ":" + initialRecord} matterId={matterId} initialRecord={initialRecord} fromToday={from === "today"} />
  }
  const query = match[0] === "materials" || match[0] === "delivery" ? searchParams : {}
  const factAnalysis = match[0] === "materials" && query.prepare === "analysis"
  const prepareDocument = match[0] === "delivery" && typeof query.prepare === "string" && /^c[a-z0-9]{24,}$/.test(query.prepare)
    ? query.prepare : undefined
  const stageId = typeof query.stage === "string" ? query.stage : undefined
  const taskId = typeof query.task === "string" ? query.task : undefined
  const reviewId = taskId && typeof query.review === "string" && /^c[a-z0-9]{24,}$/.test(query.review) ? query.review : undefined
  if (query.review !== undefined && !reviewId) return <NotFound />
  const fromRecords = !!reviewId && query.from === "records"
  const todayTab = taskId && query.from === "today" ? (query.taskView === "waiting" || query.taskView === "done" ? query.taskView : "open") : undefined
  const scheduleDay = taskId && query.from === "schedule" && isCivilDay(query.day) ? query.day : undefined
  const commissionResearchId = typeof query.research === "string" && /^c[a-z0-9]{24,}$/.test(query.research) ? query.research : undefined
  const commissionFollowUp: CommissionFollowUp | undefined = commissionResearchId && typeof query.priorCommission === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(query.priorCommission) && typeof query.focus === "string" &&
    Object.hasOwn(commissionItemLabels, query.focus) ? { priorId: query.priorCommission, kind: query.focus as CommissionKind } : undefined
  if ((query.priorCommission !== undefined || query.focus !== undefined) && !commissionFollowUp) return <NotFound />
  const suggestedDocument = typeof query.suggestedMaterial === "string" && /^c[a-z0-9]{24,}$/.test(query.suggestedMaterial) ? query.suggestedMaterial : undefined
  if (query.suggestedMaterial !== undefined && (!commissionFollowUp || !suggestedDocument)) return <NotFound />
  const revision = Number(query.issueRevision)
  const issueConfirmedAt = query.issueConfirmedAt
  const commissionIssue: CommissionIssue | undefined = !commissionResearchId && typeof query.issue === "string" && /^c[a-z0-9]{24,}$/.test(query.issue) &&
    Number.isSafeInteger(revision) && revision > 0 && typeof issueConfirmedAt === "string" &&
    (issueConfirmedAt === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(issueConfirmedAt))
    ? { kind: "CURRENT", issueId: query.issue, revision, confirmedAt: issueConfirmedAt || null } : undefined
  const taskFilters = Object.fromEntries(Object.entries({
    program: query.program, scope: query.scope, q: query.q, layout: query.layout,
  }).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  return <MatterSectionPage key={`${matterId}:${section}:${!taskId ? stageId ?? "" : ""}:${taskId ?? ""}:${reviewId ?? ""}:${taskFilters.program ?? ""}:${commissionResearchId ?? commissionIssue?.issueId ?? ""}:${commissionIssue?.revision ?? ""}:${commissionFollowUp?.priorId ?? ""}:${commissionFollowUp?.kind ?? ""}:${suggestedDocument ?? ""}:${factAnalysis}`}
    matterId={matterId} section={match[0]} title={match[1]} stage={stageId} taskId={taskId} reviewId={reviewId} fromRecords={fromRecords} todayTab={todayTab} scheduleDay={scheduleDay} taskFilters={taskFilters} commissionResearchId={commissionResearchId} commissionIssue={commissionIssue} commissionFollowUp={commissionFollowUp} suggestedDocument={suggestedDocument} prepareDocument={prepareDocument} factAnalysis={factAnalysis} openMaterialUpload={query.upload === "1"} />
}
