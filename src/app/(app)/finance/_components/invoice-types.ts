import type { InvoiceRequestStatus } from "@prisma/client";

export type InvoiceRequestRow = {
  id: string;
  amount: number;
  title: string | null;
  status: InvoiceRequestStatus;
  requestNote: string | null;
  requestedAt: Date;
  processedAt: Date | null;
  processNote: string | null;
  invoiceNo: string | null;
  issuedAt: Date | null;
  // v0.42 开票类型 + 抬头 + 专票六要素（来自 InvoiceRequest 标量字段）
  invoiceType: "PLAIN" | "SPECIAL" | null;
  invoiceItem: "LAWYER_FEE" | "CONSULTING_FEE" | "AGENCY_FEE" | "OTHER" | null;
  buyerName: string | null;
  buyerTaxNo: string | null;
  buyerAddress: string | null;
  buyerPhone: string | null;
  buyerBank: string | null;
  buyerBankAccount: string | null;
  // v0.43 项5：matter 可空（无关联案件开票）
  matter: { id: string; internalCode: string; title: string } | null;
  noMatterReason: string | null;
  requestedBy: { id: string; name: string };
  processedBy: { id: string; name: string } | null;
  evidenceDocs: {
    id: string;
    name: string;
    size: number | null;
    mimeType: string | null;
    createdAt: Date;
  }[];
  contractScan: { id: string; name: string } | null;
  invoiceFile: { id: string; name: string } | null;
};
