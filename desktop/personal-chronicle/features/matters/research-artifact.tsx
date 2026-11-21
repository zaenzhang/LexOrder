import type { ReactNode } from "react"
import { Textarea } from "@/components/ui/textarea"

const analysisFields = [
  { key: "unresolved", label: "证据与待核缺口", maxLength: 10000 },
  { key: "rule", label: "适用规则与要件", maxLength: 15000 },
  { key: "exceptions", label: "例外与适用条件", maxLength: 10000 },
  { key: "supportingAnalysis", label: "支持论证", maxLength: 15000 },
  { key: "opposingAnalysis", label: "反向论证", maxLength: 15000 },
  { key: "conclusion", label: "结论与成立条件", maxLength: 15000 },
  { key: "nextSteps", label: "下一步", maxLength: 5000 },
] as const

export type ResearchAnalysis = Record<(typeof analysisFields)[number]["key"], string>

export function researchAnalysis(content: ResearchAnalysis): ResearchAnalysis {
  return {
    unresolved: content.unresolved, rule: content.rule, exceptions: content.exceptions,
    supportingAnalysis: content.supportingAnalysis, opposingAnalysis: content.opposingAnalysis,
    conclusion: content.conclusion, nextSteps: content.nextSteps,
  }
}

export function ResearchArtifact({ analysis, onChange, children }: {
  analysis: ResearchAnalysis
  onChange?: (analysis: ResearchAnalysis) => void
  children: ReactNode
}) {
  return <article aria-label="研究成果" className="grid gap-4 sm:rounded-xl sm:border sm:bg-card sm:p-5">
    <dl className="grid gap-4">
      {analysisFields.map(({ key, label, maxLength }) => (
        onChange || analysis[key] || key === "unresolved" ? <div key={key}>
          <dt className="font-medium">{label}</dt>
          <dd className="mt-1">
            {onChange ? <Textarea aria-label={label} maxLength={maxLength} value={analysis[key]}
              onChange={event => onChange({ ...analysis, [key]: event.target.value })} />
              : analysis[key] ? <p className="whitespace-pre-wrap break-words">{analysis[key]}</p>
              : <p className="text-muted-foreground">尚未记录待核事项。</p>}
          </dd>
        </div> : null
      ))}
    </dl>
    {children}
  </article>
}