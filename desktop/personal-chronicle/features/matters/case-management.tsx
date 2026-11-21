"use client"
import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { readPersonal, workspaceEndpoint } from "./personal-client"

export function actionRequest<T>(action: string, data: unknown, matterId?: string) {
  return readPersonal<T>(workspaceEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data, matterId }),
  })
}
export function CaseForm({
  title,
  children,
  onSave,
  close,
  saved,
  submitDisabled = false,
  submitLabel = title,
}: {
  title: string
  children: ReactNode
  onSave: (fields: FormData) => Promise<unknown>
  close: () => void
  saved: () => void
  submitDisabled?: boolean
  submitLabel?: string
}) {
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [error, setError] = useState("")
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          if (dirty) setDiscard(true)
          else close()
        }
      }}
    >
      <SheetContent className="overflow-y-auto motion-reduce:transition-none">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <form
          className="grid gap-3 px-4 pb-4 text-sm"
          onChange={() => {
            setDirty(true)
            setDiscard(false)
          }}
          onSubmit={async (e) => {
            e.preventDefault()
            if (busy || submitDisabled) return
            const form = new FormData(e.currentTarget)
            setBusy(true)
            setError("")
            try {
              await onSave(form)
              saved()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "保存失败。")
            } finally {
              setBusy(false)
            }
          }}
        >
          <fieldset disabled={busy} className="grid gap-3">
            {children}
            <Button type="submit" disabled={submitDisabled}>{busy ? "正在保存…" : submitLabel}</Button>
          </fieldset>
          {error && (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
          {discard && (
            <div role="alert">
              放弃未保存的修改？
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" onClick={() => setDiscard(false)}>
                  继续填写
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={close}>
                  放弃修改
                </Button>
              </div>
            </div>
          )}
        </form>
      </SheetContent>
    </Sheet>
  )
}
export type CaseBasic = {
  id: string
  updatedAt: string
  title: string
  causeId: string | null
  causeFreeText: string | null
  causeName?: string
  claimAmount: string | number | null
  ourStanding: string | null
  standings: Record<string, string>
}
export function EditCase({ editor, reload }: { editor: CaseBasic; reload: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        编辑案件资料
      </Button>
      {open && (
        <CaseForm
          title="保存案件资料"
          close={() => setOpen(false)}
          saved={() => {
            setOpen(false)
            reload()
          }}
          onSave={(fields) =>
            actionRequest("edit-matter", {
              id: editor.id,
              expectedUpdatedAt: editor.updatedAt,
              title: fields.get("title"),
              causeId: editor.causeId ?? "",
              causeFreeText: fields.get("cause") ?? editor.causeFreeText ?? "",
              claimAmount: fields.get("amount") || null,
              ourStanding: fields.get("standing") || null,
            })
          }
        >
          <label className="grid gap-1">
            案名
            <Input required name="title" maxLength={200} defaultValue={editor.title} />
          </label>
          {editor.causeId ? (
            <p>登记案由 · {editor.causeName}</p>
          ) : (
            <label className="grid gap-1">
              案由
              <Input maxLength={200} name="cause" defaultValue={editor.causeFreeText ?? ""} />
            </label>
          )}
          <label className="grid gap-1">
            标的金额（元）
            <Input type="number" step="0.01" min={0} name="amount" defaultValue={editor.claimAmount ?? ""} />
          </label>
          <label className="grid gap-1">
            我方地位
            <NativeSelect name="standing" defaultValue={editor.ourStanding ?? ""}>
              <NativeSelectOption value="">未设置</NativeSelectOption>
              {Object.entries(editor.standings).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </CaseForm>
      )}
    </>
  )
}

export type ProcedureInfo = {
  id: string
  type: string
  name: string
  customLabel: string | null
  caseNumber: string | null
  handlingAgency: string | null
  updatedAt: string
  engagement: string
}
const actions = {
  create: "新增程序",
  edit: "修改程序资料",
  stage: "新增环节",
  deadline: "登记期限",
  hearing: "登记庭期",
}
type ProcAction = keyof typeof actions
export function ProcedureActions({
  matterId,
  procedure,
  types,
  reload,
  controls,
}: {
  matterId: string
  procedure?: ProcedureInfo
  controls?: readonly ProcAction[]
  types: Record<string, string>
  reload: () => void
}) {
  const [action, setAction] = useState<ProcAction>()
  const [precise, setPrecise] = useState(false)
  const [deadlineKey, setDeadlineKey] = useState("")
  async function save(fields: FormData) {
    const values = Object.fromEntries(fields)
    if (action === "create") return actionRequest("add-procedure", { ...values, matterId })
    if (!procedure) return
    const procedureId = procedure.id
    if (action === "edit")
      return actionRequest(
        "edit-procedure",
        { ...values, id: procedureId, expectedUpdatedAt: procedure.updatedAt },
        matterId
      )
    if (action === "stage") return actionRequest("add-stage", { ...values, procedureId }, matterId)
    if (action === "hearing")
      return actionRequest(
        "add-hearing",
        { ...values, procedureId, startsAt: String(values.startsAt) + ":00+08:00" },
        matterId
      )
    if (action === "deadline")
      return actionRequest(
        "add-deadline",
        {
          ...values,
          procedureId,
          requestKey: deadlineKey,
          duePrecision: precise ? "DATETIME" : "DATE",
          dueAt: precise ? String(values.dueAt) + ":00+08:00" : values.dueAt,
        },
        matterId
      )
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {(controls ?? (procedure ? ["edit", "stage", "deadline", "hearing"] : ["create"])).map((key) => (
          <Button
            key={key}
            size="sm"
            variant="outline"
            onClick={() => {
              if (key === "deadline") setDeadlineKey(crypto.randomUUID())
              setAction(key)
              setPrecise(false)
            }}
          >
            {actions[key]}
          </Button>
        ))}
      </div>
      {action && (
        <CaseForm
          title={actions[action]}
          close={() => setAction(undefined)}
          saved={() => {
            setAction(undefined)
            reload()
          }}
          onSave={save}
        >
          {procedure && <p>{procedure.name}</p>}
          {(action === "create" || action === "edit") && (
            <>
              <label className="grid gap-1">
                程序类型
                <NativeSelect name="type" required defaultValue={procedure?.type ?? ""}>
                  <NativeSelectOption value="">请选择类型</NativeSelectOption>
                  {Object.entries(types).map(([type, label]) => (
                    <NativeSelectOption key={type} value={type}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              {action === "create" && (
                <label className="grid gap-1">
                  承办性质
                  <NativeSelect name="engagement" defaultValue="ENGAGED">
                    <NativeSelectOption value="ENGAGED">受托承办</NativeSelectOption>
                    <NativeSelectOption value="INFORMATIONAL">仅作关联记录</NativeSelectOption>
                  </NativeSelect>
                </label>
              )}
              <label className="grid gap-1">
                程序名称
                <Input name="customLabel" maxLength={40} defaultValue={procedure?.customLabel ?? ""} />
              </label>
              <label className="grid gap-1">
                案号
                <Input name="caseNumber" maxLength={80} defaultValue={procedure?.caseNumber ?? ""} />
              </label>
              <label className="grid gap-1">
                承办机构
                <Input name="handlingAgency" maxLength={120} defaultValue={procedure?.handlingAgency ?? ""} />
              </label>
              {action === "edit" && (
                <label className="grid gap-1">
                  变更原因
                  <Input name="changeReason" maxLength={500} />
                </label>
              )}
            </>
          )}
          {action === "stage" && (
            <label className="grid gap-1">
              新增环节名称
              <Input name="name" required maxLength={40} />
            </label>
          )}
          {(action === "deadline" || action === "hearing") && (
            <label className="grid gap-1">
              名称
              <Input name="title" required maxLength={action === "hearing" ? 80 : 100} />
            </label>
          )}
          {action === "deadline" && (
            <>
              <label className="flex gap-2">
                <input type="checkbox" checked={precise} onChange={(e) => setPrecise(e.target.checked)} />
                有明确截止时刻
              </label>
              <label className="grid gap-1">
                {precise ? "截止时刻（北京时间）" : "截止日期"}
                <Input key={String(precise)} type={precise ? "datetime-local" : "date"} required name="dueAt" />
              </label>
              <label className="grid gap-1">
                期限依据
                <Input name="basis" maxLength={200} />
              </label>
              <label className="grid gap-1">
                提前提醒天数
                <Input name="remindDays" type="number" min={0} max={60} defaultValue={3} required />
              </label>
            </>
          )}
          {action === "hearing" && (
            <>
              <label className="grid gap-1">
                开庭时间（北京时间）
                <Input name="startsAt" type="datetime-local" required />
              </label>
              <label className="grid gap-1">
                开庭地点
                <Input name="address" maxLength={200} />
              </label>
              <label className="grid gap-1">
                备注
                <Textarea name="notes" maxLength={2000} />
              </label>
            </>
          )}
        </CaseForm>
      )}
    </>
  )
}
