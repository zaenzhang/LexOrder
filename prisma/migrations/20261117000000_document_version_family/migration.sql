-- A missing historical family starts at that concrete document. Existing families,
-- document IDs, source references and approval records retain their identities.
UPDATE "Document" SET "familyId" = id WHERE "familyId" IS NULL;

ALTER TABLE "Document" ALTER COLUMN "familyId" SET NOT NULL;

CREATE UNIQUE INDEX "Document_familyId_version_key" ON "Document"("familyId", "version");
CREATE UNIQUE INDEX "Document_family_active_latest_key" ON "Document"("familyId")
WHERE "isLatest" = true AND "deletedAt" IS NULL;
