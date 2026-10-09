-- 2026-10-09, ADR-0143: the whole literature review build is on. One a month on the paid plans
-- (`packages/config/src/plans.ts`), none on the trial. Deploys migrate and do not seed, so the
-- switch is turned on here; an admin can still turn it off under Admin → Settings.
UPDATE "FeatureFlag" SET "enabled" = true, "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'literatureReviewBuild';
