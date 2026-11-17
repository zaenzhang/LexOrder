-- Optional positions belong to the existing exact document references. Historical
-- text remains text: there is no default, backfill, or replacement of old records.
ALTER TABLE "DocumentReviewIssue" ADD COLUMN "position" JSONB, ADD COLUMN "basisPosition" JSONB;
ALTER TABLE "DocumentReviewEvent" ADD COLUMN "revisionPosition" JSONB;

CREATE FUNCTION lexorder_review_position_valid(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  loc JSONB;
  fields TEXT[];
  numbers TEXT[];
  field TEXT;
  number NUMERIC;
  location_kind TEXT;
BEGIN
  IF value IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(value) IS DISTINCT FROM 'object'
    OR NOT (value ?& ARRAY['documentSha256', 'location', 'parseRunId', 'anchorId'])
    OR value - ARRAY['documentSha256', 'location', 'parseRunId', 'anchorId'] <> '{}'::jsonb
    OR jsonb_typeof(value->'documentSha256') IS DISTINCT FROM 'string'
    OR (value->>'documentSha256') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(value->'location') IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
  IF value->'parseRunId' = 'null'::jsonb THEN
    IF value->'anchorId' <> 'null'::jsonb OR value->'location'->>'kind' IS DISTINCT FROM 'PAGE' THEN RETURN FALSE; END IF;
  ELSE
    IF jsonb_typeof(value->'parseRunId') IS DISTINCT FROM 'string'
      OR length(value->>'parseRunId') NOT BETWEEN 1 AND 512
      OR jsonb_typeof(value->'anchorId') IS DISTINCT FROM 'string'
      OR length(value->>'anchorId') NOT BETWEEN 1 AND 512 THEN RETURN FALSE; END IF;
  END IF;
  loc := value->'location';
  location_kind := loc->>'kind';
  CASE location_kind
    WHEN 'PAGE' THEN fields := ARRAY['kind','page']; numbers := ARRAY['page'];
    WHEN 'TEXT' THEN fields := ARRAY['kind','start','end']; numbers := ARRAY['start','end'];
    WHEN 'PARAGRAPH' THEN fields := ARRAY['kind','paragraph','start','end']; numbers := ARRAY['paragraph','start','end'];
    WHEN 'TABLE' THEN
      fields := ARRAY['kind','sheet','rowStart','rowEnd','columnStart','columnEnd'];
      numbers := ARRAY['rowStart','rowEnd','columnStart','columnEnd'];
      IF jsonb_typeof(loc->'sheet') IS DISTINCT FROM 'string' OR length(loc->>'sheet') NOT BETWEEN 1 AND 512 THEN RETURN FALSE; END IF;
    WHEN 'IMAGE' THEN fields := ARRAY['kind','x','y','width','height']; numbers := ARRAY['x','y','width','height'];
    ELSE RETURN FALSE;
  END CASE;
  IF NOT (loc ?& fields) OR loc - fields <> '{}'::jsonb THEN RETURN FALSE; END IF;
  FOREACH field IN ARRAY numbers LOOP
    IF jsonb_typeof(loc->field) IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
    number := (loc->>field)::numeric;
    IF location_kind = 'IMAGE' THEN
      IF number < 0 OR number > 1 OR (field IN ('width','height') AND number = 0) THEN RETURN FALSE; END IF;
    ELSE
      IF trunc(number) <> number OR number < 0 OR (field NOT IN ('start','end') AND number = 0) THEN RETURN FALSE; END IF;
    END IF;
  END LOOP;
  IF location_kind IN ('TEXT','PARAGRAPH') AND (loc->>'end')::numeric <= (loc->>'start')::numeric THEN RETURN FALSE; END IF;
  IF location_kind = 'TABLE' AND ((loc->>'rowEnd')::numeric < (loc->>'rowStart')::numeric OR
    (loc->>'columnEnd')::numeric < (loc->>'columnStart')::numeric) THEN RETURN FALSE; END IF;
  IF location_kind = 'IMAGE' AND ((loc->>'x')::numeric + (loc->>'width')::numeric > 1 OR
    (loc->>'y')::numeric + (loc->>'height')::numeric > 1) THEN RETURN FALSE; END IF;
  RETURN TRUE;
END;
$$;

ALTER TABLE "DocumentReviewIssue"
  ADD CONSTRAINT "DocumentReviewIssue_position_shape" CHECK (lexorder_review_position_valid("position")),
  ADD CONSTRAINT "DocumentReviewIssue_basisPosition_shape" CHECK (lexorder_review_position_valid("basisPosition") AND ("basisPosition" IS NULL OR "basisDocumentId" IS NOT NULL));
ALTER TABLE "DocumentReviewEvent"
  ADD CONSTRAINT "DocumentReviewEvent_revisionPosition_shape" CHECK (lexorder_review_position_valid("revisionPosition") AND
    ("revisionPosition" IS NULL OR ("kind" = 'RESPONSE' AND "revisionDocumentId" IS NOT NULL)));

-- document_review_issue_fixed compares to_jsonb except state/version; the existing
-- document_review_event_fixed forbids all updates/deletes. Both include these columns.
