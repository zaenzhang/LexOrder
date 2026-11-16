-- Existing requests keep their original history without an invented submission identity.
ALTER TABLE "InvoiceRequest" ADD COLUMN "requestKey" TEXT,
ADD COLUMN "requestHash" TEXT;

CREATE UNIQUE INDEX "InvoiceRequest_requestedById_requestKey_key"
ON "InvoiceRequest"("requestedById", "requestKey");

ALTER TABLE "InvoiceRequest" ADD CONSTRAINT "InvoiceRequest_create_request_shape_check" CHECK (
  ("requestKey" IS NULL AND "requestHash" IS NULL)
  OR (
    "requestKey" IS NOT NULL AND "requestHash" IS NOT NULL
    AND "requestKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND "requestHash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE FUNCTION "protect_invoice_create_request"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."requestKey" IS DISTINCT FROM OLD."requestKey"
     OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
     OR (OLD."requestKey" IS NOT NULL AND NEW."requestedById" IS DISTINCT FROM OLD."requestedById") THEN
    RAISE EXCEPTION 'InvoiceRequest creation request is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InvoiceRequest_create_request_immutable"
BEFORE UPDATE OF "requestKey", "requestHash", "requestedById" ON "InvoiceRequest"
FOR EACH ROW EXECUTE FUNCTION "protect_invoice_create_request"();
