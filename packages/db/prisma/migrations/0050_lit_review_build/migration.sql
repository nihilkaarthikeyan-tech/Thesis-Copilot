-- 2026-10-08, ADR-0124 (R37): the whole literature review from one press. A metered action of
-- its own (cap 0 on every plan until the owner sets one), the kind of a build row (the review
-- reuses the chapter build's record and QA report), and the switch that shows it, off.

-- AlterEnum
ALTER TYPE "AiAction" ADD VALUE 'LIT_REVIEW_BUILD';

-- AlterTable
ALTER TABLE "ChapterBuild" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CHAPTER';

-- The flag row, off, so Admin → Settings can turn it on (deploys migrate; they do not seed).
INSERT INTO "FeatureFlag" ("key", "enabled", "updatedAt")
VALUES ('literatureReviewBuild', false, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
