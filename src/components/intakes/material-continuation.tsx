import type { MouseEvent } from "react";
import type { IntakeMaterialContinuation } from "@/server/intakes/material-continuation";

/** Shared presentation for the successful approval and the persistent intake detail. */
export function IntakeMaterialContinuationView({ value, onFollow }: {
  value: IntakeMaterialContinuation;
  onFollow?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const link = (href: string, label: string) => <a key={href} className="text-primary underline underline-offset-4" href={href}
    onClick={onFollow ? event => onFollow(event, href) : undefined}>{label}</a>;
  return <div aria-label="转案材料接续" className="space-y-2 text-sm">
    {value.status === "AVAILABLE" ? <>
      <p className="text-muted-foreground">{value.empty ? "本次收案当前没有可读材料。" : value.unassigned
        ? "收案材料保留真实归属，尚未分配环节的材料可从以下范围查看。" : "收案材料已保留，可按当前归属在案件材料区查看。"}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{value.targets.map(target => link(target.href, target.label))}</div>
    </> : value.status === "UNAVAILABLE" ? <>
      <p role="status" className="text-muted-foreground">材料接续暂不可用。{value.intakeHref
        ? "请稍后从收案详情重新读取。" : "有权经办可稍后从收案详情查看材料。"}</p>
      {value.intakeHref ? link(value.intakeHref, "重新读取收案详情") : null}
    </> : <p className="text-muted-foreground">当前没有案件材料读取资格；有权经办可从收案详情继续查看。</p>}
  </div>;
}
