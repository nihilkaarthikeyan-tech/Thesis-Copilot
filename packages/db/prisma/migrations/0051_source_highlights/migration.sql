-- 2026-10-09, ADR-0130: highlights and notes a student makes on a paper in the reader. One
-- student's, on one source; erased with the source, the thesis (DocumentEraser) and the account.

-- CreateTable
CREATE TABLE "SourceHighlight" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "sourceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "view" TEXT NOT NULL,
    "page" INTEGER,
    "chunkId" UUID,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "exact" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "quote" TEXT NOT NULL,
    "colour" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceHighlight_sourceId_userId_idx" ON "SourceHighlight"("sourceId", "userId");

-- CreateIndex
CREATE INDEX "SourceHighlight_userId_idx" ON "SourceHighlight"("userId");

-- AddForeignKey
ALTER TABLE "SourceHighlight" ADD CONSTRAINT "SourceHighlight_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceHighlight" ADD CONSTRAINT "SourceHighlight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
