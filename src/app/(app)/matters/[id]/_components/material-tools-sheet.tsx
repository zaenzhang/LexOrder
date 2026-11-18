"use client";

import { useRef, useState } from "react";
import { ClipboardCheck, FileCog } from "lucide-react";
import { Button, Tabs, TabPane } from "@douyinfe/semi-ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InputCoverageSection } from "./input-coverage-section";
import { MaterialProcessingStatus } from "./material-processing-status";

type MaterialTool = "processing" | "coverage";

export function MaterialToolsSheet({ matterId, documents, scopeLabel, canManage, refreshKey }: {
  matterId: string;
  documents: { id: string; name: string; version?: number | null }[];
  scopeLabel: string;
  canManage: boolean;
  refreshKey?: string | number;
}) {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<MaterialTool>("processing");
  const [coverageVisited, setCoverageVisited] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);

  function selectTool(value: string) {
    if (value !== "processing" && value !== "coverage") return;
    setTool(value);
    if (value === "coverage") setCoverageVisited(true);
  }

  function openTool(value: MaterialTool, element: HTMLButtonElement) {
    trigger.current = element;
    selectTool(value);
    setOpen(true);
  }

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setCoverageVisited(false);
    }}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="small" type="tertiary" icon={<FileCog size={14} aria-hidden />} aria-haspopup="dialog" onClick={(event) => openTool("processing", event.currentTarget)}>
          处理状态
        </Button>
        <Button size="small" type="tertiary" icon={<ClipboardCheck size={14} aria-hidden />} aria-haspopup="dialog" onClick={(event) => openTool("coverage", event.currentTarget)}>
          读取检查
        </Button>
      </div>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (trigger.current?.isConnected) trigger.current.focus();
      }}>
        <SheetHeader>
          <SheetTitle className="sr-only">材料工具</SheetTitle>
          <SheetDescription>{scopeLabel}</SheetDescription>
        </SheetHeader>
        <Tabs activeKey={tool} onChange={selectTool} keepDOM lazyRender tabPaneMotion={false}>
          <TabPane itemKey="processing" tab="处理状态">
            {open && tool === "processing" ? documents.length
              ? <MaterialProcessingStatus matterId={matterId} documentIds={documents.map(document => document.id)} canManage={canManage} />
              : <p role="status" className="text-sm text-muted-foreground">暂无可处理的材料。</p>
              : null}
          </TabPane>
          <TabPane itemKey="coverage" tab="读取检查" className={tool === "coverage" ? undefined : "hidden"}>
            {open && coverageVisited ? <InputCoverageSection matterId={matterId} documents={documents} refreshKey={refreshKey} showHeading={false} /> : null}
          </TabPane>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
