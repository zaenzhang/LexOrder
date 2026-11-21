CREATE TABLE "PersonalCalendarEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestKey" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "startMinute" INTEGER,
  "endMinute" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonalCalendarEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PersonalCalendarEntry_title_check" CHECK (char_length(btrim("title")) BETWEEN 1 AND 100),
  CONSTRAINT "PersonalCalendarEntry_time_check" CHECK (
    ("startMinute" IS NULL AND "endMinute" IS NULL)
    OR ("startMinute" IS NOT NULL AND "endMinute" IS NOT NULL AND
        "startMinute" >= 0 AND "endMinute" < 1440 AND "startMinute" < "endMinute")
  ),
  CONSTRAINT "PersonalCalendarEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PersonalCalendarEntry_userId_requestKey_key" ON "PersonalCalendarEntry"("userId", "requestKey");
CREATE INDEX "PersonalCalendarEntry_userId_day_idx" ON "PersonalCalendarEntry"("userId", "day");
