"use client";

import {
  WorkspaceDialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/workspace-dialog";
import { NavContent, type FirmBrand } from "./sidebar";

export function MobileNav({
  open,
  onOpenChange,
  firm,
  onOpenTools
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  firm: FirmBrand;
  onOpenTools?: () => void;
}) {
  return (
    <WorkspaceDialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="left" className="w-[240px] p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>导航菜单</DialogTitle>
        </DialogHeader>
        <NavContent firm={firm} onOpenTools={onOpenTools} onNavigate={() => onOpenChange(false)} />
      </DrawerContent>
    </WorkspaceDialog>
  );
}
