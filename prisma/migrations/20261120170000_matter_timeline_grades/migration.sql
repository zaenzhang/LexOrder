CREATE TYPE "TimelineEventLevel" AS ENUM ('NORMAL', 'IMPORTANT', 'KEY');

CREATE TABLE "MatterTimelineGrade" (
  "matterId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "level" "TimelineEventLevel" NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatterTimelineGrade_pkey" PRIMARY KEY ("matterId", "userId", "eventKey"),
  CONSTRAINT "MatterTimelineGrade_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MatterTimelineGrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MatterTimelineGrade_userId_idx" ON "MatterTimelineGrade"("userId");
