-- CreateEnum
CREATE TYPE "ClientFollowUpStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "ownerUserId" TEXT;

-- CreateTable
CREATE TABLE "ClientActivity" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "channel" "NoteChannel" NOT NULL,
    "content" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFollowUp" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "ClientFollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "sourceActivityId" TEXT NOT NULL,
    "resultActivityId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientActivity_clientId_occurredAt_idx" ON "ClientActivity"("clientId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientActivity_authorId_requestKey_key" ON "ClientActivity"("authorId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFollowUp_sourceActivityId_key" ON "ClientFollowUp"("sourceActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFollowUp_resultActivityId_key" ON "ClientFollowUp"("resultActivityId");

-- CreateIndex
CREATE INDEX "ClientFollowUp_clientId_status_dueAt_idx" ON "ClientFollowUp"("clientId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "ClientFollowUp_assigneeId_status_dueAt_idx" ON "ClientFollowUp"("assigneeId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Client_ownerUserId_idx" ON "Client"("ownerUserId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFollowUp" ADD CONSTRAINT "ClientFollowUp_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFollowUp" ADD CONSTRAINT "ClientFollowUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFollowUp" ADD CONSTRAINT "ClientFollowUp_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFollowUp" ADD CONSTRAINT "ClientFollowUp_sourceActivityId_fkey" FOREIGN KEY ("sourceActivityId") REFERENCES "ClientActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFollowUp" ADD CONSTRAINT "ClientFollowUp_resultActivityId_fkey" FOREIGN KEY ("resultActivityId") REFERENCES "ClientActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFollowUp" ADD CONSTRAINT "ClientFollowUp_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
