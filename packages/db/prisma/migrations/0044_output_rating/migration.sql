-- 2026-10-08, Jenni build plan R36 (ADR-0115): "How was this?" — a student's thumbs (1 / -1) on a
-- generated run (a chapter build by its id, a viva question set by its setId), with an optional
-- one-line note. One row per person per run; the row goes with its thesis.

CREATE TABLE "OutputRating" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "documentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "runId" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutputRating_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutputRating_kind_runId_userId_key" ON "OutputRating"("kind", "runId", "userId");

CREATE INDEX "OutputRating_documentId_idx" ON "OutputRating"("documentId");

CREATE INDEX "OutputRating_updatedAt_idx" ON "OutputRating"("updatedAt");

ALTER TABLE "OutputRating" ADD CONSTRAINT "OutputRating_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
