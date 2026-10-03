-- Thesis lifecycle (2026-10-03, ADR-0043). One explicit, validated state for where a thesis is,
-- in place of inferring it from shares, comments and compliance. Every existing thesis starts in
-- DRAFTING, which is the safe default: no behaviour depends on the state until the student moves it.
CREATE TYPE "DocumentLifecycle" AS ENUM ('DRAFTING', 'IN_REVIEW', 'REVISING', 'READY', 'SUBMITTED');

ALTER TABLE "Document"
  ADD COLUMN "lifecycle" "DocumentLifecycle" NOT NULL DEFAULT 'DRAFTING',
  ADD COLUMN "submittedAt" TIMESTAMP(3);
