CREATE TABLE "SkillHostGrant" (
    "id" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SkillHostGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SkillHostGrant_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "SkillCommission"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SkillHostGrant_tokenHash_key" ON "SkillHostGrant"("tokenHash");
CREATE INDEX "SkillHostGrant_commissionId_expiresAt_idx" ON "SkillHostGrant"("commissionId", "expiresAt");
