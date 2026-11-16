-- CreateTable
CREATE TABLE "TaskDependency" (
    "taskId" TEXT NOT NULL,
    "prerequisiteId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("taskId", "prerequisiteId"),
    CONSTRAINT "TaskDependency_distinct_tasks" CHECK ("taskId" <> "prerequisiteId")
);

-- CreateTable
CREATE TABLE "TaskWaiting" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "waitingFor" TEXT NOT NULL,
    "expectedResult" TEXT NOT NULL,
    "initialCheckAt" TIMESTAMP(3) NOT NULL,
    "nextCheckAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "result" TEXT,
    CONSTRAINT "TaskWaiting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskWaiting_end_result" CHECK (
      ("endedAt" IS NULL AND "endedById" IS NULL AND "result" IS NULL)
      OR ("endedAt" IS NOT NULL AND "endedById" IS NOT NULL AND "result" IS NOT NULL AND length(btrim("result")) > 0)
    )
);

CREATE INDEX "TaskDependency_prerequisiteId_idx" ON "TaskDependency"("prerequisiteId");
CREATE INDEX "TaskWaiting_taskId_startedAt_idx" ON "TaskWaiting"("taskId", "startedAt");
CREATE INDEX "TaskWaiting_endedAt_nextCheckAt_idx" ON "TaskWaiting"("endedAt", "nextCheckAt");
CREATE UNIQUE INDEX "TaskWaiting_one_open_per_task" ON "TaskWaiting"("taskId") WHERE "endedAt" IS NULL;

ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskWaiting" ADD CONSTRAINT "TaskWaiting_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskWaiting" ADD CONSTRAINT "TaskWaiting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskWaiting" ADD CONSTRAINT "TaskWaiting_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
