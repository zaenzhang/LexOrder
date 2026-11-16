-- Unknown historical relationships remain unknown. A selected old version may
-- establish its own family when a new version is explicitly created.
-- Stop for manual review rather than rewrite ambiguous existing versions.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Document" WHERE "familyId" IS NOT NULL
    GROUP BY "familyId", "version" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Document version families contain duplicate version numbers; review before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Document" WHERE "familyId" IS NOT NULL AND "isLatest" AND "deletedAt" IS NULL
    GROUP BY "familyId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Document version families contain multiple current versions; review before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "Document_familyId_version_key" ON "Document"("familyId", "version");
CREATE UNIQUE INDEX "Document_family_active_latest_key" ON "Document"("familyId")
WHERE "familyId" IS NOT NULL AND "isLatest" = true AND "deletedAt" IS NULL;
