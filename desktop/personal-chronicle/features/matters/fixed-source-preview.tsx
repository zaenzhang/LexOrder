import { Fragment } from "react"
import { DownloadIcon, ExternalLinkIcon } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type FixedSource = {
  status: "AVAILABLE"; documentName: string; documentVersion: number; locationLabel: string
  previewUrl: string | null; downloadUrl: string; text: string | null; legacy: boolean; historicalParse: boolean; previewKind: string
}

type Mark = { start: number; end: number }
export function markedText(text: string, marks?: readonly Mark[]) {
  const ranges: Mark[] = []
  for (const span of [...marks ?? []].sort((a, b) => a.start - b.start)) {
    if (span.start < 0 || span.end > text.length || span.end <= span.start) continue
    const last = ranges.at(-1)
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else ranges.push({ ...span })
  }
  if (!ranges.length) return text
  return <>{ranges.map((span, index) => <Fragment key={span.start}>
    {text.slice(ranges[index - 1]?.end ?? 0, span.start)}<mark className="rounded-sm bg-warning/25 text-foreground">{text.slice(span.start, span.end)}</mark>
  </Fragment>)}{text.slice(ranges.at(-1)!.end)}</>
}

export function FixedSourcePreview({ source, inlineExcerpt = false, marks, detailPanel = false, highlightLabel }: {
  source: FixedSource; inlineExcerpt?: boolean; marks?: readonly Mark[]; detailPanel?: boolean; highlightLabel?: string
}) {
  const extracted = detailPanel && source.locationLabel.startsWith("抽取文本")
  const location = extracted ? "文本摘录" : source.locationLabel
  const metadata = <p className={cn("text-muted-foreground", detailPanel ? "text-xs" : "text-sm")}
    title={extracted ? source.locationLabel : undefined}>第 {source.documentVersion} 版 · {location}</p>
  const excerpt = source.text && markedText(source.text, marks)

  return <>
    {detailPanel ? <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
      {metadata}
      <div className="flex flex-wrap items-center gap-1 empty:hidden">
        {source.previewUrl && source.text && <a className={buttonVariants({ size: "xs", variant: "ghost" })}
          href={source.previewUrl} target="_blank" rel="noreferrer">
          <ExternalLinkIcon data-icon="inline-start" />查看原件
        </a>}
        {source.downloadUrl && <a className={buttonVariants({ size: "xs", variant: "ghost" })}
          href={source.downloadUrl} download>
          <DownloadIcon data-icon="inline-start" />下载原件
        </a>}
      </div>
    </div> : <div><h3 className="font-medium">{source.documentName}</h3>{metadata}</div>}
    {source.legacy && <p className="text-sm text-muted-foreground">历史引用未固定原件校验值，请核对原文。</p>}
    {source.historicalParse && <p className="text-sm text-muted-foreground">显示引用时保留的解析版本。</p>}
    {source.previewKind === "CONVERTED" && <p className="text-sm text-muted-foreground">转换预览显示整份文件。</p>}
    {excerpt && (detailPanel ? <figure className="min-w-0 space-y-1.5 rounded-lg bg-muted/40 px-3 py-2.5">
      {highlightLabel && <figcaption className="text-xs font-medium text-muted-foreground">{highlightLabel}</figcaption>}
      <blockquote className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{excerpt}</blockquote>
    </figure> : <blockquote className={cn("whitespace-pre-wrap break-words border-l-2 pl-3 text-sm", inlineExcerpt && "max-h-40 overflow-y-auto")}>{excerpt}</blockquote>)}
    {source.previewUrl && (!(inlineExcerpt || detailPanel) || !source.text) && <iframe title="固定版本原文" src={source.previewUrl} className="h-96 w-full rounded-md border" />}
    {!detailPanel && source.downloadUrl && <div className="flex flex-wrap gap-3">
      <a className="text-sm underline" href={source.downloadUrl} download>下载此版本</a>
    </div>}
  </>
}
