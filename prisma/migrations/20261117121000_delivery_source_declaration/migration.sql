-- New declarations apply only to the selected version in a new delivery.
-- Existing records and document provenance remain unchanged.
ALTER TABLE "DeliveryItem" ADD COLUMN "sourceDeclaration" TEXT;
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_sourceDeclaration_check"
  CHECK ("sourceDeclaration" IS NULL OR "sourceDeclaration" IN ('TEAM_PRODUCED', 'EXTERNAL_ATTACHMENT'));
