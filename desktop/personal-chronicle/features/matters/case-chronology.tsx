"use client"

import { InlineLoading } from "@/kit/ui-patterns/workspace-loading"
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, EyeIcon, CalendarClockIcon, ChevronLeftIcon, ChevronRightIcon, FileTextIcon, EllipsisIcon, ScaleIcon, SearchIcon } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import Link from "@/features/shell/workspace-link"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Item } from "@/components/ui/item"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { ChronologyAssessment, ChronologyChange, ChronologyStage } from "../../../../src/lib/evidence/chronology-assessment"
import { FactAssessment, FactChangeLog, FactDirections, FactRecordComparison, FactReviewQueue, chronologyCategories, chronologyDisputes, chronologyStages, onlyPartyStatements, partyDisputes, type ComparisonField } from "./fact-assessment"
import { ChronologySelect } from "./chronology-select"
import type { TimelineEventReference, TimelineLevel } from "../../../../src/lib/matters/timeline-levels"
import { TimelineGradeBadge, TimelineGradeControl, timelineGradeOptions, timelineLevelLabels } from "./timeline-grade"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/kit/ui-patterns/status-badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FixedSourcePreview, type FixedSource } from "./fixed-source-preview"
import { ChronologyTrace, TraceEntry, TraceGroup, traceEntryClassName } from "./chronology-trace"
import { FactTrace, type ProgramTrack, type TimelineMarker, type TimelineScope, type Track } from "./fact-trace"
import { ObservationHistory } from "./observation-history"
import { ObservationEditor, type ObservationSaved } from "./observation-editor"
import { FactAnalysisDesk } from "./fact-analysis-desk"
import { dateInterval, firstObservedDay, observationDifferences, observationMarks, ObservationExcerpt, ObservationValues, statements, type FactObservation } from "./fact-observation"
import { evidenceEndpoint, workspaceEndpoint, readPersonal } from "./personal-client"

export const kinds = { FACT: "事实", CLAIM: "当事人陈述", ANALYSIS: "分析", ISSUE: "争点", TODO_VERIFY: "待核实" }
export const relations = { SUPPORTS: "支持", REBUTS: "反驳", CONTEXT: "背景" }
export type EventDate = { precision: "EXACT" | "RANGE" | "UNKNOWN"; start: string | null; end: string | null; text: string | null }
type Source = {
  id: string; documentId: string | null; documentName: string | null; documentVersion: number | null
  chronologyStage?: ChronologyStage | null
  relation: keyof typeof relations | null; legacy: boolean; status: string; locationLabel: string | null; hasAnchor?: boolean
}
export type EvidenceNote = {
  id: string; kind: keyof typeof kinds; title: string; content: string; revision: number; confirmedAt: string | null
  restricted: boolean; canEdit: boolean; sources: Source[]; eventDate: EventDate | null; chronologyAssessment?: ChronologyAssessment | null; observations?: FactObservation[]; level?: TimelineLevel | null
}

const views = [["timeline", "时间轴"], ["matrix", "对照矩阵"], ["narrative", "事实经过"]] as const
const pageSize = 8
type Selection = { itemId: string; revision: number; sourceId?: string; observationId?: string; showSources?: boolean }

function dateLabel(item: EvidenceNote) {
  if (item.restricted) return "来源受限"
  const date = item.eventDate
  const recorded = firstObservedDay(item.observations ?? [])
  return [date?.start, date?.end].filter(Boolean).join(" 至 ") || date?.text || (recorded ? "最早记载 " + recorded : "时间未明")
}

const tracksByCategory = {
  communication: { title: chronologyCategories.communication, tone: "bg-sky-600 text-sky-600 dark:text-sky-300" },
  meeting: { title: chronologyCategories.meeting, tone: "bg-teal-600 text-teal-600 dark:text-teal-300" },
  decision: { title: chronologyCategories.decision, tone: "bg-purple-600 text-purple-600 dark:text-purple-300" },
  agreement: { title: "协议或约定", tone: "bg-violet-600 text-violet-600 dark:text-violet-300" },
  payment: { title: "款项往来", tone: "bg-amber-500 text-amber-600 dark:text-amber-300" },
  performance: { title: "履行", tone: "bg-emerald-600 text-emerald-600 dark:text-emerald-300" },
  notice: { title: "通知与催告", tone: "bg-pink-600 text-pink-600 dark:text-pink-300" },
  procedure: { title: "诉讼程序", tone: "bg-slate-500 text-slate-500 dark:text-slate-300" },
  other: { title: "其他", tone: "bg-primary text-primary" },
}

function inferredCategory(records: readonly FactObservation[]): keyof typeof tracksByCategory {
  if (records.some(({ data }) => data.date?.role === "FILING" || data.date?.role === "SERVICE")) return "procedure"
  if (records.some(({ data }) => data.amount?.nature === "ACTUAL_TRANSFER" || data.relations?.some(link => link.kind === "PAYS_TO" || link.kind === "LENDS_TO"))) return "payment"
  if (records.some(({ data }) => data.date?.role === "AGREEMENT" || data.amount?.nature === "AGREED_PRINCIPAL" || data.relations?.some(link => link.kind === "CONTRACTS_WITH"))) return "agreement"
  if (records.some(({ data }) => data.relations?.some(link => link.kind === "DELIVERS_TO"))) return "performance"
  if (records.some(({ data }) => data.date?.role === "SENT" || data.date?.role === "RECEIVED")) return "communication"
  return "other"
}

function factCategory(item: EvidenceNote) {
  return item.restricted ? "other" : item.chronologyAssessment?.category ?? inferredCategory(item.observations ?? [])
}

function timelineMarker(item: EvidenceNote): TimelineMarker {
  const records = item.restricted ? [] : item.observations ?? []
  const differences = observationDifferences(records)
  const evidenced = records.flatMap(({ data: { date } }) => date && date.role !== "SIGNATURE" ? [date] : [])
  const relevant = evidenced.some(entry => entry.role === "OCCURRENCE") ? evidenced.filter(entry => entry.role === "OCCURRENCE") : evidenced
  const dates = [...new Set(relevant.flatMap(entry => entry.value.precision === "EXACT" ? [entry.value.day] : []))].sort()
  const known = relevant.map(entry => ({ interval: dateInterval(entry.value), precision: entry.value.precision }))
    .filter(value => value.interval).sort((left, right) => left.interval!.start.localeCompare(right.interval!.start))[0]
  const adopted = records.find(record => record.id === item.chronologyAssessment?.dateObservationId)?.data.date
  const explicit = item.restricted ? null : item.eventDate
  const chosen = adopted && dateInterval(adopted.value)
  const monthOnly = chosen ? adopted?.value.precision === "MONTH" : !explicit?.start && known?.precision === "MONTH"
  return {
    id: item.id, title: item.title,
    day: chosen?.start ?? explicit?.start ?? known?.interval?.start,
    end: chosen ? (chosen.start === chosen.end ? undefined : chosen.end) : explicit?.end ?? (known?.precision === "MONTH" || known?.precision === "RANGE" ? known.interval?.end : undefined),
    dateShape: monthOnly ? "month" : item.chronologyAssessment?.nature === "estimated" ? "approximate" : undefined,
    planned: item.chronologyAssessment?.nature === "planned" || Boolean(relevant.length && relevant.every(entry => entry.role === "AGREEMENT")),
    dates: differences.date && !chosen ? dates : undefined,
    detail: chosen ? chosen.start + (chosen.end === chosen.start ? "" : " 至 " + chosen.end)
      : differences.date ? "记载不一" : explicit?.start ? dateLabel(item) : known?.interval
        ? known.precision === "MONTH" ? known.interval.start.slice(0, 7) : known.interval.start + (known.interval.end === known.interval.start ? "" : " 至 " + known.interval.end)
        : dates.length ? "日期待核" : "无日期",
    level: item.level, attention: differences.date, disputed: item.chronologyAssessment?.dispute === "disputed",
    amountConflict: differences.amount, reviewed: Boolean(item.confirmedAt), claim: item.kind === "CLAIM",
    tone: tracksByCategory[factCategory(item)].tone,
  }
}

export function CaseChronology({ matterId, items, programs = [], onEdit, matrixOnly, initialItem, filter, onObservationsSaved, grading }: {
  grading?: { canWrite: boolean; pending: boolean; save(event: TimelineEventReference, level: TimelineLevel | null): void }
  matterId: string; items: EvidenceNote[]; programs?: ProgramTrack[]; matrixOnly?: boolean; initialItem?: string; filter?: ReactNode; onObservationsSaved?: () => void; onEdit(item: EvidenceNote, action: "revise" | "link" | "unlink"): void
}) {
  const [view, setView] = useState<(typeof views)[number][0]>(matrixOnly ? "matrix" : "timeline")
  const [selection, setSelection] = useState<Selection | null>()
  const [onlyPending, setOnlyPending] = useState(false)
  const [matrixScope, setMatrixScope] = useState<"item" | "page">(matrixOnly ? "page" : "item")
  const [query, setQuery] = useState("")
  const [sourceFilter, setSourceFilter] = useState<"all" | "statement" | "conflict" | "key">("all")
  const [ascending, setAscending] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")
  const [levelFilter, setLevelFilter] = useState<"all" | "" | TimelineLevel>("all")
  const search = query.trim().toLowerCase()
  const [pageIndex, setPageIndex] = useState<number>()
  const [timelineScope, setTimelineScope] = useState<TimelineScope>()
  const [officialId, setOfficialId] = useState<string>()
  const [laneMode, setLaneMode] = useState<"category" | "program" | "source" | "person" | "none">("category")
  const [showClaims, setShowClaims] = useState(true)
  const [showDirections, setShowDirections] = useState(false)
  const [cutoff, setCutoff] = useState<ChronologyStage | "">("")
  const [onlyConflicts, setOnlyConflicts] = useState(false)
  const [playIndex, setPlayIndex] = useState<number>()
  const [original, setOriginal] = useState<{
    itemId: string; revision: number; sourceId: string; source?: FixedSource; observation?: FactObservation
    field?: ComparisonField; failed?: boolean
  }>()
  const comparisonPanel = useRef<HTMLElement>(null)
  const returnToComparison = useRef<string>(undefined)
  const returnToSource = useRef<{ itemId: string; revision: number; sourceId: string; observationId?: string }>(undefined)
  const factPanel = useRef<HTMLDivElement>(null)
  const revealFact = useRef(false)
  const backFromOriginal = useRef<HTMLButtonElement>(null)
  const originalContent = useRef<HTMLDivElement>(null)
  const [assessmentPending, setAssessmentPending] = useState(false)
  const [assessmentError, setAssessmentError] = useState<{ itemId: string; message: string }>()
  const replayReturn = useRef<{ selection: typeof selection; officialId?: string; page?: number; scope?: TimelineScope }>(null)

  const stageOrder = Object.keys(chronologyStages)
  const knownItems = cutoff ? items.flatMap(item => {
    if (item.restricted) return []
    const sources = item.sources.filter(source => source.chronologyStage && stageOrder.indexOf(source.chronologyStage) <= stageOrder.indexOf(cutoff))
    if (!sources.length) return []
    if (sources.length === item.sources.length) return [{ ...item, canEdit: false }]
    return [{ ...item, sources, content: "", eventDate: null, canEdit: false, confirmedAt: null, chronologyAssessment: null,
      observations: item.observations?.filter(record => sources.some(source => source.id === record.sourceId)) }]
  }) : items
  const levelMatches = (level?: TimelineLevel | null) => view !== "timeline" || levelFilter === "all" || (level ?? "") === levelFilter
  const rows = knownItems.filter(item => levelMatches(item.level) && (!onlyPending || !item.confirmedAt) &&
    (sourceFilter === "all" || sourceFilter === "statement" && onlyPartyStatements(item) ||
      sourceFilter === "key" && item.level === "KEY" ||
      sourceFilter === "conflict" && Object.values(observationDifferences(item.observations ?? [])).some(Boolean)) && (!search ||
    item.title.toLowerCase().includes(search) || (!item.restricted && [item.content, ...item.sources.map(source => source.documentName ?? ""),
      ...item.observations?.flatMap(({ data }) => [data.excerpt?.text ?? "", data.date?.text ?? "", data.amount?.text ?? "",
        ...data.participants?.map(person => person.text) ?? []]) ?? []]
      .some(value => value.toLowerCase().includes(search)))))
    .map(item => ({ item, start: timelineMarker(item).day }))
    .sort((a, b) => !a.start ? (b.start ? 1 : 0) : !b.start ? -1 : a.start.localeCompare(b.start) * (ascending ? 1 : -1)).map(row => row.item)
  const narrative = rows.filter(item => item.kind === "FACT" || item.kind === "CLAIM")
  const programTracks = (cutoff ? [] : programs).map(program => ({
    ...program, events: program.events
      .filter(event => levelMatches(event.level) && !onlyPending && (!search || (event.title + " " + program.title).toLowerCase().includes(search)))
      .map(event => ({ ...event, id: "program:" + event.id, programId: program.id, programTitle: program.title })),
  }))
  const officialEvents = programTracks.flatMap(track => track.events).sort((a, b) => a.day.localeCompare(b.day))
  const markers = knownItems.filter(item => levelMatches(item.level) && (showClaims || item.kind !== "CLAIM")).map(item => ({ item, marker: timelineMarker(item) }))
  const allMarkers = markers.map(({ marker }) => marker)
  const categories = new Map<string, Track>(Object.entries(tracksByCategory).map(([id, info]) => [id, { id, ...info, events: [] }]))
  for (const { item, marker } of markers) categories.get(factCategory(item))!.events.push(marker)
  categories.get("procedure")!.events.push(...officialEvents)
  let dataTracks: Track[] = []
  if (laneMode === "category") dataTracks = Array.from(categories.values()).filter(track => track.events.length)
  else if (laneMode === "program") dataTracks = [{ id: "case", title: "案情事实", events: allMarkers }, ...programTracks]
  else if (laneMode === "none") dataTracks = [{ id: "case", title: "全部事件", events: [...allMarkers, ...officialEvents] }]
  else {
    const byKey = new Map<string, Track>()
    for (const { item, marker } of markers) {
      const labels = laneMode === "source" ? item.sources.filter(source => source.status === "AVAILABLE" && source.documentId)
        .map(source => ({ id: source.documentId!, title: source.documentName + " · V" + source.documentVersion }))
        : (item.observations ?? []).flatMap(record => record.data.participants?.map(person => ({ id: person.text, title: person.text })) ?? [])
      const entries = labels.length && !item.restricted ? labels : [{ id: "unassigned", title: laneMode === "source" ? "无可用材料" : "主体未载明" }]
      for (const { id, title } of new Map(entries.map(entry => [entry.id, entry])).values()) {
        if (!byKey.has(id)) byKey.set(id, { id, title, events: [] })
        byKey.get(id)!.events.push(marker)
      }
    }
    if (officialEvents.length) byKey.set("procedure", { id: "procedure", title: "诉讼程序", events: officialEvents })
    dataTracks = [...byKey.values()]
  }
  const directions = showDirections ? markers.flatMap(({ item }) => (item.chronologyAssessment?.directions ?? []).flatMap(direction =>
    item.sources.some(source => source.status === "AVAILABLE" && source.id === direction.sourceId)
      ? [{ from: item.id, to: direction.targetId, label: direction.label, id: direction.id }] : [])) : []
  const playOrder = playIndex === undefined ? [] : [...allMarkers.filter(marker => marker.day && !marker.claim), ...officialEvents]
    .sort((a, b) => a.day!.localeCompare(b.day!) || a.id.localeCompare(b.id))
  const replayPosition = playOrder.length && playIndex !== undefined ? Math.min(playIndex, playOrder.length - 1) : undefined
  const playing = replayPosition === undefined ? undefined : playOrder[replayPosition]
  const shown = replayPosition === undefined ? undefined : new Set(playOrder.slice(0, replayPosition + 1).map(event => event.id))
  const scopeIds = view === "timeline" && timelineScope && !shown ? new Set(timelineScope.ids) : undefined
  const scopedFacts = shown ? playOrder.slice(0, replayPosition! + 1).flatMap(event => {
    const item = knownItems.find(candidate => candidate.id === event.id)
    return item ? [item] : []
  }) : rows.filter(item => (!scopeIds || scopeIds.has(item.id)) && (showClaims || item.kind !== "CLAIM"))
  const scopedOfficial = shown ? officialEvents.filter(event => shown.has(event.id))
    : scopeIds ? officialEvents.filter(event => scopeIds.has(event.id)) : view === "timeline" && levelFilter !== "all" ? officialEvents : []
  const totalRows = scopedFacts.length + scopedOfficial.length
  const lastPage = Math.max(0, Math.ceil(totalRows / pageSize) - 1)
  const preferred = scopedFacts.findIndex(item => item.id === initialItem)
  const playedRow = playing ? scopedFacts.findIndex(item => item.id === playing.id) : -1
  const playedIndex = playedRow >= 0 ? playedRow : playing ? scopedFacts.length + scopedOfficial.findIndex(event => event.id === playing.id) : -1
  const page = Math.min(playedIndex >= 0 ? Math.floor(playedIndex / pageSize) : pageIndex ?? Math.max(0, Math.floor(preferred / pageSize)), lastPage)
  const pageRows = scopedFacts.slice(page * pageSize, (page + 1) * pageSize)
  const officialRows = scopedOfficial.slice(Math.max(0, page * pageSize - scopedFacts.length), Math.max(0, (page + 1) * pageSize - scopedFacts.length))
  const selectedOfficial = view === "timeline" ? officialEvents.find(event => event.id === (playing?.id ?? officialId)) : undefined
  const conflictRows = view === "matrix" && onlyConflicts
    ? rows.filter(item => !item.restricted && Object.values(observationDifferences(item.observations ?? [])).some(Boolean)) : undefined
  const viewRows = view === "narrative" ? narrative : conflictRows ?? pageRows
  const selected = selectedOfficial || (!playing && selection === null) ? undefined : viewRows.find(item => item.id === (playing?.id ?? selection?.itemId ?? initialItem)) ?? viewRows[0]
  const activeSource = selected && !selected.restricted && selection?.itemId === selected.id && selection.revision === selected.revision
    ? selected.sources.find(source => source.id === selection.sourceId && source.status === "AVAILABLE")
    : undefined

  const open = useCallback((item: EvidenceNote, source?: Source, observation?: FactObservation) => {
    returnToSource.current = undefined
    setOriginal(undefined)
    setOfficialId(undefined)
    setSelection(previous => ({
      itemId: item.id, revision: item.revision, sourceId: source?.id, observationId: observation?.id,
      showSources: source ? true : previous?.itemId === item.id ? previous.showSources : undefined,
    }))
  }, [])

  function openFact(item: EvidenceNote, source?: Source, observation?: FactObservation) {
    revealFact.current = !matrixOnly
    open(item, source, observation)
  }

  useLayoutEffect(() => {
    if (!revealFact.current) return
    revealFact.current = false
    const panel = factPanel.current
    if (!panel || getComputedStyle(panel).position === "sticky") return
    panel.focus({ preventScroll: true })
    panel.scrollIntoView({ block: "start" })
  }, [selection])

  const stopReplay = useCallback(() => {
    setPlayIndex(undefined)
    const previous = replayReturn.current
    replayReturn.current = null
    if (!previous) return
    setSelection(previous.selection)
    setOfficialId(previous.officialId)
    setPageIndex(previous.page)
    setTimelineScope(previous.scope)
  }, [])

  const replayCount = playOrder.length
  const replayActive = playing !== undefined
  const stepReplay = useCallback((delta: number) => {
    setPlayIndex(previous => previous === undefined ? undefined : Math.max(0, Math.min(replayCount - 1, previous + delta)))
    setSelection(undefined)
  }, [replayCount])

  useEffect(() => {
    if (!replayActive || view !== "timeline") return
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable],[role=slider],[role=dialog]"))) return
      if (!["ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) return
      event.preventDefault()
      if (event.key === "Escape") stopReplay()
      else stepReplay(event.key === "ArrowLeft" ? -1 : 1)
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [replayActive, view, stepReplay, stopReplay])

  function startReplay() {
    replayReturn.current = { selection, officialId, page: pageIndex, scope: timelineScope }
    setSelection(undefined)
    setOfficialId(undefined)
    setPlayIndex(0)
  }

  function scopeTo(scope?: TimelineScope) {
    setTimelineScope(scope); setPageIndex(0); setOfficialId(undefined); setSelection(undefined)
  }

  function selectMarker(id: string) {
    if (playing) {
      const target = playOrder.findIndex(event => event.id === id)
      if (target >= 0) { setPlayIndex(target); setSelection(undefined) }
      return
    }
    const official = officialEvents.find(event => event.id === id)
    if (official) {
      const track = programTracks.find(track => track.id === official.programId)!
      const ids = scopeIds?.has(id) ? scopedOfficial.map(event => event.id) : officialEvents.filter(event => event.programId === track.id).map(event => event.id)
      if (!scopeIds?.has(id)) setTimelineScope({ label: track.title, ids })
      setPageIndex(Math.floor(((scopeIds?.has(id) ? scopedFacts.length : 0) + ids.indexOf(id)) / pageSize))
      setOfficialId(id)
      return
    }
    const item = knownItems.find(row => row.id === id)
    if (!item) return
    const available = scopeIds?.has(id) ? scopedFacts : rows
    const index = available.indexOf(item)
    if (scopeIds && !scopeIds.has(id) || index < 0) setTimelineScope(index < 0 ? { label: item.title, ids: [item.id] } : undefined)
    if (index < 0) { setQuery(""); setOnlyPending(false); setSourceFilter("all"); setLevelFilter("all") }
    setPageIndex(Math.max(0, Math.floor(index / pageSize)))
    openFact(item)
  }

  const focusedObservation = activeSource && selected?.observations?.find(entry => entry.id === selection?.observationId && entry.sourceId === activeSource.id)
  const differences = observationDifferences(selected?.observations ?? [])
  const selectedMarker = selected && timelineMarker(selected)
  const displayDate = selectedMarker?.detail.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,
    (_, year: string, month: string, day: string) => year + "年" + Number(month) + "月" + Number(day) + "日")
  const repeatsDisplayDate = (text?: string | null) => Boolean(text && [selectedMarker?.detail, displayDate].some(
    date => date?.replace(/\s/g, "") === text.replace(/\s/g, "")))
  const factContent = selected?.content.trim()
  const dateExcerpt = selected?.eventDate?.start ? selected.eventDate.text?.trim() : undefined
  const showContent = factContent && !repeatsDisplayDate(factContent)
  const showDateExcerpt = dateExcerpt && dateExcerpt !== factContent && !repeatsDisplayDate(dateExcerpt)
  const sourcesOpen = selection?.itemId === selected?.id ? selection?.showSources !== false : true
  const originalSource = original && selected && !selected.restricted &&
    original.itemId === selected.id && original.revision === selected.revision
    ? selected.sources.find(source => source.id === original.sourceId && source.status === "AVAILABLE") : undefined
  const activeOriginal = originalSource ? original : undefined
  const relatedOriginal = activeOriginal?.source ? knownItems.filter(item => !item.restricted && item.sources.some(source =>
    source.status === "AVAILABLE" && source.documentId === originalSource?.documentId)) : []

  useEffect(() => {
    if (!activeOriginal || activeOriginal.source || activeOriginal.failed) return
    const controller = new AbortController()
    readChronologySource(matterId, activeOriginal.itemId, activeOriginal.revision, activeOriginal.sourceId, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setOriginal(current => current === activeOriginal ? (result.status === "AVAILABLE"
          ? { ...current, source: result } : { ...current, failed: true }) : current)
      }).catch(() => {
        if (!controller.signal.aborted) setOriginal(current => current === activeOriginal ? { ...current, failed: true } : current)
      })
    return () => controller.abort()
  }, [activeOriginal, matterId])

  const originalOpen = Boolean(activeOriginal)
  useLayoutEffect(() => {
    if (originalOpen) {
      backFromOriginal.current?.focus({ preventScroll: true })
    } else if (returnToComparison.current) {
      const button = Array.from(comparisonPanel.current?.querySelectorAll<HTMLButtonElement>("[data-comparison-source]") ?? [])
        .find(entry => entry.dataset.comparisonSource === returnToComparison.current)
      returnToComparison.current = undefined
      button?.focus()
    } else if (returnToSource.current) {
      factPanel.current?.focus({ preventScroll: true })
    }
  }, [originalOpen])

  useEffect(() => {
    if (!activeOriginal?.source) return
    const viewport = originalContent.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    const highlight = originalContent.current?.querySelector("mark")
    if (!viewport || !highlight) return
    const quote = highlight.getBoundingClientRect()
    if (getComputedStyle(viewport).overflowY === "visible") {
      if (quote.top < 0 || quote.bottom > window.innerHeight) highlight.scrollIntoView({ block: "center" })
    } else if (viewport.scrollHeight > viewport.clientHeight) {
      const panel = viewport.getBoundingClientRect()
      if (quote.top < panel.top || quote.bottom > panel.bottom) viewport.scrollTop += quote.top - panel.top - viewport.clientHeight / 3
    }
  }, [activeOriginal])

  async function assess(item: EvidenceNote, change: ChronologyChange) {
    if (assessmentPending) return
    setAssessmentPending(true)
    setAssessmentError(undefined)
    try {
      const result = await readPersonal<{ revision: number }>(workspaceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assess-chronology", matterId, data: { evidenceItemId: item.id, expectedRevision: item.revision, change } }),
      })
      setSelection(previous => previous?.itemId === item.id ? { ...previous, revision: result.revision } : previous)
      onObservationsSaved?.()
    } catch (cause) {
      setAssessmentError({ itemId: item.id, message: cause instanceof Error ? cause.message : "无法更新核对标记" })
    } finally {
      setAssessmentPending(false)
    }
  }

  async function exportVisible(kind: "facts" | "narrative") {
    const selected = (kind === "narrative" ? narrative : conflictRows ?? scopedFacts).filter(item => !item.restricted)
    setExporting(true)
    setExportError("")
    try {
      const result = await readPersonal<{ mime: string; suffix: string; text: string }>(workspaceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export-chronology", matterId, data: { kind, items: selected.map(item => ({ id: item.id, revision: item.revision })) } }),
      })
      const url = URL.createObjectURL(new Blob([result.text], { type: result.mime }))
      const link = document.createElement("a")
      link.href = url
      link.download = (kind === "facts" ? "案情事实表" : "事实经过") + "." + result.suffix
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "导出未完成")
    } finally {
      setExporting(false)
    }
  }

  const columns = new Map<string, Source>()
  const matrixRows = conflictRows ?? (matrixScope === "item" && selected ? [selected] : pageRows)
  const matrix = view === "matrix" ? matrixRows.map(item => {
    const observationEntries = new Map<string, FactObservation[]>()
    for (const record of item.observations ?? []) {
      const entries = observationEntries.get(record.sourceId)
      if (entries) entries.push(record)
      else observationEntries.set(record.sourceId, [record])
    }
    const byDocument = new Map<string, Source[]>()
    if (!item.restricted) for (const source of item.sources) {
      if (source.status !== "AVAILABLE" || !source.documentId) continue
      columns.set(source.documentId, source)
      const entries = byDocument.get(source.documentId)
      if (entries) entries.push(source)
      else byDocument.set(source.documentId, [source])
    }
    return { item, byDocument, observationEntries }
  }) : []

  const cutoffControl = <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
    <span>截至</span>
    <ChronologySelect label="截至材料出现时点" items={{ "": "全部", ...chronologyStages }} value={cutoff} onChange={value => {
      if (playing) stopReplay()
      setOriginal(undefined)
      setCutoff(value as typeof cutoff)
      scopeTo()
    }} />
  </div>

  const filters = <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
    {view !== "timeline" && cutoffControl}
    <InputGroup className="w-full max-w-xs">
      <InputGroupAddon><SearchIcon aria-hidden /></InputGroupAddon>
      <InputGroupInput aria-label="搜索事实和出处" placeholder="搜索事实、参与人或材料名"
        value={query} onChange={event => { setQuery(event.target.value); scopeTo() }} />
    </InputGroup>
    {filter}
    <ChronologySelect label="来源与核对筛选" value={sourceFilter}
      items={{ all: "全部记载", statement: "仅有当事人陈述", conflict: "只看记载不一", key: "只看关键事实" }}
      onChange={value => { setSourceFilter(value as typeof sourceFilter); scopeTo() }} />
    {grading && view === "timeline" && <ChronologySelect label="筛选事件等级" value={levelFilter}
      items={{ all: "全部等级", ...timelineGradeOptions }}
      onChange={value => { setLevelFilter(value as typeof levelFilter); scopeTo() }} />}
    <label className="flex items-center gap-2 text-xs">
      <Checkbox checked={onlyPending} onCheckedChange={value => { setOnlyPending(value); scopeTo() }} />仅待核对
    </label>
  </div>

  function gradeControl(event: TimelineEventReference, level?: TimelineLevel | null, inFieldGroup?: boolean) {
    if (!grading) return null
    return grading.canWrite ? <TimelineGradeControl level={level} busy={grading.pending} inFieldGroup={inFieldGroup} compact={inFieldGroup && !matrixOnly}
      onChange={value => grading.save(event, value)} /> : level ? <span className="col-span-full"><TimelineGradeBadge level={level} /></span> : null
  }

  return <section aria-label="案件事实看板" className={cn("grid min-w-0 gap-4", !matrixOnly && "@container/chronology")}>
    {!matrixOnly && <div className="flex flex-wrap items-center justify-between gap-2">
      <Tabs value={view} onValueChange={value => {
        if (playIndex !== undefined) stopReplay()
        if (value !== "narrative") setPageIndex(Math.max(0, Math.floor(rows.findIndex(item => item.id === selected?.id) / pageSize)))
        if (views.some(([id]) => id === value)) setView(value as typeof view)
      }}>
        <TabsList aria-label="看板视图">
          {views.map(([value, label]) => <TabsTrigger key={value} value={value} className="px-2.5">{label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {onObservationsSaved && !cutoff && !shown && <Button size="sm" variant="outline" disabled={exporting}
        onClick={() => void exportVisible(view === "narrative" ? "narrative" : "facts")}>
        <DownloadIcon data-icon="inline-start" />{view === "narrative" ? "导出事实经过" : "导出当前筛选 · CSV"}
      </Button>}
      {exportError && !cutoff && !shown && <p role="alert" className="basis-full text-end text-xs text-destructive">{exportError}</p>}
    </div>}
    {view !== "timeline" && filters}
    {view !== "timeline" && !viewRows.length ? <p className="text-sm text-muted-foreground">没有符合条件的记录。</p> :
      <div className={cn("grid min-w-0 items-start gap-4", matrixOnly
        ? "lg:grid-cols-[minmax(0,1fr)_clamp(17rem,26vw,25rem)]"
        : "@min-[62rem]/chronology:grid-cols-[minmax(0,1fr)_clamp(20rem,33cqw,25rem)]")}>
        <div className="grid min-w-0 gap-3">
          {view === "timeline" && <>
            <FactTrace tracks={dataTracks} selectedId={playing?.id ?? selectedOfficial?.id ?? selected?.id}
              onSelect={selectMarker} onScope={shown ? () => {} : scopeTo}
              cutoff={cutoffControl} directions={directions}
              display={<Popover>
                <PopoverTrigger render={<Button size="xs" variant="outline" />}><EyeIcon data-icon="inline-start" />显示</PopoverTrigger>
                <PopoverContent className="grid w-52 gap-2 text-xs">
                  <label className="flex items-center gap-2"><Checkbox checked={showClaims} onCheckedChange={setShowClaims} />主张</label>
                  <label className="flex items-center gap-2"><Checkbox checked={showDirections} onCheckedChange={setShowDirections} />材料写明的指向</label>
                </PopoverContent>
              </Popover>}
              review={<FactReviewQueue items={knownItems} onOpen={item => selectMarker(item.id)} />}
              startReplay={allMarkers.some(marker => marker.day && !marker.claim) || officialEvents.length ? startReplay : undefined}
              replay={playing && shown && replayPosition !== undefined ? { current: { title: playing.title, date: playing.detail }, index: replayPosition,
                count: playOrder.length, shown, step: stepReplay, stop: stopReplay } : undefined}
              onNarrative={() => { if (playing) stopReplay(); setView("narrative") }}
              options={<ChronologySelect label="时间轴泳道" value={laneMode}
                items={{ category: "按事件类型", program: "按办理程序", source: "按材料", person: "按主体", none: "不分泳道" }}
                onChange={value => setLaneMode(value as typeof laneMode)} />} />
            <FactTable rows={pageRows} selectedId={selected?.id} onSelect={shown ? item => selectMarker(item.id) : openFact}
              ascending={ascending} onSort={() => { setAscending(value => !value); setPageIndex(0) }} filters={<>
              {filters}
              {cutoff && <Badge variant="outline">按材料出现时点 · 未登记的材料仅在「全部」中显示</Badge>}
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={showClaims}
                onCheckedChange={setShowClaims} />显示主张</label>
              {timelineScope && <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary">{timelineScope.label}</Badge>
                <Button variant="ghost" size="xs" onClick={() => scopeTo()}>清除时间轴筛选</Button>
              </div>}
            </>} official={officialRows} onOfficial={selectMarker} selectedOfficialId={selectedOfficial?.id} />
          </>}
          {view === "matrix" && <>
            <Tabs value={matrixScope} onValueChange={value => setMatrixScope(value === "page" ? "page" : "item")}>
              <TabsList aria-label="对照范围">
                <TabsTrigger value="item">当前事项</TabsTrigger><TabsTrigger value="page">本页事项</TabsTrigger>
              </TabsList>
            </Tabs>
            <label className="flex items-center gap-2 text-xs"><Checkbox checked={onlyConflicts} onCheckedChange={setOnlyConflicts} />只看记载不一（全案）</label>
            <Card className="min-w-0 gap-0 py-0">
              <Table>
                <TableCaption className="sr-only">各份材料与事实要点的出处对照</TableCaption>
                <TableHeader className="bg-muted/50"><TableRow>
                  <TableHead scope="col" className="sticky start-0 min-w-40 bg-muted">事实要点</TableHead>
                  {Array.from(columns, ([id, source]) => <TableHead key={id} scope="col" className="min-w-36 whitespace-normal">
                    {source.documentName} · V{source.documentVersion}
                  </TableHead>)}
                </TableRow></TableHeader>
                <TableBody>{matrix.map(({ item, byDocument, observationEntries }) => <TableRow key={item.id} className="group" data-state={item.id === selected?.id ? "selected" : undefined}>
                  <TableHead scope="row" className="sticky start-0 h-auto bg-card py-2 align-top whitespace-normal group-data-[state=selected]:bg-muted">
                    <Button size="sm" variant="link" className="h-auto whitespace-normal p-0 text-start text-foreground" onClick={() => openFact(item)}>{item.title}</Button>
                    <p className="mt-1 text-xs font-normal text-muted-foreground">{timelineMarker(item).detail}</p>
                  </TableHead>
                  {Array.from(columns.keys(), id => <TableCell key={id} className="align-top whitespace-normal">
                    {item.restricted ? <span aria-label="来源受限">—</span> : byDocument.get(id)?.map(source => {
                      const records = observationEntries.get(source.id)
                      return records?.length ? <div key={source.id} className="grid gap-1.5">
                        {records.map(entry => <Button key={entry.id} size="sm" variant={focusedObservation?.id === entry.id ? "secondary" : "ghost"}
                          aria-pressed={focusedObservation?.id === entry.id}
                          className="h-auto min-w-0 justify-start whitespace-normal px-2 py-1.5 text-xs" onClick={() => openFact(item, source, entry)}>
                          <ObservationValues observation={entry} />
                        </Button>)}
                      </div> : <Button key={source.id} size="sm" variant={activeSource?.id === source.id ? "secondary" : "ghost"}
                        className="h-auto whitespace-normal text-left" onClick={() => openFact(item, source)}>
                        {relations[source.relation ?? "CONTEXT"]} · {source.locationLabel ?? "原件"}
                      </Button>
                    })}
                  </TableCell>)}
                </TableRow>)}</TableBody>
              </Table>
            </Card>
          </>}
          {view !== "narrative" && !shown && !conflictRows && lastPage > 0 && <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPageIndex(page - 1)}>上一页</Button>
            <span className="text-xs text-muted-foreground">第 {page + 1} 页 / 共 {lastPage + 1} 页</span>
            <Button size="sm" variant="outline" disabled={page === lastPage} onClick={() => setPageIndex(page + 1)}>下一页</Button>
          </div>}
          {view === "narrative" && <FactNarrative items={narrative} selectedId={selected?.id} onOpen={openFact} />}
        </div>

        {activeOriginal ? <ChronologyTrace matrixOnly={matrixOnly} key={activeOriginal.sourceId} label="固定版本原文"
          icon={<FileTextIcon aria-hidden className="size-4" />} kind={<Button ref={backFromOriginal} variant="ghost" size="xs" className="-ms-1 w-fit"
            onClick={() => {
              if (activeOriginal.field && activeOriginal.observation) {
                returnToComparison.current = activeOriginal.field + "/" + activeOriginal.observation.id
              } else {
                returnToSource.current = { itemId: activeOriginal.itemId, revision: activeOriginal.revision,
                  sourceId: activeOriginal.sourceId, observationId: activeOriginal.observation?.id }
              }
              setOriginal(undefined)
            }}><ChevronLeftIcon data-icon="inline-start" />返回事实</Button>}
          title={activeOriginal.source?.documentName ?? originalSource?.documentName ?? "固定版本原文"}
          onClose={() => { setOriginal(undefined); setSelection(null) }}>
          {activeOriginal.source ? <>
            <div ref={originalContent} className="grid min-w-0 gap-2.5 px-3.5 py-3">
              <FixedSourcePreview source={activeOriginal.source} marks={observationMarks(activeOriginal.observation, activeOriginal.field)} detailPanel
                highlightLabel={activeOriginal.field === "date" ? "日期引文" : activeOriginal.field === "amount" ? "金额引文"
                  : activeOriginal.observation ? "引用片段" : undefined} />
              {activeOriginal.field && !activeOriginal.source.text &&
                <p className="text-xs text-muted-foreground">原件可读，暂无可高亮的文本。</p>}
            </div>
            {relatedOriginal.length > 0 && <TraceGroup label="关联事实" count={relatedOriginal.length}>
              <ul className="divide-y px-3.5 pb-2">
                {relatedOriginal.map(item => <li key={item.id}>
                  <Button size="xs" variant="ghost"
                    className="flex h-auto min-h-7 w-full justify-between whitespace-normal px-0 py-1.5 text-start [overflow-wrap:anywhere]"
                    onClick={() => { setOriginal(undefined); selectMarker(item.id) }}>
                    <span className="min-w-0">{item.title}</span><ChevronRightIcon aria-hidden />
                  </Button>
                </li>)}
              </ul>
            </TraceGroup>}
          </> : <div className="grid gap-2.5 px-3.5 py-3">
            {activeOriginal.failed ? <>
              <p role="alert" className="text-sm text-muted-foreground">该出处当前不可读。</p>
              <Button size="xs" variant="outline" className="w-fit"
                onClick={() => setOriginal({ ...activeOriginal, failed: false })}>重试</Button>
            </> : <InlineLoading label="正在打开出处…" />}
          </div>}
        </ChronologyTrace> : selectedOfficial ? <ChronologyTrace matrixOnly={matrixOnly} key={selectedOfficial.id} label="程序事项详情"
          icon={<CalendarClockIcon aria-hidden className="size-4" />} kind={<Badge variant="secondary">{selectedOfficial.kind}</Badge>} title={selectedOfficial.title}
          summary={<p className="break-words text-sm text-muted-foreground tabular-nums">{selectedOfficial.detail}</p>}
          onClose={() => { setOfficialId(undefined); setSelection(null) }}>
          {grading && <div className="px-3.5 py-2">{gradeControl(selectedOfficial.event, selectedOfficial.level)}</div>}
          <TraceGroup label="程序记录" count={1}>
            <div className={traceEntryClassName}>
              <TraceEntry icon={<CalendarClockIcon aria-hidden className="size-3.5" />} title={selectedOfficial.programTitle}
                details={<Link className={cn(buttonVariants({ variant: "link", size: "xs" }), "h-auto whitespace-normal px-0 text-start font-sans")}
                  href={{ pathname: "/matters/" + matterId + "/tasks", query: { program: selectedOfficial.programId } }}>打开程序详情</Link>} />
            </div>
          </TraceGroup>
        </ChronologyTrace> : selected ? <ChronologyTrace matrixOnly={matrixOnly} key={selected.id} label="要点与出处" panelRef={matrixOnly ? undefined : factPanel}
          title={selected.title}
          summary={<div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                <span>{selected.restricted ? "出处受限" : displayDate}</span>
                {!selected.restricted && <>
                  <span aria-hidden>·</span>
                  <span aria-hidden className={cn("size-1.5 rounded-full", tracksByCategory[factCategory(selected)].tone)} />
                  <span>{chronologyCategories[factCategory(selected)]}</span>
                </>}
                {selected.kind !== "FACT" && <span>· {kinds[selected.kind]}</span>}
              </p>
              <StatusBadge tone={selected.confirmedAt ? "success" : "muted"}>{selected.confirmedAt ? "已核对" : "待核对"}</StatusBadge>
            </div>
            {!selected.restricted && <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
              {differences.date && <StatusBadge tone="warning" dot={false}>{matrixOnly ? "日期有分歧" : "材料日期记载不一"}</StatusBadge>}
              {differences.amount && <StatusBadge tone="warning" dot={false}>{matrixOnly ? "金额有分歧" : "材料金额记载不一"}</StatusBadge>}
              {onlyPartyStatements(selected) && <StatusBadge tone="warning" dot={false}>仅有当事人陈述</StatusBadge>}
              {selectedMarker?.planned && <Badge variant="outline">约定或应当发生</Badge>}
              {selected.chronologyAssessment?.nature === "estimated" && <Badge variant="outline">推定</Badge>}
              {selected.chronologyAssessment?.adverse && <Badge variant="destructive">不利 · 仅内部</Badge>}
            </div>}
          </div>} onClose={() => setSelection(null)}>
          {selected.restricted ? <p className="p-3 text-sm">部分出处不可读。</p> : <>
            {(showContent || showDateExcerpt) && <TraceGroup label="事实内容" defaultOpen>
              <div className="grid min-w-0 gap-1.5 px-3.5 py-2 text-sm">
                {showContent && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{factContent}</p>}
                {showDateExcerpt && <p className="text-xs text-muted-foreground">原始时间表述 · {dateExcerpt}</p>}
              </div>
            </TraceGroup>}
            <section aria-label="材料记录" className="border-t first:border-t-0">
              <TraceGroup label="材料记录" meta={selected.sources.length + " 份材料"} open={sourcesOpen}
                actions={selected.sources.length > 0 && (selected.canEdit || onObservationsSaved && selected.sources.some(source => source.hasAnchor)) && <>
                  {onObservationsSaved && selected.sources.some(source => source.hasAnchor) &&
                    <FactAnalysisDesk key={selected.revision} item={selected} matterId={matterId} onSaved={onObservationsSaved} />}
                  {selected.canEdit && <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="材料记录操作" />}>
                      <EllipsisIcon aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(selected, "link")}>关联来源</DropdownMenuItem>
                      {selected.sources.some(source => !source.legacy) &&
                        <DropdownMenuItem onClick={() => onEdit(selected, "unlink")}>撤回来源关系</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>}
                </>}
                onOpenChange={showSources => setSelection(previous => ({
                  ...(previous?.itemId === selected.id ? previous : {}),
                  itemId: selected.id, revision: selected.revision, showSources,
                }))}>
                <FactRecordComparison item={selected} panelRef={comparisonPanel} onOpenSource={(observation, field) =>
                  setOriginal({ itemId: selected.id, revision: selected.revision, sourceId: observation.sourceId, observation, field })} />
                {selected.sources.length ? <ol>
                  {selected.sources.map(source => {
                    const expanded = source.id === activeSource?.id
                    const records = selected.observations?.filter(entry => entry.sourceId === source.id)
                    const recordCount = records?.length ?? 0
                    const adoptedFields = [
                      records?.some(entry => entry.id === selected.chronologyAssessment?.dateObservationId) && "日期",
                      records?.some(entry => entry.id === selected.chronologyAssessment?.amountObservationId) && "金额",
                    ].filter(Boolean).join("、")
                    const sourceNote = source.status !== "AVAILABLE" ? "不可读取"
                      : !expanded && (adoptedFields ? "已采用" + adoptedFields : recordCount > 1 ? recordCount + " 条记载" : "")
                    return <li key={source.id} className="relative">
                      <Collapsible open={expanded} className="min-w-0"
                        onOpenChange={next => open(selected, next ? source : undefined)}>
                        <Item size="xs" className="flex-nowrap gap-0 rounded-none border-0 p-0">
                          <CollapsibleTrigger disabled={source.status !== "AVAILABLE"}
                            className={cn(traceEntryClassName, "w-auto min-h-8 flex-1 items-center py-1.5 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2")}>
                            <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" />
                            <span className="min-w-0 flex-1 text-[0.8125rem] font-medium leading-snug [overflow-wrap:anywhere]">
                              {source.documentName ?? "来源不可用"}
                            </span>
                            {sourceNote && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{sourceNote}</span>}
                          </CollapsibleTrigger>
                          {expanded && <ChronologySourceMenu source={source} pending={assessmentPending}
                            onStageChange={selected.canEdit && onObservationsSaved
                              ? value => void assess(selected, { kind: "sourceStage", sourceId: source.id, value })
                              : undefined} />}
                        </Item>
                        <CollapsibleContent className="grid gap-2 px-3.5 pb-3">
                          {expanded && <ChronologySource key={JSON.stringify([selected.id, selected.revision, source.id])}
                            matterId={matterId} item={selected} source={source} records={records} focusedId={focusedObservation?.id}
                            pending={assessmentPending} onAssess={onObservationsSaved ? change => void assess(selected, change) : undefined}
                            onOriginal={(fixed, entry) => setOriginal({ itemId: selected.id, revision: selected.revision, sourceId: source.id, source: fixed, observation: entry })}
                            onOriginalControl={(button, observationId) => {
                              const pending = returnToSource.current
                              if (!button || pending?.itemId !== selected.id || pending.revision !== selected.revision ||
                                pending.sourceId !== source.id || pending.observationId !== observationId) return
                              returnToSource.current = undefined
                              const active = document.activeElement
                              if (active === factPanel.current || active === document.body) button.focus()
                            }}
                            onSaved={onObservationsSaved && (result => {
                              setSelection({ itemId: selected.id, revision: result.revision, sourceId: source.id,
                                observationId: result.observationId, showSources: true })
                              onObservationsSaved()
                            })} />}
                        </CollapsibleContent>
                      </Collapsible>
                    </li>
                  })}
                </ol> : <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3.5 py-2 ps-10">
                  <p className="text-xs text-muted-foreground">尚未关联出处。</p>
                  {selected.canEdit && <Button size="xs" variant="outline" onClick={() => onEdit(selected, "link")}>关联来源</Button>}
                </div>}
              </TraceGroup>
            </section>
            {(selected.canEdit || grading?.canWrite || selected.level || selected.chronologyAssessment?.dispute) &&
              <TraceGroup label="核对与标注" meta={[
                selected.chronologyAssessment?.dispute && selected.chronologyAssessment.dispute !== "pending"
                  ? (matrixOnly ? chronologyDisputes : partyDisputes)[selected.chronologyAssessment.dispute] : "",
                selected.level ? timelineLevelLabels[selected.level] : "",
              ].filter(Boolean).join(" · ")}>
                <div className="grid gap-2 px-3.5 py-2.5">
                  <FactAssessment matrixOnly={matrixOnly} item={selected} inferredCategory={inferredCategory(selected.observations ?? [])}
                    grade={gradeControl({ kind: "fact", id: selected.id }, selected.level, true)}
                    pending={assessmentPending} onChange={onObservationsSaved ? change => void assess(selected, change) : undefined} />
                  {selected.canEdit && <Button size="xs" variant="ghost" className="w-fit" onClick={() => onEdit(selected, "revise")}>修订要点</Button>}
                </div>
              </TraceGroup>}
            {assessmentError?.itemId === selected.id && <p role="alert" className="px-3.5 py-2 text-xs text-destructive">{assessmentError.message}</p>}
            <FactDirections item={selected} items={knownItems} pending={assessmentPending}
              onOpen={(item, source) => { selectMarker(item.id); if (source) open(item, source) }}
              onChange={onObservationsSaved && !cutoff ? change => void assess(selected, change) : undefined} />
            {((onObservationsSaved && !cutoff) || selected.revision > 1) &&
              <FactChangeLog matterId={matterId} item={selected} showChanges={Boolean(onObservationsSaved && !cutoff)}>
                {selected.revision > 1 && <div><ObservationHistory matterId={matterId} item={selected} /></div>}
              </FactChangeLog>}
          </>}
        </ChronologyTrace> : <ChronologyTrace matrixOnly={matrixOnly} label="事项详情" icon={<ScaleIcon aria-hidden className="size-4" />} title="事项详情"
          summary={<p className="text-xs text-muted-foreground">选择事项查看详情</p>} />}
      </div>}
  </section>
}

function FactNarrative({ items, selectedId, onOpen }: {
  items: EvidenceNote[]; selectedId?: string; onOpen(item: EvidenceNote, source?: Source): void
}) {
  const [format, setFormat] = useState<"timeline" | "table" | "prose">("timeline")
  const dated: EvidenceNote[] = []
  const undated: EvidenceNote[] = []
  for (const item of items) {
    const hasDate = !item.restricted && timelineMarker(item).day
    const group = hasDate ? dated : undated
    group.push(item)
  }

  function list(rows: EvidenceNote[], chronological: boolean) {
    return <ol aria-label={chronological ? "事实经过时间轴" : "日期未明与来源受限的事项"}>
      {rows.map(item => {
        const selected = item.id === selectedId
        return <li key={item.id} className={cn("relative pb-5 ps-6 last:pb-0",
          chronological && "before:absolute before:-bottom-2 before:start-[5px] before:top-2 before:border-s before:border-border last:before:hidden")}>
          <span aria-hidden className={cn("absolute start-0 top-1.5 size-3 rounded-full border-2 border-card ring-1 ring-border",
            chronological ? "bg-primary" : "bg-muted", selected && "ring-primary")} />
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium tabular-nums text-foreground">{timelineMarker(item).detail}</span>
              <span>{kinds[item.kind]}</span>
              <Badge variant={item.confirmedAt ? "secondary" : "outline"}>{item.confirmedAt ? "已核对" : "待核对"}</Badge>
              <TimelineGradeBadge level={item.level} />
            </div>
            <Button size="sm" variant="link" aria-pressed={selected}
              className="h-auto justify-self-start whitespace-normal p-0 text-start font-semibold"
              onClick={() => onOpen(item)}>{item.title}</Button>
            {!item.restricted && <p className="whitespace-pre-wrap break-words text-sm">{item.content}</p>}
            {!item.restricted && <div className="flex flex-wrap gap-1.5 empty:hidden">
              {item.sources.filter(source => source.status === "AVAILABLE").map(source => <Button
                key={source.id} size="sm" variant="outline" className="h-auto min-w-0 whitespace-normal text-start"
                onClick={() => onOpen(item, source)}>{source.documentName} · V{source.documentVersion}</Button>)}
            </div>}
          </div>
        </li>
      })}
    </ol>
  }

  return <Card><CardContent className="grid min-w-0 gap-5">
    <Tabs value={format} onValueChange={value => setFormat(value as typeof format)}>
      <TabsList aria-label="事实经过视图">
        <TabsTrigger value="timeline">时间线</TabsTrigger>
        <TabsTrigger value="table">大事记表</TabsTrigger>
        <TabsTrigger value="prose">叙述</TabsTrigger>
      </TabsList>
    </Tabs>
    {format === "timeline" ? <>
      {dated.length > 0 && list(dated, true)}
      {undated.length > 0 && <section className={cn("grid gap-3", dated.length > 0 && "border-t pt-4")}>
        <h3 className="text-sm font-semibold">日期未明与来源受限</h3>
        {list(undated, false)}
      </section>}
    </> : format === "table" ? <Table>
      <TableCaption className="sr-only">事实经过大事记</TableCaption>
      <TableHeader><TableRow><TableHead>日期</TableHead><TableHead>事项</TableHead><TableHead>固定出处</TableHead></TableRow></TableHeader>
      <TableBody>{[...dated, ...undated].map(item => <TableRow key={item.id}>
        <TableCell className="whitespace-normal">{timelineMarker(item).detail}</TableCell>
        <TableCell className="whitespace-normal"><Button size="xs" variant="link" className="h-auto whitespace-normal px-0 text-start"
          onClick={() => onOpen(item)}>{item.title}</Button>
          {item.kind === "CLAIM" && <Badge variant="outline" className="ms-1">主张</Badge>}
        </TableCell>
        <TableCell className="whitespace-normal">{!item.restricted && item.sources.map(source => <Button size="xs" variant="link" key={source.id}
          className="h-auto whitespace-normal px-0 text-start" onClick={() => onOpen(item, source)}>
          {source.documentName} · V{source.documentVersion}
        </Button>)}</TableCell>
      </TableRow>)}</TableBody>
    </Table> : <div className="grid gap-4">
      {Object.entries(chronologyCategories).map(([category, title]) => {
        const group = [...dated, ...undated].filter(item => factCategory(item) === category && !item.restricted)
        return group.length > 0 && <section key={category} className="grid gap-2">
          <h3 className="border-b pb-1 text-sm font-semibold">{title}</h3>
          {group.map(item => <div key={item.id} className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">{timelineMarker(item).detail} {item.kind === "CLAIM" && "· 当事人主张"}</span>
            <Button size="xs" variant="link" className="h-auto w-fit whitespace-normal px-0 text-start" onClick={() => onOpen(item)}>{item.title}</Button>
            {item.content && <p className="whitespace-pre-wrap break-words">{item.content}</p>}
            <div className="flex flex-wrap gap-1">{item.sources.map(source => <Button size="xs" variant="outline" key={source.id}
              className="h-auto whitespace-normal" onClick={() => onOpen(item, source)}>{source.documentName} · V{source.documentVersion}</Button>)}</div>
          </div>)}
        </section>
      })}
    </div>}
    {!items.length && <p className="text-sm text-muted-foreground">没有可叙述的事实经过。</p>}
  </CardContent></Card>
}

function FactTable({ rows, selectedId, onSelect, filters, official, onOfficial, selectedOfficialId, ascending, onSort }: {
  rows: EvidenceNote[]; selectedId?: string; filters: ReactNode; onSelect(item: EvidenceNote, source?: Source): void
  ascending: boolean; onSort(): void
  official: (ProgramTrack["events"][number] & { programTitle: string })[]; onOfficial(id: string): void; selectedOfficialId?: string
}) {
  const SortIcon = ascending ? ArrowUpIcon : ArrowDownIcon
  const textButton = "h-auto justify-start whitespace-normal p-0 text-start text-foreground"
  return <Card>
    <CardHeader className="gap-3"><CardTitle>事实表</CardTitle>{filters}</CardHeader>
    <Table>
      <TableCaption className="sr-only">案件事实与出处</TableCaption>
      <TableHeader className="border-t bg-muted/50"><TableRow>
        <TableHead scope="col" className="px-4" aria-sort={ascending ? "ascending" : "descending"}>
          <Button className="gap-1 px-0" size="sm" variant="ghost" onClick={onSort}>日期 <SortIcon data-icon="inline-end" aria-hidden /></Button>
        </TableHead>
        <TableHead scope="col" className="px-4">事项</TableHead>
        <TableHead scope="col" className="min-w-32 px-4">来源</TableHead>
        <TableHead scope="col" className="px-4">状态</TableHead>
      </TableRow></TableHeader>
      <TableBody>{rows.map(item => <TableRow key={item.id} data-state={selectedId === item.id ? "selected" : undefined}>
        <TableCell className="min-w-24 px-4 py-3 whitespace-normal tabular-nums">{timelineMarker(item).detail}</TableCell>
        <TableCell className="min-w-40 px-4 py-3 whitespace-normal">
          <Button size="sm" variant="link" aria-pressed={selectedId === item.id}
            className={cn(textButton, "font-medium")} onClick={() => onSelect(item)}>
            {item.title}
          </Button>
          {!item.restricted && item.content && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.content}</p>}
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{kinds[item.kind]}<TimelineGradeBadge level={item.level} />
            {onlyPartyStatements(item) && <StatusBadge tone="warning" dot={false}>仅有当事人陈述</StatusBadge>}
            {item.chronologyAssessment?.dispute === "disputed" && <StatusBadge tone="warning" dot={false}>{partyDisputes.disputed}</StatusBadge>}
            {item.chronologyAssessment?.adverse && <Badge variant="destructive">仅内部</Badge>}
          </span>
        </TableCell>
        <TableCell className="min-w-32 max-w-48 px-4 py-3 whitespace-normal break-words">{item.restricted ? "来源受限"
          : item.sources.length ? <div className="grid justify-items-start gap-1">{[...new Map(item.sources.filter(source => source.status === "AVAILABLE").map(source => [source.documentId, source])).values()]
            .map(source => <Button key={source.id} size="sm" variant="link" className={textButton} onClick={() => onSelect(item, source)}>
              {source.documentName}
            </Button>)}</div> : <span className="text-muted-foreground">未关联</span>}</TableCell>
        <TableCell className="px-4 py-3"><StatusBadge tone={item.confirmedAt ? "success" : "muted"}>
          {item.confirmedAt ? "已核对" : "待核对"}
        </StatusBadge></TableCell>
      </TableRow>)}
        {official.map(event => <TableRow key={event.id} data-state={event.id === selectedOfficialId ? "selected" : undefined}>
          <TableCell className="px-4 py-3 whitespace-normal tabular-nums">{event.detail}</TableCell>
          <TableCell className="px-4 py-3 whitespace-normal">
            <Button size="sm" variant="link" aria-pressed={event.id === selectedOfficialId} className={textButton}
              onClick={() => onOfficial(event.id)}>{event.title}</Button>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{event.kind}<TimelineGradeBadge level={event.level} /></span>
          </TableCell>
          <TableCell className="px-4 py-3 whitespace-normal">{event.programTitle}</TableCell>
          <TableCell className="px-4 py-3"><StatusBadge tone="info">已登记</StatusBadge></TableCell>
        </TableRow>)}
        {!rows.length && !official.length && <TableRow><TableCell colSpan={4} className="px-4 py-3 text-muted-foreground">没有符合条件的事项。</TableCell></TableRow>}
      </TableBody>
    </Table>
  </Card>
}

function ChronologySourceMenu({ source, pending, onStageChange }: {
  source: Source; pending: boolean; onStageChange?: (value: ChronologyStage | null) => void
}) {
  const purpose = source.relation === "SUPPORTS" ? "用于支持本事实"
    : source.relation === "REBUTS" ? "用于反驳本事实"
      : source.relation === "CONTEXT" ? "作为背景材料" : "未标注"
  const stage = source.chronologyStage ? chronologyStages[source.chronologyStage] : "未登记"
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger render={<Button className="me-3.5" size="icon-xs" variant="ghost"
      aria-label={"材料设置 · " + (source.documentName ?? "当前材料")} />}>
      <EllipsisIcon aria-hidden />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-48">
      <DropdownMenuGroup>
        <DropdownMenuLabel>关联用途</DropdownMenuLabel>
        <p className="px-1.5 pb-1 text-xs">{purpose}</p>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      {onStageChange ? <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={pending}>出现时点 · {stage}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={source.chronologyStage ?? ""} onValueChange={value => {
            if (value !== (source.chronologyStage ?? "")) onStageChange((value || null) as ChronologyStage | null)
          }}>
            {Object.entries({ "": "未登记", ...chronologyStages }).map(([value, label]) =>
              <DropdownMenuRadioItem key={value} value={value}>{label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub> : <DropdownMenuGroup>
        <DropdownMenuLabel>出现时点 · {stage}</DropdownMenuLabel>
      </DropdownMenuGroup>}
    </DropdownMenuContent>
  </DropdownMenu>
}

function readChronologySource(matterId: string, evidenceItemId: string, revision: number, sourceId: string, signal: AbortSignal) {
  return readPersonal<FixedSource | { status: "UNAVAILABLE" }>(evidenceEndpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ action: "open-evidence-source", matterId, evidenceItemId, revision, sourceId }),
  })
}

function ChronologySource({ matterId, item, source, records, focusedId, pending, onAssess, onOriginal, onOriginalControl, onSaved }: {
  matterId: string; item: EvidenceNote; source: Source; records?: FactObservation[]; focusedId?: string
  pending?: boolean; onAssess?(change: ChronologyChange): void; onOriginal(source: FixedSource, observation?: FactObservation): void
  onOriginalControl(button: HTMLButtonElement | null, observationId?: string): void
  onSaved?(saved: ObservationSaved): void
}) {
  const [editing, setEditing] = useState<{ observation?: FactObservation; trigger: HTMLElement }>()
  const [splitRecord, setSplitRecord] = useState<{ id: string; title: string }>()
  const [preview, setPreview] = useState<FixedSource>()
  const [error, setError] = useState("")
  const { id, revision } = item
  const sourceId = source.id
  useEffect(() => {
    const controller = new AbortController()
    readChronologySource(matterId, id, revision, sourceId, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (result.status === "AVAILABLE") setPreview(result)
      else setError("该出处当前不可用。")
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [matterId, id, revision, sourceId])

  const recordActions = useRef(new Map<string, HTMLButtonElement>())
  const canRecord = Boolean(item.canEdit && source.hasAnchor && onSaved && preview?.text)
  const canSplit = Boolean(item.canEdit && onAssess && (item.observations?.length ?? 0) > 1)
  const canAssess = item.canEdit && onAssess
  const recordCount = records?.length ?? 0
  const addRecord = canRecord && <Button size="xs" variant="ghost" className="font-normal hover:underline"
    onClick={event => setEditing({ trigger: event.currentTarget })}>新增记载</Button>

  function adopt(entry: FactObservation, kind: "date" | "amount") {
    const hasValue = kind === "date" ? entry.data.date && entry.data.date.value.precision !== "UNKNOWN" : entry.data.amount?.value
    const chosen = item.chronologyAssessment?.[kind === "date" ? "dateObservationId" : "amountObservationId"] === entry.id
    if (!hasValue || (!canAssess && !chosen)) return null
    const label = kind === "date" ? "日期" : "金额"
    return canAssess ? <Button size="xs" variant={chosen ? "secondary" : "ghost"} disabled={pending}
      aria-label={chosen ? "撤销采用" + label : "采用此" + label}
      onClick={() => canAssess({ kind, value: chosen ? null : entry.id })}>{chosen ? "已采用" : "采用"}</Button>
      : <Badge variant="secondary">已采用</Badge>
  }

  return <>
    {!preview ? <section aria-label="固定出处">
      {error ? <p role="alert" className="text-xs">{error}</p> : <InlineLoading label="正在打开出处…" />}
    </section> : (recordCount === 0 || recordCount > 1 && canRecord) && <section aria-label="固定出处" className="grid min-w-0 gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Button size="xs" variant="ghost" className="font-normal hover:underline"
          aria-label={"查看固定原文 · " + preview.documentName}
          title={preview.documentName + " · V" + preview.documentVersion + " · " + preview.locationLabel}
          ref={button => onOriginalControl(button)} onClick={() => onOriginal(preview)}>查看固定原文</Button>
        {addRecord}
      </div>
      {preview.text && recordCount === 0 && <blockquote className="whitespace-pre-wrap rounded-md bg-muted/40 px-2.5 py-2 text-xs [overflow-wrap:anywhere]">{preview.text}</blockquote>}
    </section>}
    {!!records?.length && <div className="divide-y border-t">
      {records.map(entry => {
        return <div key={entry.id} className={cn("grid gap-1.5 px-1.5 py-2 text-xs", focusedId === entry.id && "bg-muted/35")}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2">
            <span className="font-medium">{statements[entry.data.statement]}</span>
            <div className="flex flex-wrap items-center gap-1">
              {preview && <Button size="xs" variant="ghost" className="font-normal hover:underline"
                ref={button => onOriginalControl(button, entry.id)} onClick={() => onOriginal(preview, entry)}>查看原文</Button>}
              {recordCount === 1 && addRecord}
              {(canRecord || canSplit) && <DropdownMenu>
                <DropdownMenuTrigger render={<Button ref={button => {
                  if (button) recordActions.current.set(entry.id, button)
                  else recordActions.current.delete(entry.id)
                }} size="icon-xs" variant="ghost" aria-label="记载操作" />}>
                  <EllipsisIcon aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canRecord && <DropdownMenuItem onClick={() => {
                    const trigger = recordActions.current.get(entry.id)
                    if (trigger) setEditing({ observation: entry, trigger })
                  }}>修订此条记载</DropdownMenuItem>}
                  {canSplit && <DropdownMenuItem onClick={() => setSplitRecord({ id: entry.id, title: "" })}>拆为独立事件</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>}
            </div>
          </div>
          <ObservationValues observation={entry} sourceActions={{ date: adopt(entry, "date"), amount: adopt(entry, "amount") }} />
          <ObservationExcerpt data={entry.data} sourceText={preview?.text} />
          {splitRecord?.id === entry.id && <form className="grid gap-1" onSubmit={event => {
            event.preventDefault()
            if (splitRecord.title.trim()) onAssess?.({ kind: "split", value: { observationId: entry.id, title: splitRecord.title } })
          }}>
            <Input aria-label="拆分后的事件标题" maxLength={200} value={splitRecord.title}
              onChange={event => setSplitRecord({ id: entry.id, title: event.target.value })} />
            <div className="flex gap-1">
              <Button size="xs" disabled={pending || !splitRecord.title.trim()} type="submit">确认拆分</Button>
              <Button size="xs" variant="ghost" type="button" onClick={() => setSplitRecord(undefined)}>取消</Button>
            </div>
          </form>}
        </div>
      })}
    </div>}
    {editing && preview?.text && onSaved && <ObservationEditor matterId={matterId} evidenceItemId={item.id} expectedRevision={item.revision}
      sourceId={source.id} sourceLabel={preview.documentName + " · V" + preview.documentVersion + " · " + preview.locationLabel}
      original={preview.text} observation={editing.observation} returnFocus={editing.trigger}
      close={() => setEditing(undefined)} onSaved={result => { setEditing(undefined); onSaved(result) }} />}
  </>
}