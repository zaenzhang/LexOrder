"use client";

import { useEffect, useState } from "react";
import { Button, Spin } from "@douyinfe/semi-ui";
import { actionErrorMessage } from "@/lib/action-error";

export function useDetailSection<T>(
  load: (matterId: string) => Promise<T>,
  matterId: string,
  refreshKey: number | undefined,
  active: boolean,
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>();
  const key = `${matterId}:${refreshKey}:${attempt}`;
  const current = result?.key === key ? result : undefined;
  useEffect(() => {
    if (!active || current) return;
    let live = true;
    void load(matterId).then(
      data => { if (live) setResult({ key, data }); },
      error => { if (live) setResult({ key, error: actionErrorMessage(error) }); },
    );
    return () => { live = false; };
  }, [active, current, key, load, matterId]);
  return { data: current?.data, error: current?.error, retry: () => setAttempt(value => value + 1) };
}

export function DetailSectionStatus({ label, error, retry }: { label: string; error?: string; retry: () => void }) {
  return error ? (
    <div role="alert" className="flex flex-wrap items-center gap-2 py-4 text-sm">
      <span>{label}加载失败。{error}</span>
      <Button htmlType="button" size="small" theme="borderless" onClick={retry}>重新加载</Button>
    </div>
  ) : (
    <div role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
      <Spin size="small" /> 正在加载{label}…
    </div>
  );
}
