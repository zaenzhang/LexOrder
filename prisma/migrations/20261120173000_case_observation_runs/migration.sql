ALTER TABLE "EvidenceObservationRun"
  ADD COLUMN "caseMatterId" TEXT,
  ALTER COLUMN "evidenceItemId" DROP NOT NULL,
  ALTER COLUMN "baseRevision" DROP NOT NULL,
  DROP CONSTRAINT "EvidenceObservationRun_revision_check",
  ADD CONSTRAINT "EvidenceObservationRun_scope_check" CHECK (
    ("evidenceItemId" IS NOT NULL AND "caseMatterId" IS NULL AND "baseRevision" IS NOT NULL AND "baseRevision" > 0)
    OR ("evidenceItemId" IS NULL AND "caseMatterId" IS NOT NULL AND "baseRevision" IS NULL)
  ),
  ADD CONSTRAINT "EvidenceObservationRun_caseMatterId_fkey" FOREIGN KEY ("caseMatterId")
    REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "EvidenceObservationRun_caseMatterId_authorId_createdAt_id_idx"
  ON "EvidenceObservationRun"("caseMatterId", "authorId", "createdAt", "id");
