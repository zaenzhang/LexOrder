ALTER TABLE "Deadline" ADD COLUMN "createRequestKey" TEXT, ADD COLUMN "createRequestHash" TEXT;
CREATE UNIQUE INDEX "Deadline_createRequestKey_key" ON "Deadline"("createRequestKey");
