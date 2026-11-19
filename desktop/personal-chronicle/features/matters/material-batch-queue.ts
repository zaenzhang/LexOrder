import { readPersonal, workspaceEndpoint } from "./personal-client"

export type BatchRow = {
  key: string
  name: string
  category: string
  file?: File
  status: "waiting" | "sending" | "done" | "failed"
  error?: string
}

const empty: BatchRow[] = []
const cases = new Map<string, BatchRow[]>()
const running = new Set<string>()
const listeners = new Set<() => void>()

export function subscribeToBatch(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function batchRows(matterId: string) {
  return cases.get(matterId) ?? empty
}

function update(matterId: string, rows: BatchRow[]) {
  if (rows.length) cases.set(matterId, rows)
  else cases.delete(matterId)
  for (const listener of listeners) listener()
}

export function addBatchFiles(matterId: string, files: File[], category: string) {
  const added = files.map(file => ({
    key: crypto.randomUUID(), name: file.name, category, file, status: "waiting" as const,
  }))
  update(matterId, [...batchRows(matterId), ...added])
}

export function removeBatchRow(matterId: string, key: string) {
  if (!running.has(matterId)) update(matterId, batchRows(matterId).filter(row => row.key !== key))
}

export function clearCompletedRows(matterId: string) {
  if (!running.has(matterId)) update(matterId, batchRows(matterId).filter(row => row.status !== "done"))
}

// Capture the case and request key with each file. A tab change can remount the
// view while the next file is being sent. Response loss can retry the same key.
export async function submitBatch(matterId: string, status: "waiting" | "failed", key?: string) {
  if (running.has(matterId)) return
  const selected = batchRows(matterId).filter(row => row.status === status && (!key || row.key === key))
  if (!selected.length) return
  running.add(matterId)
  function patch(row: BatchRow, fields: Partial<BatchRow>) {
    update(matterId, batchRows(matterId).map(item => item.key === row.key ? { ...item, ...fields } : item))
  }
  try {
    for (const row of selected) {
      if (!row.file) continue
      patch(row, { status: "sending", error: undefined })
      const form = new FormData()
      form.set("matterId", matterId)
      form.set("file", row.file)
      form.set("name", row.name)
      form.set("category", row.category)
      form.set("requestKey", row.key)
      try {
        await readPersonal(workspaceEndpoint, { method: "POST", body: form })
        patch(row, { status: "done", file: undefined })
      } catch (error) {
        patch(row, { status: "failed", error: error instanceof Error ? error.message : "未收到入卷回执" })
      }
    }
  } finally {
    running.delete(matterId)
    update(matterId, [...batchRows(matterId)])
  }
}
