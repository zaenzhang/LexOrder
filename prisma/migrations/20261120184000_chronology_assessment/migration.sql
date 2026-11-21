ALTER TABLE "EvidenceItem" ADD COLUMN "chronologyAssessment" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "EvidenceItemRevision" ADD COLUMN "chronologyAssessment" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Document" ADD COLUMN "chronologyStage" TEXT CHECK ("chronologyStage" IN ('consultation', 'discussion', 'preparation', 'hearing', 'afterHearing', 'closed'));
