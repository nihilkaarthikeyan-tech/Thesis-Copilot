-- 2026-10-04, from the Jenni study: a thumbs up or down on a suggestion, apart from whether it was
-- kept. 1 = useful, -1 = not useful, NULL = not rated.
ALTER TABLE "SuggestionEvent" ADD COLUMN "rating" SMALLINT;
