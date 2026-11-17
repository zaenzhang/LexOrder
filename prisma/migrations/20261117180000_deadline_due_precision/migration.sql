-- Explicit precision for new deadline input. Existing instants and unknown precision remain untouched.
CREATE TYPE "DeadlineDuePrecision" AS ENUM ('DATE', 'DATETIME');
ALTER TABLE "Deadline" ADD COLUMN "duePrecision" "DeadlineDuePrecision";
-- Prisma stores timestamp without time zone in UTC. Do not depend on the session timezone.
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_date_precision_check"
  CHECK ("duePrecision" IS DISTINCT FROM 'DATE'::"DeadlineDuePrecision"
    OR ("dueAt" + interval '8 hours')::time = time '00:00:00');

CREATE OR REPLACE FUNCTION lawlink_change_work_date() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_date timestamp; next_date timestamp; precision_changed boolean := false; change_detail jsonb;
BEGIN
 IF TG_TABLE_NAME='Hearing' THEN prior_date=OLD."startsAt";next_date=NEW."startsAt";
 ELSE prior_date=OLD."dueAt";next_date=NEW."dueAt";END IF;
 change_detail=jsonb_build_object('previousDate',prior_date,'newDate',next_date);
 IF TG_TABLE_NAME='Deadline' THEN
  precision_changed=OLD."duePrecision" IS DISTINCT FROM NEW."duePrecision";
  change_detail=change_detail || jsonb_build_object('previousDuePrecision',OLD."duePrecision",'newDuePrecision',NEW."duePrecision");
 END IF;
 IF prior_date IS DISTINCT FROM next_date OR precision_changed THEN
  UPDATE "WorkResponsibility" SET "acceptedAt"=NULL,revision=revision+1 WHERE "taskId"=NEW.id OR "deadlineId"=NEW.id OR "hearingId"=NEW.id;
  UPDATE "Notification" SET read=true,"readAt"=NOW(),content='原日期或精度已调整，请核对当前事项' WHERE "refId"=NEW.id AND "refType" LIKE 'DueReminder:%';
  IF TG_TABLE_NAME='Deadline' THEN
   UPDATE "reminder_delivery" SET status='SUPERSEDED',"lastError"='原日期或精度已调整',"updatedAt"=NOW()
    WHERE "objectType"='DEADLINE' AND "objectId"=NEW.id AND status='PENDING';
  END IF;
  INSERT INTO "AuditLog" (id,action,"targetType","targetId",detail) VALUES ('workdate_'||md5(random()::text||clock_timestamp()::text),'WORK_ITEM_DATE_CHANGED',TG_TABLE_NAME,NEW.id,change_detail);
 END IF;RETURN NEW;
END;
$$;
DROP TRIGGER "Deadline_date_change" ON "Deadline";
CREATE TRIGGER "Deadline_date_change" AFTER UPDATE OF "dueAt", "duePrecision" ON "Deadline"
 FOR EACH ROW EXECUTE FUNCTION lawlink_change_work_date();
