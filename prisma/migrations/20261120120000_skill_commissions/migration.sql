CREATE TABLE "SkillCommission" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "baseResearchId" TEXT NOT NULL,
    "baseCheckedAt" TIMESTAMP(3),
    "methodVersion" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "ranges" JSONB NOT NULL,
    "exportedAt" TIMESTAMP(3),
    "result" JSONB,
    "submittedAt" TIMESTAMP(3),
    "adoptedResearchId" TEXT,
    "decisions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillCommission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SkillCommission_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SkillCommission_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SkillCommission_baseResearchId_fkey" FOREIGN KEY ("baseResearchId") REFERENCES "ResearchRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SkillCommission_adoptedResearchId_fkey" FOREIGN KEY ("adoptedResearchId") REFERENCES "ResearchRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SkillCommission_adoptedResearchId_key" ON "SkillCommission"("adoptedResearchId");
CREATE UNIQUE INDEX "SkillCommission_authorId_requestKey_key" ON "SkillCommission"("authorId", "requestKey");
CREATE INDEX "SkillCommission_matterId_baseResearchId_createdAt_idx" ON "SkillCommission"("matterId", "baseResearchId", "createdAt");
