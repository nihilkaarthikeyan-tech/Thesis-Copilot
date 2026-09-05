-- ADR-0002 addendum: `Verification.id` must be text, not uuid.
--
-- Better Auth's `reserveVerificationValue` (better-auth 1.7.2, db/internal-adapter.mjs) inserts a
-- verification row with `forceAllowId: true` and an id it generates itself, which is not a UUID.
-- `forceAllowId` deliberately bypasses our `advanced.database.generateId: false` setting, so there
-- is no configuration that avoids it.
--
-- The path runs from `revokeUnprovenAccountAccess`, which fires when an existing user who has
-- never verified their email signs in. That is exactly a seeded or invited account: the SUPERADMIN
-- from `pnpm db:seed` could not sign in at all, answering 500 on every attempt.
--
-- The column keeps a UUID-shaped default so rows Better Auth inserts without an id are unchanged.

ALTER TABLE "Verification" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "Verification" ALTER COLUMN "id" TYPE text USING "id"::text;
ALTER TABLE "Verification" ALTER COLUMN "id" SET DEFAULT uuid_generate_v7()::text;
