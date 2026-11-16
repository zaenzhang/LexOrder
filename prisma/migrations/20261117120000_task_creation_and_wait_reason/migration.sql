-- Preserve existing waiting and dependency records; old waits have no recorded reason.
ALTER TABLE "Task" ADD COLUMN "createRequestKey" TEXT, ADD COLUMN "createRequestHash" TEXT;
ALTER TABLE "TaskWaiting" ADD COLUMN "reason" TEXT;
CREATE UNIQUE INDEX "Task_createRequestKey_key" ON "Task"("createRequestKey");
