-- 2026-10-09, Jenni build plan R30/R32 (ADR-0132): a research question asked with no thesis.
--
-- A chat on the thesis list, before or outside any thesis. It answers from the abstracts a
-- scholarly search returns (ADR-0060's path) and belongs to the student, not to a thesis, so it
-- is its own table rather than a "ChatThread" with no document: every query on "ChatThread"
-- reaches the owner through its thesis, and none of them changes. Erased with the account
-- (DeletionService) and with the user row.

-- CreateTable
CREATE TABLE "ResearchChat" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "questions" INTEGER NOT NULL DEFAULT 0,
    "turns" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchChat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchChat_userId_updatedAt_idx" ON "ResearchChat"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "ResearchChat" ADD CONSTRAINT "ResearchChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
