-- ADR-0057: a Reader share — the thesis read-only, no comments. Existing shares stay commenters.
ALTER TABLE "GuideShare" ADD COLUMN "canComment" BOOLEAN NOT NULL DEFAULT true;
