-- 2026-10-10, ADR-0152 (trial limits, Option B): proofreading gets its own metered action, and the
-- free trial's allowances count once over the 14-day trial instead of once per calendar month.

-- AlterEnum
ALTER TYPE "AiAction" ADD VALUE 'PROOFREAD';

-- AlterTable: when the trial started. New accounts get the moment they are created.
ALTER TABLE "User" ADD COLUMN "trialStartsAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- Existing accounts: fourteen days before the trial's end, but never before the account existed
-- (migration 0024 gave the accounts that predate the trial an end 14 days after that release). An
-- account whose trial an admin extended reads a later start than it had; it only means that
-- account's trial is counted from a later month, never that anyone loses an allowance.
UPDATE "User"
SET "trialStartsAt" = GREATEST("createdAt", "trialEndsAt" - INTERVAL '14 days')
WHERE "trialEndsAt" IS NOT NULL;
UPDATE "User" SET "trialStartsAt" = NULL WHERE "trialEndsAt" IS NULL;

-- A trial running now that started in an earlier month has counted this month on a new row. The
-- trial's row is the month it started, so this month's counts are added to it, and the trial goes
-- on from the total it really used. The later rows are left as they were (nothing is deleted).
-- Accounts with a subscription row are paid or were, and count by the month: left alone.
INSERT INTO "UsageLedger" ("id", "userId", "period", "action", "count", "bonus", "kept")
SELECT uuid_generate_v7(), l."userId", to_char(u."trialStartsAt", 'YYYY-MM'), l."action",
       SUM(l."count"), SUM(l."bonus"), SUM(l."kept")
FROM "UsageLedger" l
JOIN "User" u ON u."id" = l."userId"
WHERE u."plan" = 'FREE_TRIAL'
  AND u."trialStartsAt" IS NOT NULL
  AND u."trialEndsAt" > CURRENT_TIMESTAMP
  AND NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."userId" = u."id")
  AND l."period" > to_char(u."trialStartsAt", 'YYYY-MM')
  AND l."period" <= to_char(u."trialEndsAt", 'YYYY-MM')
GROUP BY l."userId", to_char(u."trialStartsAt", 'YYYY-MM'), l."action"
ON CONFLICT ("userId", "period", "action") DO UPDATE
SET "count" = "UsageLedger"."count" + EXCLUDED."count",
    "bonus" = "UsageLedger"."bonus" + EXCLUDED."bonus",
    "kept" = "UsageLedger"."kept" + EXCLUDED."kept";
