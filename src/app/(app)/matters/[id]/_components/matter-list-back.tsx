"use client";

import { IconChevronLeft } from "@douyinfe/semi-icons";
import { Button } from "@douyinfe/semi-ui";
import { useRouter } from "next/navigation";
import { matterListReturnHref } from "@/lib/matters/list-location";

export function MatterListBack({ listQuery }: { listQuery: string | null }) {
  const router = useRouter();
  return <Button htmlType="button" type="tertiary" theme="borderless" icon={<IconChevronLeft aria-hidden />}
    onClick={() => router.push(matterListReturnHref(listQuery) ?? "/matters")}>
    返回案件列表
  </Button>;
}
