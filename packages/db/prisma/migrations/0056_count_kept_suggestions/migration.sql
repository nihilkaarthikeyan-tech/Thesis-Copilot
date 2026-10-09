-- 2026-10-09, ADR-0144 (D1, fix list 37): Assist's allowance counts only the suggestions a
-- student keeps. `UsageLedger.count` stays the number of calls (refused at three times the
-- allowance, in the same atomic statement as before); `kept` is the number kept, refused at the
-- allowance. `SuggestionEvent.countedAt` marks a suggestion counted, so it is counted once.

-- AlterTable
ALTER TABLE "UsageLedger" ADD COLUMN "kept" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SuggestionEvent" ADD COLUMN "countedAt" TIMESTAMP(3);

-- This month's suggestions already accepted count as kept from the start, so no student's
-- allowance jumps back up on the day this ships.
WITH kept AS (
  SELECT "userId", to_char("createdAt", 'YYYY-MM') AS period, count(*)::int AS n
  FROM "SuggestionEvent"
  WHERE "action" = 'ASSIST'
    AND "outcome" IN ('ACCEPTED', 'PARTIAL')
    AND "keptChars" > 0
    AND "createdAt" >= date_trunc('month', now() AT TIME ZONE 'UTC')
  GROUP BY 1, 2
)
UPDATE "UsageLedger" l SET "kept" = kept.n
FROM kept
WHERE l."userId" = kept."userId" AND l."period" = kept.period AND l."action" = 'ASSIST';

UPDATE "SuggestionEvent" SET "countedAt" = "createdAt"
WHERE "action" = 'ASSIST'
  AND "outcome" IN ('ACCEPTED', 'PARTIAL')
  AND "keptChars" > 0
  AND "createdAt" >= date_trunc('month', now() AT TIME ZONE 'UTC');
