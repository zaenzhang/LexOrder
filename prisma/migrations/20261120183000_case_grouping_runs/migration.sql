CREATE TABLE "CaseGroupingRun" (
    "id" UUID PRIMARY KEY,
    "matterId" TEXT NOT NULL REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "methodVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "selected" JSONB NOT NULL,
    "state" TEXT NOT NULL CHECK ("state" IN ('QUEUED', 'DISPATCHED', 'READY', 'FAILED', 'UNCERTAIN')),
    "receipt" JSONB,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaseGroupingRun_result_matches_state" CHECK (("state" = 'READY') = ("result" IS NOT NULL))
);
CREATE INDEX "CaseGroupingRun_matterId_authorId_createdAt_id_idx" ON "CaseGroupingRun"("matterId", "authorId", "createdAt", "id");
