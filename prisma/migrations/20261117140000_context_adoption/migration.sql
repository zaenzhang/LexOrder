-- Fixed inputs are created only with a new option/document. No historical rows are backfilled.
CREATE TABLE "OptionContextInput" (
  "optionRecordId" TEXT NOT NULL,
  "contextRecordId" TEXT NOT NULL,
  "currentRecordIdAtAdoption" TEXT NOT NULL,
  "adoptedConfirmedAt" TIMESTAMP(3),
  CONSTRAINT "OptionContextInput_pkey" PRIMARY KEY ("optionRecordId", "contextRecordId")
);
CREATE TABLE "DocumentContextInput" (
  "documentId" TEXT NOT NULL,
  "contextRecordId" TEXT NOT NULL,
  "currentRecordIdAtAdoption" TEXT NOT NULL,
  "adoptedConfirmedAt" TIMESTAMP(3),
  CONSTRAINT "DocumentContextInput_pkey" PRIMARY KEY ("documentId", "contextRecordId")
);
CREATE INDEX "OptionContextInput_contextRecordId_idx" ON "OptionContextInput"("contextRecordId");
CREATE INDEX "OptionContextInput_currentRecordIdAtAdoption_idx" ON "OptionContextInput"("currentRecordIdAtAdoption");
CREATE INDEX "DocumentContextInput_contextRecordId_idx" ON "DocumentContextInput"("contextRecordId");
CREATE INDEX "DocumentContextInput_currentRecordIdAtAdoption_idx" ON "DocumentContextInput"("currentRecordIdAtAdoption");
ALTER TABLE "OptionContextInput" ADD CONSTRAINT "OptionContextInput_optionRecordId_fkey" FOREIGN KEY ("optionRecordId") REFERENCES "MatterContextRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptionContextInput" ADD CONSTRAINT "OptionContextInput_contextRecordId_fkey" FOREIGN KEY ("contextRecordId") REFERENCES "MatterContextRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptionContextInput" ADD CONSTRAINT "OptionContextInput_currentRecordIdAtAdoption_fkey" FOREIGN KEY ("currentRecordIdAtAdoption") REFERENCES "MatterContextRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentContextInput" ADD CONSTRAINT "DocumentContextInput_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentContextInput" ADD CONSTRAINT "DocumentContextInput_contextRecordId_fkey" FOREIGN KEY ("contextRecordId") REFERENCES "MatterContextRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentContextInput" ADD CONSTRAINT "DocumentContextInput_currentRecordIdAtAdoption_fkey" FOREIGN KEY ("currentRecordIdAtAdoption") REFERENCES "MatterContextRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "guard_context_adoption"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE chosen "MatterContextRecord"; tail "MatterContextRecord"; target_matter TEXT; target_kind "MatterContextKind";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Context adoption is immutable; create a new target revision';
  END IF;
  SELECT * INTO chosen FROM "MatterContextRecord" WHERE id = NEW."contextRecordId" FOR SHARE;
  IF NOT FOUND OR chosen.kind NOT IN ('GOAL', 'INSTRUCTION') THEN
    RAISE EXCEPTION 'Context adoption requires a goal or instruction';
  END IF;
  SELECT * INTO tail FROM "MatterContextRecord" WHERE id = NEW."currentRecordIdAtAdoption" FOR SHARE;
  IF NOT FOUND OR tail."seriesId" <> chosen."seriesId" OR tail."matterId" <> chosen."matterId"
    OR tail.version < chosen.version OR EXISTS (SELECT 1 FROM "MatterContextRecord" WHERE "supersedesId" = tail.id)
    OR NEW."adoptedConfirmedAt" IS DISTINCT FROM chosen."confirmedAt" THEN
    RAISE EXCEPTION 'Context adoption position or confirmation has changed';
  END IF;
  IF TG_TABLE_NAME = 'OptionContextInput' THEN
    SELECT "matterId", kind INTO target_matter, target_kind FROM "MatterContextRecord" WHERE id = NEW."optionRecordId";
    IF target_kind IS DISTINCT FROM 'OPTION'::"MatterContextKind" THEN
      RAISE EXCEPTION 'Context input target must be an option';
    END IF;
  ELSE
    SELECT "matterId" INTO target_matter FROM "Document" WHERE id = NEW."documentId";
    IF chosen."sourceDocumentId" = NEW."documentId" THEN
      RAISE EXCEPTION 'A document cannot derive from itself';
    END IF;
  END IF;
  IF target_matter IS DISTINCT FROM chosen."matterId" THEN
    RAISE EXCEPTION 'Context adoption must stay within the same matter';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OptionContextInput_guard" BEFORE INSERT OR UPDATE OR DELETE ON "OptionContextInput"
  FOR EACH ROW EXECUTE FUNCTION "guard_context_adoption"();
CREATE TRIGGER "DocumentContextInput_guard" BEFORE INSERT OR UPDATE OR DELETE ON "DocumentContextInput"
  FOR EACH ROW EXECUTE FUNCTION "guard_context_adoption"();
