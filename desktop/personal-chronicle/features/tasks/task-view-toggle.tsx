"use client"

import { KanbanSquareIcon, TableIcon } from "lucide-react"
import { Segmented } from "@/kit/ui-patterns/segmented"

export type TaskView = "board" | "table"

export function TaskViewToggle({ value, onChange, chinese = false }: {
  value: TaskView; onChange: (next: TaskView) => void; chinese?: boolean
}) {
  return <Segmented aria-label={chinese ? "任务视图" : "View"} className="w-auto"
    value={value} onChange={onChange} options={[
      { value: "board", label: chinese ? "看板" : "Board", icon: KanbanSquareIcon },
      { value: "table", label: chinese ? "表格" : "Table", icon: TableIcon },
    ]} />
}
