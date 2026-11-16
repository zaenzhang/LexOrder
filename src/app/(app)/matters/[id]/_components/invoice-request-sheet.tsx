"use client";

import { InvoiceRequestForm } from "@/app/(app)/finance/_components/invoice-request-form";

export function InvoiceRequestSheet({ open, ...props }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matterId: string;
}) {
  return open ? <InvoiceRequestForm key={props.matterId} {...props} /> : null;
}
