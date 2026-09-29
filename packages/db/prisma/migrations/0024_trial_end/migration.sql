-- The free trial ends (2026-09-29, ADR-0036).
--
-- Adding the column with its default gives every existing account now() + 14 days: accounts whose
-- 14 days had already passed are not cut off the day this ships. Accounts still inside their
-- first 14 days keep the real date, sign-up + 14 days.
ALTER TABLE "User" ADD COLUMN "trialEndsAt" TIMESTAMP(3) DEFAULT (now() + '14 days'::interval);

UPDATE "User"
SET "trialEndsAt" = "createdAt" + interval '14 days'
WHERE "createdAt" + interval '14 days' > now();
