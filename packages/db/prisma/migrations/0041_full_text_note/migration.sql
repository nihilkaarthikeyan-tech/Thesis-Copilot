-- Jenni build plan R14 (ADR-0101): why a paper has no full text, in the library's words; cleared once one is read.
ALTER TABLE "Source" ADD COLUMN "fullTextNote" TEXT;
