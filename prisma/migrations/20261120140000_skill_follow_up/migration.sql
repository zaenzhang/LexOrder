ALTER TABLE "SkillCommission" ADD COLUMN "priorCommissionId" TEXT, ADD COLUMN "followUp" JSONB;
ALTER TABLE "SkillCommission" ADD CONSTRAINT "SkillCommission_priorCommissionId_fkey"
  FOREIGN KEY ("priorCommissionId") REFERENCES "SkillCommission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SkillCommission" ADD CONSTRAINT "SkillCommission_follow_up_paired"
  CHECK (("priorCommissionId" IS NULL) = ("followUp" IS NULL));
CREATE INDEX "SkillCommission_priorCommissionId_idx" ON "SkillCommission"("priorCommissionId");
