-- 2026-10-04, from the Jenni study (coverage-map row 26), ADR-0058: the language of a citation
-- style's terms and dates. Null keeps every existing thesis rendering exactly as before.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "citationLocale" TEXT;
