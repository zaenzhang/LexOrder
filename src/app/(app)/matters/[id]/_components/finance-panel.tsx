"use client";

import { Button, Card, Empty, Table, Tag } from "@douyinfe/semi-ui";
import { useState } from "react";
import { IconNoteMoney as Receipt } from "@douyinfe/semi-icons";
import { formatCurrency, formatDate } from "@/lib/utils";
import { InvoiceRequestSheet } from "./invoice-request-sheet";
import type { FinancePayload } from "./matter-detail-tabs";

export function FinancePanel({ matterId, finance, canRequestInvoice }: {
  matterId: string;
  finance: FinancePayload;
  canRequestInvoice: boolean;
}) {
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const received = finance.entries
    .filter(entry => entry.type === "RECEIVED")
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  return (
    <section aria-labelledby="dossier-receipts-heading">
      <Card bodyStyle={{ padding: 0 }}>
        <header className="dossier-section-heading">
          <h2 id="dossier-receipts-heading">收款记录 <span className="dossier-count">{received.length}</span></h2>
          {canRequestInvoice ? <Button htmlType="button" theme="outline" type="tertiary"
            icon={<Receipt aria-hidden />} onClick={() => setInvoiceOpen(true)}>申请开票</Button> : null}
        </header>
        {received.length ? <div className="min-w-0 overflow-x-auto">
          <Table<(typeof received)[number]>
            rowKey="id"
            dataSource={received}
            pagination={false}
            scroll={{ x: 660 }}
            columns={[
              { title: "日期", key: "date", width: 124, render: (_, entry) => formatDate(new Date(entry.occurredAt)) },
              {
                title: "付款方与说明",
                key: "payer",
                render: (_, entry) => <div className="min-w-0 space-y-1 break-words">
                  <div>{entry.payerOrPayee || "未登记付款方"}</div>
                  {entry.method || entry.invoiceNo || entry.note ? <div className="text-xs text-muted-foreground">
                    {[entry.method, entry.invoiceNo && `发票 ${entry.invoiceNo}`, entry.note].filter(Boolean).join(" · ")}
                  </div> : null}
                </div>
              },
              {
                title: "金额",
                key: "amount",
                width: 128,
                align: "right",
                render: (_, entry) => <span className="font-mono tabular-nums">{formatCurrency(Number(entry.amount))}</span>
              },
              {
                title: "确认状态",
                key: "state",
                width: 108,
                render: (_, entry) => entry.confirmState === "PENDING" ? <Tag color="amber">待确认</Tag>
                  : entry.confirmState === "CONFIRMED" ? <Tag color="green">已确认</Tag> : <span className="text-muted-foreground">—</span>
              }
            ]}
          />
        </div> : <Empty className="dossier-register-empty" description="本案暂无收款记录" />}
      </Card>
      {canRequestInvoice ? <InvoiceRequestSheet open={invoiceOpen} onOpenChange={setInvoiceOpen} matterId={matterId} /> : null}
    </section>
  );
}
