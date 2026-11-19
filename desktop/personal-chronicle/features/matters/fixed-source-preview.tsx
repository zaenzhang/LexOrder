import { materialUrl } from "./personal-client"

export type FixedSource = {
  status: "AVAILABLE"; documentName: string; documentVersion: number; locationLabel: string
  previewUrl: string | null; downloadUrl: string; text: string | null; legacy: boolean; historicalParse: boolean; previewKind: string
}

export function FixedSourcePreview({ source }: { source: FixedSource }) {
  return <>
    <div><h3 className="font-medium">{source.documentName}</h3><p className="text-sm text-muted-foreground">第 {source.documentVersion} 版 · {source.locationLabel}</p></div>
    {source.legacy && <p className="text-sm text-muted-foreground">历史引用未固定原件校验值，请核对原文。</p>}
    {source.historicalParse && <p className="text-sm text-muted-foreground">显示引用时保留的解析版本。</p>}
    {source.previewKind === "CONVERTED" && <p className="text-sm text-muted-foreground">转换预览显示整份文件。</p>}
    {source.text && <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">{source.text}</blockquote>}
    {source.previewUrl && <iframe title="固定版本原文" src={materialUrl(source.previewUrl)} className="h-96 w-full rounded-md border" />}
    <a className="text-sm underline" href={materialUrl(source.downloadUrl)} download>下载此版本</a>
  </>
}
