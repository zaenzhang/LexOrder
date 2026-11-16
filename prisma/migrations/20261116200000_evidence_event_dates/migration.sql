-- Date-only fact timing belongs to the existing item and its immutable revision.
-- Legacy rows remain UNKNOWN; recording/upload dates must never be inferred.
CREATE TYPE "EvidenceDatePrecision" AS ENUM ('UNKNOWN', 'EXACT', 'RANGE');

ALTER TABLE "EvidenceItem"
  ADD COLUMN "eventDatePrecision" "EvidenceDatePrecision" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "eventDateStart" DATE,
  ADD COLUMN "eventDateEnd" DATE,
  ADD COLUMN "eventDateText" TEXT,
  ADD CONSTRAINT "EvidenceItem_event_date_shape_check" CHECK (
    ("eventDatePrecision" = 'UNKNOWN' AND "eventDateStart" IS NULL AND "eventDateEnd" IS NULL)
    OR ("eventDatePrecision" = 'EXACT' AND "eventDateStart" IS NOT NULL AND "eventDateEnd" IS NULL)
    OR ("eventDatePrecision" = 'RANGE' AND "eventDateStart" IS NOT NULL AND "eventDateEnd" IS NOT NULL AND "eventDateEnd" >= "eventDateStart")
  ),
  ADD CONSTRAINT "EvidenceItem_event_date_bounds_check" CHECK (
    ("eventDateStart" IS NULL OR "eventDateStart" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
    AND ("eventDateEnd" IS NULL OR "eventDateEnd" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
    AND ("eventDateText" IS NULL OR char_length("eventDateText") <= 500)
  );

-- ADD COLUMN defaults do not issue an UPDATE against the append-only history.
-- Its existing immutable trigger continues protecting all columns.
ALTER TABLE "EvidenceItemRevision"
  ADD COLUMN "eventDatePrecision" "EvidenceDatePrecision" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "eventDateStart" DATE,
  ADD COLUMN "eventDateEnd" DATE,
  ADD COLUMN "eventDateText" TEXT,
  ADD CONSTRAINT "EvidenceItemRevision_event_date_shape_check" CHECK (
    ("eventDatePrecision" = 'UNKNOWN' AND "eventDateStart" IS NULL AND "eventDateEnd" IS NULL)
    OR ("eventDatePrecision" = 'EXACT' AND "eventDateStart" IS NOT NULL AND "eventDateEnd" IS NULL)
    OR ("eventDatePrecision" = 'RANGE' AND "eventDateStart" IS NOT NULL AND "eventDateEnd" IS NOT NULL AND "eventDateEnd" >= "eventDateStart")
  ),
  ADD CONSTRAINT "EvidenceItemRevision_event_date_bounds_check" CHECK (
    ("eventDateStart" IS NULL OR "eventDateStart" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
    AND ("eventDateEnd" IS NULL OR "eventDateEnd" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
    AND ("eventDateText" IS NULL OR char_length("eventDateText") <= 500)
  );
