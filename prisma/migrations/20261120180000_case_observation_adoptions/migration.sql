CREATE TABLE "CaseObservationAdoption" (
    "id" UUID PRIMARY KEY,
    "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "evidenceItemId" TEXT NOT NULL REFERENCES "EvidenceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "revision" INTEGER NOT NULL CHECK ("revision" >= 1),
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CaseObservationCandidateAdoption" (
    "runId" UUID NOT NULL REFERENCES "EvidenceObservationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "candidateIndex" INTEGER NOT NULL CHECK ("candidateIndex" BETWEEN 0 AND 79),
    "adoptionId" UUID NOT NULL REFERENCES "CaseObservationAdoption"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "observationId" TEXT NOT NULL REFERENCES "EvidenceObservationRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    PRIMARY KEY ("runId", "candidateIndex")
);

CREATE UNIQUE INDEX "CaseObservationCandidateAdoption_observationId_key" ON "CaseObservationCandidateAdoption"("observationId");
CREATE INDEX "CaseObservationCandidateAdoption_adoptionId_idx" ON "CaseObservationCandidateAdoption"("adoptionId");
CREATE INDEX "CaseObservationAdoption_evidenceItemId_idx" ON "CaseObservationAdoption"("evidenceItemId");
