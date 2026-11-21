CREATE TABLE "TaskMaterialReview" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestKey" UUID NOT NULL,
    "taskRevision" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskMaterialReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskMaterialReview_content_check" CHECK (char_length(btrim("content")) BETWEEN 1 AND 2000),
    CONSTRAINT "TaskMaterialReview_revision_check" CHECK ("taskRevision" >= 0)
);

CREATE TABLE "TaskMaterialReviewSource" (
    "reviewId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "page" INTEGER,
    "position" INTEGER NOT NULL,
    CONSTRAINT "TaskMaterialReviewSource_pkey" PRIMARY KEY ("reviewId", "documentId"),
    CONSTRAINT "TaskMaterialReviewSource_sha_check" CHECK ("documentSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "TaskMaterialReviewSource_page_check" CHECK ("page" BETWEEN 1 AND 10000),
    CONSTRAINT "TaskMaterialReviewSource_position_check" CHECK ("position" >= 0 AND "position" < 50)
);

CREATE UNIQUE INDEX "TaskMaterialReview_authorId_requestKey_key" ON "TaskMaterialReview"("authorId", "requestKey");
CREATE INDEX "TaskMaterialReview_taskId_createdAt_id_idx" ON "TaskMaterialReview"("taskId", "createdAt", "id");
CREATE UNIQUE INDEX "TaskMaterialReviewSource_reviewId_position_key" ON "TaskMaterialReviewSource"("reviewId", "position");

ALTER TABLE "TaskMaterialReview" ADD CONSTRAINT "TaskMaterialReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskMaterialReview" ADD CONSTRAINT "TaskMaterialReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskMaterialReviewSource" ADD CONSTRAINT "TaskMaterialReviewSource_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "TaskMaterialReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
