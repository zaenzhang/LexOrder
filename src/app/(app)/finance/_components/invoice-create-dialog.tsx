"use client";

import { InvoiceRequestForm } from "./invoice-request-form";

export function InvoiceCreateDialog({ open, ...props }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreateUnlinkedInvoice?: boolean;
  onSubmitted?: (id: string) => void;
}) {
  return open ? <InvoiceRequestForm {...props} /> : null;
}
