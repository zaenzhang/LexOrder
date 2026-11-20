ALTER TABLE "EvidenceItem" ADD COLUMN "observationRevisionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "EvidenceItemRevision" ADD COLUMN "observationRevisionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "EvidenceObservationRevision" (
  "id" TEXT NOT NULL,
  "sourceLinkId" TEXT NOT NULL,
  "seriesId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "supersedesId" TEXT,
  "requestKey" UUID NOT NULL,
  "baseEvidenceRevision" INTEGER NOT NULL,
  "requestInput" JSONB NOT NULL,
  "data" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvidenceObservationRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EvidenceObservationRevision_revision_check" CHECK (
    "baseEvidenceRevision" > 0 AND
    (("revision" = 1 AND "supersedesId" IS NULL) OR ("revision" > 1 AND "supersedesId" IS NOT NULL))
  ),
  CONSTRAINT "EvidenceObservationRevision_sourceLinkId_fkey" FOREIGN KEY ("sourceLinkId") REFERENCES "EvidenceSourceLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EvidenceObservationRevision_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "EvidenceObservationRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EvidenceObservationRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EvidenceObservationRevision_supersedesId_key" ON "EvidenceObservationRevision"("supersedesId");
CREATE UNIQUE INDEX "EvidenceObservationRevision_seriesId_revision_key" ON "EvidenceObservationRevision"("seriesId", "revision");
CREATE UNIQUE INDEX "EvidenceObservationRevision_createdById_requestKey_key" ON "EvidenceObservationRevision"("createdById", "requestKey");
CREATE INDEX "EvidenceObservationRevision_sourceLinkId_idx" ON "EvidenceObservationRevision"("sourceLinkId");
