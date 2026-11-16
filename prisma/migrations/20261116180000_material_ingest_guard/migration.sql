-- A late storage response must never reopen a published upload intent.
CREATE FUNCTION lexorder_material_ingest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW."storagePath", NEW."requestedById", NEW."matterId", NEW."intakeId",
         NEW."priorDocumentId", NEW."sourceSha256", NEW.size, NEW.metadata, NEW."createdAt")
     IS DISTINCT FROM
     ROW(OLD.id, OLD."storagePath", OLD."requestedById", OLD."matterId", OLD."intakeId",
         OLD."priorDocumentId", OLD."sourceSha256", OLD.size, OLD.metadata, OLD."createdAt") THEN
    RAISE EXCEPTION 'Material upload identity is immutable';
  END IF;
  IF OLD."documentId" IS NOT NULL AND
     (NEW."documentId" IS DISTINCT FROM OLD."documentId" OR NEW.state <> 'COMMITTED') THEN
    RAISE EXCEPTION 'Committed material upload cannot be reopened';
  END IF;
  IF OLD."errorCode" = 'UPLOAD_ABANDONED' AND
     ROW(NEW.state, NEW."errorCode", NEW."documentId") IS DISTINCT FROM
     ROW(OLD.state, OLD."errorCode", OLD."documentId") THEN
    RAISE EXCEPTION 'Abandoned material upload cannot be reopened';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER material_ingest_immutable
BEFORE UPDATE ON "MaterialIngestIntent"
FOR EACH ROW EXECUTE FUNCTION lexorder_material_ingest_guard();
