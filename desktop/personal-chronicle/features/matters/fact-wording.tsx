import { useState } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import type { EvidenceNote } from "./case-chronology"
import { TraceGroup } from "./chronology-trace"
import { amountNatures, dateRoles, observationDifferences, statements } from "./fact-observation"

function wordingFromSources(item: EvidenceNote) {
  const sources = new Map(item.sources.map(source => [source.id, source]))
  const records = (item.observations ?? []).flatMap(record => {
    const source = sources.get(record.sourceId)
    if (!source || source.status !== "AVAILABLE" || source.legacy ||
      !source.documentId || !source.documentName || !source.documentVersion) return []

    const { date, amount, excerpt, statement } = record.data
    const fields = [
      ...(date ? [{ label: dateRoles[date.role] + "日期", text: date.text }] : []),
      ...(amount ? [{ label: amountNatures[amount.nature], text: amount.text }] : []),
    ]
    if (!excerpt && !fields.length) return []

    const label = source.documentName
    const citation = "《" + label + "》V" + source.documentVersion + (source.locationLabel ? " · " + source.locationLabel : "")
    const fieldText = ({ label, text }: typeof fields[number]) => label + "「" + text + "」"
    const client = fields.length ? fields.map(fieldText).join("、") : "「" + excerpt!.text + "」"
    const court = [
      ...(excerpt ? ["原文「" + excerpt.text + "」"] : []),
      ...fields.filter(field => !excerpt?.text.includes(field.text)).map(fieldText),
    ].join("，")

    return [{
      record,
      client: label + "（" + statements[statement] + "）：" + client + "。",
      court: "据" + citation + "，" + statements[statement] + "：" + court + "。",
    }]
  })
  if (!records.length) return null

  const differences = observationDifferences(records.map(({ record }) => record))
  const fields = [differences.date ? "日期" : "", differences.amount ? "金额" : ""].filter(Boolean).join("和")
  const onlyStatements = records.every(({ record }) => record.data.statement === "PARTY_STATEMENT")
  const needsReview = !item.confirmedAt || item.chronologyAssessment?.dispute === "disputed"
  return {
    client: [
      ...(onlyStatements ? ["目前可列出的记载均为当事人陈述。"] : []),
      ...(fields ? ["材料对" + fields + "的记载不同，需要逐份核对。"]
        : needsReview ? ["以下是目前材料中可核对的记载。"] : []),
      ...records.map(({ client }) => client),
    ],
    court: [
      ...records.map(({ court }) => court),
      ...(fields ? ["上述来源对" + fields + "的记载不一致，逐份列示供核。"]
        : needsReview ? ["上述记载尚待核对。"] : []),
    ],
  }
}

export function FactWording({ item }: { item: EvidenceNote }) {
  const [open, setOpen] = useState(false)
  if (item.restricted || item.chronologyAssessment?.adverse) return null
  const wording = open ? wordingFromSources(item) : null

  return <TraceGroup label="对外措辞预览" open={open} onOpenChange={setOpen}>
    {open && <div className="grid min-w-0 gap-2 px-3.5 py-2">
      {wording ? <>
        <p className="text-xs text-muted-foreground">待律师审阅</p>
        {([["给客户", wording.client], ["给法官", wording.court]] as const).map(([audience, paragraphs]) =>
          <Card key={audience} size="sm" className="min-w-0" role="region" aria-label={audience}>
            <CardHeader><CardTitle>{audience}</CardTitle></CardHeader>
            <CardContent className="grid min-w-0 gap-1.5 [overflow-wrap:anywhere]">
              {paragraphs.map((paragraph, index) => <p key={index} className="whitespace-pre-wrap">{paragraph}</p>)}
            </CardContent>
          </Card>)}
      </> : <p className="text-xs text-muted-foreground">添加可读的固定记载后即可预览。</p>}
    </div>}
  </TraceGroup>
}
