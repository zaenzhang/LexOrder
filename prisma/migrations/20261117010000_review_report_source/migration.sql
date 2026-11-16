-- Only new reviews attest to their source and actual coverage. Historical rows
-- remain unbound; no source hash, coverage or report association is invented.
ALTER TABLE "ReviewRecord"
  ADD COLUMN "sourceSha256" TEXT,
  ADD COLUMN "coverageJson" JSONB,
  ADD COLUMN "reportDocumentId" TEXT;

CREATE UNIQUE INDEX "ReviewRecord_reportDocumentId_key" ON "ReviewRecord"("reportDocumentId");
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_reportDocumentId_fkey"
  FOREIGN KEY ("reportDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
