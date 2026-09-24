-- ADR-0022: the journal's 2-year mean citedness, from OpenAlex's source record.
--
-- Two nullable columns on Source: which journal (OpenAlex's source id) and its figure. Null means
-- "not known", which is different from zero and is kept different: a filter must never read a
-- journal OpenAlex has no figure for as a journal nobody cites.

ALTER TABLE "Source" ADD COLUMN "venueOpenalexId" TEXT;
ALTER TABLE "Source" ADD COLUMN "venueCitedness" DOUBLE PRECISION;
