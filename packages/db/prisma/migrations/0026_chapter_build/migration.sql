-- ADR-0039: chapter build — a metered action of its own, the build record (the QA report), and
-- the pitfall bank.
ALTER TYPE "AiAction" ADD VALUE 'CHAPTER_BUILD';

-- CreateTable
CREATE TABLE "ChapterBuild" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "documentId" UUID NOT NULL,
    "chapterId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "profile" JSONB NOT NULL,
    "progress" JSONB,
    "plan" JSONB,
    "report" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ChapterBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pitfall" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "wrongPattern" TEXT NOT NULL,
    "pattern" TEXT,
    "detection" TEXT NOT NULL DEFAULT 'semantic',
    "correctStatement" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'blocking',
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "reportedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pitfall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChapterBuild_documentId_createdAt_idx" ON "ChapterBuild"("documentId", "createdAt");
CREATE INDEX "ChapterBuild_chapterId_idx" ON "ChapterBuild"("chapterId");
CREATE UNIQUE INDEX "Pitfall_code_key" ON "Pitfall"("code");
CREATE INDEX "Pitfall_profile_status_idx" ON "Pitfall"("profile", "status");

-- AddForeignKey
ALTER TABLE "ChapterBuild" ADD CONSTRAINT "ChapterBuild_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
