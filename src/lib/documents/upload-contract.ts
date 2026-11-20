/** A rejection describes this invocation only; it never cancels an earlier request with the same key. */
export type UploadDocumentResult = { ok: true; id: string } | {
  ok: false;
  code: "REJECTED_BEFORE_RESERVATION";
  message: string;
};

export type PendingMaterialUploads = {
  items: { id: string; name: string; waiting: boolean; description: string }[];
  hasMore: boolean;
};

export type MaterialUploadReceipt =
  | { status: "NOT_RESERVED" }
  | { status: "CLOSED" }
  | { status: "COMMITTED"; document: { id: string; name: string; version: number } | null }
  | { status: "INCOMPLETE"; waiting: boolean; description: string };
