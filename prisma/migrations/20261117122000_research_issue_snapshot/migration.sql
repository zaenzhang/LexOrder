BEGIN;

ALTER TABLE "ResearchRevision" ADD COLUMN "issueSnapshot" JSONB;

-- Copy only the exact revision already referenced by the saved research. Never consult
-- the current EvidenceItem content, confirmation or sources to reconstruct old inputs.
ALTER TABLE "ResearchRevision" DISABLE TRIGGER research_revision_fixed;
UPDATE "ResearchRevision" AS r
SET "issueSnapshot" = jsonb_build_object(
  'evidenceItemId', e."evidenceItemId", 'matterId', r."matterId", 'revision', e."revision",
  'revisionId', e."id", 'title', e."title", 'content', e."content", 'kind', e."kind",
  'eventDate', jsonb_build_object('precision', e."eventDatePrecision",
    'start', to_char(e."eventDateStart", 'YYYY-MM-DD'), 'end', to_char(e."eventDateEnd", 'YYYY-MM-DD'), 'text', e."eventDateText"),
  'sourceSnapshot', e."sourceSnapshot", 'confirmedById', e."confirmedById",
  'confirmedAt', CASE WHEN e."confirmedAt" IS NOT NULL THEN to_char(e."confirmedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
  'capturedAt', to_char(r."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'capturedById', r."authorId"
)
FROM "EvidenceItemRevision" AS e
JOIN "EvidenceItem" AS i ON i."id" = e."evidenceItemId"
WHERE r."issueRevisionId" = e."id" AND r."issueId" = e."evidenceItemId"
  AND r."matterId" = i."matterId" AND e."kind" = 'ISSUE';
ALTER TABLE "ResearchRevision" ENABLE TRIGGER research_revision_fixed;

-- An inconsistent old binding stops the migration instead of inventing a missing input.
ALTER TABLE "ResearchRevision" ADD CONSTRAINT "ResearchRevision_issue_snapshot_check" CHECK ((
  ("issueId" IS NULL AND "issueRevisionId" IS NULL AND "issueSnapshot" IS NULL)
  OR ("issueId" IS NOT NULL AND "issueSnapshot" IS NOT NULL
    AND jsonb_typeof("issueSnapshot") = 'object'
    AND "issueSnapshot"->>'evidenceItemId' = "issueId"
    AND "issueSnapshot"->>'matterId' = "matterId"
    AND ("issueSnapshot"->>'revisionId') IS NOT DISTINCT FROM "issueRevisionId")
) IS TRUE);

COMMIT;
