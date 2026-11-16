-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "createRequestHash" TEXT,
ADD COLUMN     "createRequestKey" TEXT;

-- CreateTable
CREATE TABLE "TaskWait" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "externalParty" TEXT NOT NULL,
    "expectedResult" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextCheckAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "result" TEXT,
    "createdById" TEXT NOT NULL,
    "endedById" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskWait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "prerequisiteTaskId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskWait_requestKey_key" ON "TaskWait"("requestKey");

-- CreateIndex
CREATE INDEX "TaskWait_taskId_createdAt_idx" ON "TaskWait"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskWait_endedAt_nextCheckAt_idx" ON "TaskWait"("endedAt", "nextCheckAt");

-- CreateIndex
CREATE INDEX "TaskDependency_prerequisiteTaskId_idx" ON "TaskDependency"("prerequisiteTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_taskId_prerequisiteTaskId_key" ON "TaskDependency"("taskId", "prerequisiteTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_createRequestKey_key" ON "Task"("createRequestKey");

-- AddForeignKey
ALTER TABLE "TaskWait" ADD CONSTRAINT "TaskWait_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWait" ADD CONSTRAINT "TaskWait_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWait" ADD CONSTRAINT "TaskWait_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_prerequisiteTaskId_fkey" FOREIGN KEY ("prerequisiteTaskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One open external wait belongs to one task; historical waits remain available.
CREATE UNIQUE INDEX "TaskWait_one_open_per_task" ON "TaskWait" ("taskId") WHERE "endedAt" IS NULL;
ALTER TABLE "TaskWait" ADD CONSTRAINT "TaskWait_positive_revision" CHECK ("revision" > 0);
ALTER TABLE "TaskWait" ADD CONSTRAINT "TaskWait_close_shape" CHECK (
  ("endedAt" IS NULL AND "endedById" IS NULL AND "result" IS NULL)
  OR ("endedAt" IS NOT NULL AND "endedById" IS NOT NULL AND "result" IS NOT NULL AND length(trim("result")) > 0)
);
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_not_self" CHECK ("taskId" <> "prerequisiteTaskId");

CREATE FUNCTION "protect_task_wait_history"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Task wait history cannot be deleted';
  END IF;
  IF OLD."endedAt" IS NOT NULL OR
    (to_jsonb(NEW) - ARRAY['nextCheckAt','endedAt','endedById','result','revision','updatedAt']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['nextCheckAt','endedAt','endedById','result','revision','updatedAt']) THEN
    RAISE EXCEPTION 'Task wait history cannot be overwritten';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TaskWait_history_guard" BEFORE UPDATE OR DELETE ON "TaskWait" FOR EACH ROW EXECUTE FUNCTION "protect_task_wait_history"();
