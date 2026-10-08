-- 2026-10-08, Jenni build plan R29 (ADR-0114): archive a thesis. Set while it is archived (off the
-- student's list, nothing deleted); null for every thesis on the list, which is every existing row.

ALTER TABLE "Document" ADD COLUMN "archivedAt" TIMESTAMP(3);
