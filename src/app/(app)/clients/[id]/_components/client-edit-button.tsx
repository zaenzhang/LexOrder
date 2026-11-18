"use client";

import { Button } from "@douyinfe/semi-ui";

import { useRef, useState } from "react";
import { IconEdit as Pencil } from "@douyinfe/semi-icons";
import type { Client, Contact } from "@prisma/client";
import { ClientSheet } from "@/app/(app)/clients/_components/client-sheet";

/**
 * v0.39: 客户详情页「编辑信息」入口。
 * 详情页是服务端组件，这里包一层客户端 state 复用现有 ClientSheet（含编辑 + 联系人）。
 */
export function ClientEditButton({
  client
}: {
  client: Client & { contacts?: Contact[] };
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        htmlType="button"
        onClick={event => { trigger.current = event.currentTarget; setOpen(true); }}
        theme="outline" type="tertiary" size="small" icon={<Pencil aria-hidden size="default" />}
      >
        编辑资料
      </Button>
      <ClientSheet open={open} onOpenChange={setOpen} editingClient={client} onReturnFocus={() => trigger.current?.focus({ preventScroll: true })} />
    </>
  );
}
