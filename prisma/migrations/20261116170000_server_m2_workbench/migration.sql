-- CreateEnum
CREATE TYPE "DocumentParseState" AS ENUM ('PENDING', 'RUNNING', 'READY', 'PARTIAL', 'FAILED', 'UNSUPPORTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EvidenceSourceRelation" AS ENUM ('SUPPORTS', 'REBUTS', 'CONTEXT');

-- CreateEnum
CREATE TYPE "MatterContextKind" AS ENUM ('GOAL', 'CONSTRAINT', 'INSTRUCTION', 'OPTION', 'DECISION');

-- CreateEnum
CREATE TYPE "MatterContextVisibility" AS ENUM ('MATTER', 'FINANCE');

-- CreateEnum
CREATE TYPE "MatterContextConfirmation" AS ENUM ('PENDING', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "MaterialIngestState" AS ENUM ('PENDING', 'STORED', 'COMMITTED', 'FAILED');

-- AlterEnum
ALTER TYPE "DocumentOcrStatus" ADD VALUE 'PARTIAL';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "parseGeneration" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "EvidenceItem" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "JobQueue" ADD COLUMN     "leaseToken" TEXT;

-- CreateTable
CREATE TABLE "DocumentParseRun" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "requestedById" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "state" "DocumentParseState" NOT NULL DEFAULT 'PENDING',
    "coverage" JSONB,
    "anchors" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentParseRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceSourceLink" (
    "id" TEXT NOT NULL,
    "evidenceItemId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "relation" "EvidenceSourceRelation" NOT NULL,
    "location" JSONB NOT NULL,
    "locationKey" TEXT NOT NULL,
    "parseRunId" TEXT,
    "anchorId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedById" TEXT,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "EvidenceSourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItemRevision" (
    "sourceSnapshot" JSONB NOT NULL DEFAULT '[]',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "evidenceItemId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "editedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceItemRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterContextRecord" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "kind" "MatterContextKind" NOT NULL,
    "content" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "sourceDescription" TEXT NOT NULL,
    "sourceNoteId" TEXT,
    "sourceClientActivityId" TEXT,
    "sourceDocumentId" TEXT,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seriesId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "supersedesId" TEXT,
    "confirmationStatus" "MatterContextConfirmation" NOT NULL DEFAULT 'PENDING',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "visibility" "MatterContextVisibility" NOT NULL DEFAULT 'MATTER',
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "MatterContextRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialIngestIntent" (
    "id" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "matterId" TEXT,
    "intakeId" TEXT,
    "priorDocumentId" TEXT,
    "sourceSha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL,
    "state" "MaterialIngestState" NOT NULL DEFAULT 'PENDING',
    "documentId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialIngestIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentParseRun_state_createdAt_idx" ON "DocumentParseRun"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentParseRun_documentId_generation_key" ON "DocumentParseRun"("documentId", "generation");

-- CreateIndex
CREATE INDEX "EvidenceSourceLink_documentId_idx" ON "EvidenceSourceLink"("documentId");

-- CreateIndex
CREATE INDEX "EvidenceSourceLink_parseRunId_idx" ON "EvidenceSourceLink"("parseRunId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceSourceLink_evidenceItemId_documentId_relation_locat_key" ON "EvidenceSourceLink"("evidenceItemId", "documentId", "relation", "locationKey");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceItemRevision_evidenceItemId_revision_key" ON "EvidenceItemRevision"("evidenceItemId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "MatterContextRecord_supersedesId_key" ON "MatterContextRecord"("supersedesId");

-- CreateIndex
CREATE INDEX "MatterContextRecord_matterId_kind_createdAt_idx" ON "MatterContextRecord"("matterId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatterContextRecord_seriesId_version_key" ON "MatterContextRecord"("seriesId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MatterContextRecord_authorId_requestKey_key" ON "MatterContextRecord"("authorId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialIngestIntent_storagePath_key" ON "MaterialIngestIntent"("storagePath");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialIngestIntent_documentId_key" ON "MaterialIngestIntent"("documentId");

-- CreateIndex
CREATE INDEX "MaterialIngestIntent_state_createdAt_idx" ON "MaterialIngestIntent"("state", "createdAt");

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentParseRun" ADD CONSTRAINT "DocumentParseRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentParseRun" ADD CONSTRAINT "DocumentParseRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceSourceLink" ADD CONSTRAINT "EvidenceSourceLink_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "EvidenceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceSourceLink" ADD CONSTRAINT "EvidenceSourceLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceSourceLink" ADD CONSTRAINT "EvidenceSourceLink_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItemRevision" ADD CONSTRAINT "EvidenceItemRevision_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "EvidenceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItemRevision" ADD CONSTRAINT "EvidenceItemRevision_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterContextRecord" ADD CONSTRAINT "MatterContextRecord_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterContextRecord" ADD CONSTRAINT "MatterContextRecord_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterContextRecord" ADD CONSTRAINT "MatterContextRecord_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "MatterContextRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterContextRecord" ADD CONSTRAINT "MatterContextRecord_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- M2 correctness constraints; no historical author/confirmation backfill.
ALTER TABLE "Document" ADD CONSTRAINT "Document_parseGeneration_nonnegative" CHECK ("parseGeneration" >= 0);
ALTER TABLE "DocumentParseRun" ADD CONSTRAINT "DocumentParseRun_identity_check"
  CHECK ("generation" > 0 AND "sourceSha256" ~ '^[a-f0-9]{64}$');
ALTER TABLE "EvidenceSourceLink" ADD CONSTRAINT "EvidenceSourceLink_identity_check"
  CHECK ("documentSha256" ~ '^[a-f0-9]{64}$' AND (("parseRunId" IS NULL) = ("anchorId" IS NULL))
    AND (("removedAt" IS NULL) = ("removedById" IS NULL)));
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_revision_confirmation_check"
  CHECK ("revision" > 0 AND (("confirmedAt" IS NULL) = ("confirmedById" IS NULL)));
ALTER TABLE "EvidenceItemRevision" ADD CONSTRAINT "EvidenceItemRevision_snapshot_check"
  CHECK ("revision" > 0 AND jsonb_typeof("sourceSnapshot") = 'array'
    AND (("confirmedAt" IS NULL) = ("confirmedById" IS NULL)));
ALTER TABLE "MatterContextRecord" ADD CONSTRAINT "MatterContextRecord_version_confirmation_check"
  CHECK ("version" > 0 AND (("version" = 1) = ("supersedesId" IS NULL))
    AND (("confirmationStatus" = 'PENDING' AND "confirmedById" IS NULL AND "confirmedAt" IS NULL)
      OR ("confirmationStatus" = 'CONFIRMED' AND "confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL)));
ALTER TABLE "MaterialIngestIntent" ADD CONSTRAINT "MaterialIngestIntent_identity_check"
  CHECK ("sourceSha256" ~ '^[a-f0-9]{64}$' AND "size" >= 0
    AND (("matterId" IS NULL) <> ("intakeId" IS NULL))
    AND ("state" <> 'COMMITTED' OR "documentId" IS NOT NULL));

CREATE FUNCTION "m2_guard_context_history"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "MatterContextRecord";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Matter context history cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND
    (to_jsonb(NEW) - ARRAY['confirmationStatus','confirmedById','confirmedAt'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['confirmationStatus','confirmedById','confirmedAt']) THEN
    RAISE EXCEPTION 'Matter context content is immutable; append a revision';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."confirmationStatus" = 'CONFIRMED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Confirmed matter context is immutable';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."supersedesId" IS NOT NULL THEN
    SELECT * INTO parent FROM "MatterContextRecord" WHERE id = NEW."supersedesId" FOR UPDATE;
    IF NOT FOUND OR parent."seriesId" <> NEW."seriesId" OR parent."matterId" <> NEW."matterId"
      OR parent.kind <> NEW.kind OR parent.version + 1 <> NEW.version
      OR parent.visibility <> NEW.visibility THEN
      RAISE EXCEPTION 'Invalid matter context revision chain';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "MatterContextRecord_history_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MatterContextRecord"
  FOR EACH ROW EXECUTE FUNCTION "m2_guard_context_history"();

CREATE FUNCTION "m2_guard_evidence_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Evidence revision snapshots are immutable';
END $$;
CREATE TRIGGER "EvidenceItemRevision_immutable" BEFORE UPDATE OR DELETE ON "EvidenceItemRevision"
  FOR EACH ROW EXECUTE FUNCTION "m2_guard_evidence_revision"();

CREATE FUNCTION "m2_guard_parse_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."documentId", NEW.generation, NEW."requestedById", NEW."parserVersion", NEW."sourceSha256")
      IS DISTINCT FROM (OLD."documentId", OLD.generation, OLD."requestedById", OLD."parserVersion", OLD."sourceSha256") THEN
    RAISE EXCEPTION 'Parse identity is immutable';
  END IF;
  IF OLD."finishedAt" IS NOT NULL AND (NEW.anchors, NEW.coverage) IS DISTINCT FROM (OLD.anchors, OLD.coverage) THEN
    RAISE EXCEPTION 'Published parse representation is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "DocumentParseRun_identity_guard" BEFORE UPDATE ON "DocumentParseRun"
  FOR EACH ROW EXECUTE FUNCTION "m2_guard_parse_identity"();
