-- Additive migration: legacy evidence has no reconstructed submission identity.
ALTER TABLE "EvidenceItem" ADD COLUMN "requestHash" TEXT,
ADD COLUMN "requestKey" TEXT;

CREATE UNIQUE INDEX "EvidenceItem_createdById_requestKey_key"
ON "EvidenceItem"("createdById", "requestKey");

ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_create_request_shape_check" CHECK (
  ("requestKey" IS NULL AND "requestHash" IS NULL)
  OR (
    "requestKey" IS NOT NULL AND "requestHash" IS NOT NULL
    AND "requestKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND "requestHash" ~ '^[0-9a-f]{64}$'
  )
);

-- Editing a result must never replace the original creation request or reuse its key.
CREATE FUNCTION "protect_evidence_create_request"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."requestKey" IS DISTINCT FROM OLD."requestKey"
     OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
     OR (OLD."requestKey" IS NOT NULL AND NEW."createdById" IS DISTINCT FROM OLD."createdById") THEN
    RAISE EXCEPTION 'EvidenceItem creation request is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "EvidenceItem_create_request_immutable"
BEFORE UPDATE OF "requestKey", "requestHash", "createdById" ON "EvidenceItem"
FOR EACH ROW EXECUTE FUNCTION "protect_evidence_create_request"();
