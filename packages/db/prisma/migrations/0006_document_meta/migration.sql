-- PRD names `Document.meta` twice without a column for it: PHASES week 6 keeps the Path A
-- conversation there (`meta.proposalChat`), and Phase 3's export reads the thesis-details form
-- from it. One nullable JSON column, added now that the first reader exists.

ALTER TABLE "Document" ADD COLUMN "meta" JSONB;
