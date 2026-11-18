"use client";

import { Button, Input } from "@douyinfe/semi-ui";

export function ArchiveSearchForm({ query }: { query: string }) {
  return <form action="/archive" method="get" className="flex items-end gap-2">
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label htmlFor="archive-query">归档号、案号或案件名称</label>
      <Input id="archive-query" name="q" defaultValue={query} maxLength={200} />
    </div>
    <Button htmlType="submit" theme="solid">查找归档</Button>
  </form>;
}
