"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Toast } from "@douyinfe/semi-ui";
import { actionErrorMessage } from "@/lib/action-error";
import { closeMaterialUpload, continueMaterialUpload, listPendingMaterialUploads } from "@/server/documents/ingest-actions";

export function PendingMaterialUploads({ matterId }: { matterId: string }) {
  const router = useRouter();
  const [view, setView] = useState<Awaited<ReturnType<typeof listPendingMaterialUploads>> | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => listPendingMaterialUploads(matterId).then(result => {
      if (active) { setView(result); setError(""); }
    }).catch(err => { if (active) setError(actionErrorMessage(err)); });
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [matterId, refresh]);
  function run(id: string, close: boolean) {
    startTransition(async () => {
      try {
        if (close) await closeMaterialUpload(id); else await continueMaterialUpload(id);
        Toast.success(close ? "已关闭上传记录" : "材料已保存，等待处理");
        router.refresh();
      } catch (err) { Toast.error(actionErrorMessage(err)); }
      finally { setRefresh(value => value + 1); }
    });
  }
  if (error) return <div role="alert" className="text-sm text-destructive">未完成上传暂不可读取：{error} <Button theme="borderless" type="primary" size="small" htmlType="button" onClick={() => setRefresh(value => value + 1)}>重试</Button></div>;
  if (!view?.items.length) return null;
  return <section aria-label="未完成上传" className="rounded border border-amber-300 p-3 text-sm">
    <h3 className="font-medium">未完成上传</h3>
    {view.items.map(row => <div key={row.id} className="flex flex-wrap items-start justify-between gap-2 border-t py-2 first:border-0">
      <div className="min-w-0 flex-1 break-words"><p>{row.name}</p><p className="text-xs text-muted-foreground">{row.description}</p></div>
      <div className="flex gap-3"><Button theme="borderless" type="primary" size="small" htmlType="button" disabled={pending || row.waiting} onClick={() => run(row.id, false)}>继续处理</Button>
        <Button theme="borderless" type="tertiary" size="small" htmlType="button" disabled={pending || row.waiting} onClick={() => run(row.id, true)}>关闭记录</Button></div>
    </div>)}
    {view.hasMore ? <p>仅显示最近 20 条；处理后可查看其余记录。</p> : null}
  </section>;
}
