-- 2026-10-05, ADR-0085: source pins per section. '' is the whole chapter (every existing row);
-- a heading key pins one section of it.

-- AlterTable
ALTER TABLE "ChapterSourcePin" DROP CONSTRAINT "ChapterSourcePin_pkey";
ALTER TABLE "ChapterSourcePin" ADD COLUMN "section" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ChapterSourcePin" ADD CONSTRAINT "ChapterSourcePin_pkey" PRIMARY KEY ("chapterId", "sourceId", "section");
