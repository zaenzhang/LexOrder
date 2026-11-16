"use client";

import { useRef, useState } from "react";
import { ClipboardCheck, FileCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        <Button variant="outline" size="sm" aria-haspopup="dialog" onClick={(event) => openTool("processing", event.currentTarget)}>
          <FileCog />处理状态
        </Button>
        <Button variant="outline" size="sm" aria-haspopup="dialog" onClick={(event) => openTool("coverage", event.currentTarget)}>
          <ClipboardCheck />读取检查
        </Button>
      </div>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (trigger.current?.isConnected) trigger.current.focus();
      }}>
        <SheetHeader>
          <SheetTitle>材料工具</SheetTitle>
          <SheetDescription>{scopeLabel}</SheetDescription>
        </SheetHeader>
        <Tabs value={tool} onValueChange={selectTool}>
          <TabsList aria-label="材料工具" className="grid w-full grid-cols-2">
            <TabsTrigger value="processing">处理状态</TabsTrigger>
            <TabsTrigger value="coverage">读取检查</TabsTrigger>
          </TabsList>
          <TabsContent value="processing">
            {open && tool === "processing" ? documents.length
              ? <MaterialProcessingStatus matterId={matterId} documentIds={documents.map(document => document.id)} canManage={canManage} />
              : <p role="status" className="text-sm text-muted-foreground">暂无可处理的材料。</p>
              : null}
          </TabsContent>
          <TabsContent value="coverage" forceMount hidden={tool !== "coverage"} className="data-[state=inactive]:hidden">
            {open && coverageVisited ? <InputCoverageSection matterId={matterId} documents={documents} refreshKey={refreshKey} /> : null}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
