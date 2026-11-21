CREATE TABLE "EvidenceObservationRun" (
  "id" UUID NOT NULL,
  "evidenceItemId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "baseRevision" INTEGER NOT NULL,
  "methodVersion" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "ranges" JSONB NOT NULL,
  "state" TEXT NOT NULL,
  "receipt" JSONB,
  "candidates" JSONB,
  "adoption" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvidenceObservationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EvidenceObservationRun_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "EvidenceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EvidenceObservationRun_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EvidenceObservationRun_revision_check" CHECK ("baseRevision" > 0),
  CONSTRAINT "EvidenceObservationRun_state_check" CHECK ("state" IN ('QUEUED', 'DISPATCHED', 'READY', 'FAILED', 'UNCERTAIN', 'ADOPTED')),
  CONSTRAINT "EvidenceObservationRun_pending_check" CHECK (("state" IN ('READY', 'ADOPTED')) = ("candidates" IS NOT NULL)),
  CONSTRAINT "EvidenceObservationRun_adoption_check" CHECK (("state" = 'ADOPTED') = ("adoption" IS NOT NULL))
);
CREATE INDEX "EvidenceObservationRun_evidenceItemId_createdAt_id_idx" ON "EvidenceObservationRun"("evidenceItemId", "createdAt", "id");
