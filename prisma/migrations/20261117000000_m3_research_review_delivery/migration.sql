-- CreateEnum
CREATE TYPE "DocumentReviewIssueState" AS ENUM ('OPEN', 'WAITING_CHECK', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DocumentReviewEventKind" AS ENUM ('RESPONSE', 'CHECK');

-- CreateEnum
CREATE TYPE "DocumentReviewDisposition" AS ENUM ('ACCEPT', 'PARTIAL', 'REJECT');

-- CreateEnum
CREATE TYPE "DeliveryEventKind" AS ENUM ('EXPORTED', 'SENT', 'RECEIVED', 'REPLIED', 'CONTENT_CONFIRMED', 'SEND_CORRECTION');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "generationRequestHash" TEXT,
ADD COLUMN     "generationRequestKey" TEXT;

-- CreateTable
CREATE TABLE "ResearchRevision" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "supersedesId" TEXT,
    "issueId" TEXT,
    "issueRevisionId" TEXT,
    "question" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "relevantDate" TEXT,
    "researchedAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "queryLog" JSONB NOT NULL,
    "rule" TEXT NOT NULL,
    "exceptions" TEXT NOT NULL,
    "supportingAnalysis" TEXT NOT NULL,
    "opposingAnalysis" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "unresolved" TEXT NOT NULL,
    "nextSteps" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3),
    "checkedById" TEXT,
    "checkNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "researchRevisionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "relation" "EvidenceSourceRelation" NOT NULL,
    "location" JSONB NOT NULL,
    "locationKey" TEXT NOT NULL,
    "parseRunId" TEXT,
    "anchorId" TEXT,
    "lawMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentResearchSource" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "researchRevisionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentReviewIssue" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "basis" TEXT NOT NULL,
    "basisDocumentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" "DocumentReviewIssueState" NOT NULL DEFAULT 'OPEN',
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "DocumentReviewIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentReviewEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "kind" "DocumentReviewEventKind" NOT NULL,
    "disposition" "DocumentReviewDisposition",
    "note" TEXT NOT NULL,
    "revisionDocumentId" TEXT,
    "revisionLocation" TEXT,
    "resolved" BOOLEAN,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "DocumentReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRecord" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "recipientClientId" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientContact" TEXT NOT NULL,
    "disclosureScope" TEXT NOT NULL,
    "unresolvedItems" TEXT NOT NULL,
    "supersedesId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryItem" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "documentName" TEXT NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "size" INTEGER,

    CONSTRAINT "DeliveryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "kind" "DeliveryEventKind" NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "channel" TEXT,
    "note" TEXT,
    "proofDocumentId" TEXT,
    "correctsEventId" TEXT,

    CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRevision_supersedesId_key" ON "ResearchRevision"("supersedesId");

-- CreateIndex
CREATE INDEX "ResearchRevision_matterId_createdAt_idx" ON "ResearchRevision"("matterId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRevision_issueId_idx" ON "ResearchRevision"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRevision_seriesId_version_key" ON "ResearchRevision"("seriesId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRevision_authorId_requestKey_key" ON "ResearchRevision"("authorId", "requestKey");

-- CreateIndex
CREATE INDEX "ResearchSource_documentId_idx" ON "ResearchSource"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSource_researchRevisionId_documentId_relation_locat_key" ON "ResearchSource"("researchRevisionId", "documentId", "relation", "locationKey");

-- CreateIndex
CREATE INDEX "DocumentResearchSource_researchRevisionId_idx" ON "DocumentResearchSource"("researchRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentResearchSource_documentId_researchRevisionId_key" ON "DocumentResearchSource"("documentId", "researchRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentReviewIssue_requestId_key" ON "DocumentReviewIssue"("requestId");

-- CreateIndex
CREATE INDEX "DocumentReviewIssue_documentId_createdAt_idx" ON "DocumentReviewIssue"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentReviewEvent_requestId_key" ON "DocumentReviewEvent"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentReviewEvent_issueId_version_key" ON "DocumentReviewEvent"("issueId", "version");

-- CreateIndex
CREATE INDEX "DeliveryRecord_matterId_createdAt_idx" ON "DeliveryRecord"("matterId", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryRecord_recipientClientId_createdAt_idx" ON "DeliveryRecord"("recipientClientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRecord_createdById_requestKey_key" ON "DeliveryRecord"("createdById", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryItem_deliveryId_position_key" ON "DeliveryItem"("deliveryId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryItem_deliveryId_documentId_key" ON "DeliveryItem"("deliveryId", "documentId");

-- CreateIndex
CREATE INDEX "DeliveryEvent_deliveryId_recordedAt_idx" ON "DeliveryEvent"("deliveryId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryEvent_actorId_requestKey_key" ON "DeliveryEvent"("actorId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Document_generationRequestKey_key" ON "Document"("generationRequestKey");

-- AddForeignKey
ALTER TABLE "ResearchRevision" ADD CONSTRAINT "ResearchRevision_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRevision" ADD CONSTRAINT "ResearchRevision_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ResearchRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRevision" ADD CONSTRAINT "ResearchRevision_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "EvidenceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRevision" ADD CONSTRAINT "ResearchRevision_issueRevisionId_fkey" FOREIGN KEY ("issueRevisionId") REFERENCES "EvidenceItemRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRevision" ADD CONSTRAINT "ResearchRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRevision" ADD CONSTRAINT "ResearchRevision_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_researchRevisionId_fkey" FOREIGN KEY ("researchRevisionId") REFERENCES "ResearchRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentResearchSource" ADD CONSTRAINT "DocumentResearchSource_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentResearchSource" ADD CONSTRAINT "DocumentResearchSource_researchRevisionId_fkey" FOREIGN KEY ("researchRevisionId") REFERENCES "ResearchRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReviewIssue" ADD CONSTRAINT "DocumentReviewIssue_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReviewIssue" ADD CONSTRAINT "DocumentReviewIssue_basisDocumentId_fkey" FOREIGN KEY ("basisDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReviewIssue" ADD CONSTRAINT "DocumentReviewIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReviewEvent" ADD CONSTRAINT "DocumentReviewEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "DocumentReviewIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReviewEvent" ADD CONSTRAINT "DocumentReviewEvent_revisionDocumentId_fkey" FOREIGN KEY ("revisionDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReviewEvent" ADD CONSTRAINT "DocumentReviewEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_recipientClientId_fkey" FOREIGN KEY ("recipientClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "DeliveryRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DeliveryRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_proofDocumentId_fkey" FOREIGN KEY ("proofDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_correctsEventId_fkey" FOREIGN KEY ("correctsEventId") REFERENCES "DeliveryEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Historical research and delivery inputs are facts, not editable projections.
ALTER TABLE "ResearchRevision" ADD CONSTRAINT "ResearchRevision_version_check" CHECK ("version" > 0);
ALTER TABLE "ResearchRevision" ADD CONSTRAINT "ResearchRevision_check_pair" CHECK (("checkedAt" IS NULL) = ("checkedById" IS NULL));
ALTER TABLE "DocumentReviewIssue" ADD CONSTRAINT "DocumentReviewIssue_version_check" CHECK ("version" > 0);
ALTER TABLE "DocumentReviewEvent" ADD CONSTRAINT "DocumentReviewEvent_shape_check" CHECK (
  ("kind" = 'RESPONSE' AND "disposition" IS NOT NULL AND "resolved" IS NULL)
  OR ("kind" = 'CHECK' AND "disposition" IS NULL AND "resolved" IS NOT NULL)
);
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_position_check" CHECK ("position" >= 0);
CREATE UNIQUE INDEX "DeliveryEvent_one_sent" ON "DeliveryEvent" ("deliveryId") WHERE "kind" = 'SENT';

CREATE FUNCTION lexorder_m3_fixed_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; append a revision or event', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER research_source_fixed BEFORE UPDATE OR DELETE ON "ResearchSource" FOR EACH ROW EXECUTE FUNCTION lexorder_m3_fixed_record();
CREATE TRIGGER document_research_fixed BEFORE UPDATE OR DELETE ON "DocumentResearchSource" FOR EACH ROW EXECUTE FUNCTION lexorder_m3_fixed_record();
CREATE TRIGGER document_review_event_fixed BEFORE UPDATE OR DELETE ON "DocumentReviewEvent" FOR EACH ROW EXECUTE FUNCTION lexorder_m3_fixed_record();
CREATE TRIGGER delivery_record_fixed BEFORE UPDATE OR DELETE ON "DeliveryRecord" FOR EACH ROW EXECUTE FUNCTION lexorder_m3_fixed_record();
CREATE TRIGGER delivery_item_fixed BEFORE UPDATE OR DELETE ON "DeliveryItem" FOR EACH ROW EXECUTE FUNCTION lexorder_m3_fixed_record();
CREATE TRIGGER delivery_event_fixed BEFORE UPDATE OR DELETE ON "DeliveryEvent" FOR EACH ROW EXECUTE FUNCTION lexorder_m3_fixed_record();

CREATE FUNCTION lexorder_research_revision_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Research revisions cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['checkedAt', 'checkedById', 'checkNote']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['checkedAt', 'checkedById', 'checkNote'])
     OR (OLD."checkedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Research content is immutable; save a new revision';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER research_revision_fixed BEFORE UPDATE OR DELETE ON "ResearchRevision" FOR EACH ROW EXECUTE FUNCTION lexorder_research_revision_fixed();

CREATE FUNCTION lexorder_review_issue_identity_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Review issues cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['version', 'state']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['version', 'state']) THEN
    RAISE EXCEPTION 'Review issue identity is immutable; append a response';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER document_review_issue_fixed BEFORE UPDATE OR DELETE ON "DocumentReviewIssue" FOR EACH ROW EXECUTE FUNCTION lexorder_review_issue_identity_fixed();
