-- Papers the system adds on its own when the library has nothing on the section being written
-- (2026-09-30, ADR-0037).
ALTER TABLE "Source" ADD COLUMN "autoAddedAt" TIMESTAMP(3);
