# ADR-0002 — Better Auth tables added to the schema

**Status:** Proposed — implemented in Phase 0 so sign-in can work; needs the owner's acknowledgement
(PRD §0.3 rule 4). **Date:** 2026-09-04.

## Problem

PRD §7.2 fixes the auth layer as **Better Auth** (email OTP + Google, session cookies, role claims).
PRD §8 is the canonical Prisma schema and is marked "copy verbatim". §8 defines `User` but none of
the tables Better Auth needs to function, and `User` lacks three columns Better Auth writes.

Without them, sign-in cannot work at all, so Phase 0 task 0.8 ("sign in with OTP works locally")
and every later task are blocked. The two sections of the PRD contradict each other; one has to
give.

## Evidence

The required shape was taken from Better Auth itself, not from memory. `getAuthTables()` in
`better-auth@1.7.2`, called with this project's exact configuration (email OTP plugin, Google,
and the `role` / `plan` / `timezone` additional fields), reports:

| Table | Fields Better Auth requires |
|---|---|
| `user` | `name`, `email` (unique), **`emailVerified`**, **`image`**, `createdAt`, **`updatedAt`**, + the three additional fields |
| `session` | `token` (unique), `expiresAt`, `ipAddress`, `userAgent`, `userId → user.id` (cascade), `createdAt`, `updatedAt` |
| `account` | `issuer`, `accountId`, `providerId`, `userId → user.id` (cascade), token/expiry columns, `password`, `createdAt`, `updatedAt` |
| `verification` | `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt` |

Bold = missing from PRD §8 `User`. The other three tables are absent entirely.

## Decision

Add migration `0002_better_auth` and the matching Prisma models:

- `User` gains `emailVerified`, `image`, `updatedAt` and the two relation fields. **Every column §8
  defines is unchanged.** The additions are fenced with comments in `schema.prisma`.
- New models `Session`, `Account`, `Verification`, PascalCase to match the rest of §8. Prisma exposes
  them as `prisma.session` etc., which is the lowercase model name Better Auth's Prisma adapter looks
  up, so no name mapping is configured.
- All ids default to `uuid_generate_v7()` like every other table (PRD §0.2).

## Alternatives considered

- **Keep §8 verbatim and skip persistence for auth** — Better Auth can run stateless with a JWE
  cookie cache, but the PRD wants role claims, session revocation and a Google account link, all of
  which need the `account`/`session` rows. Rejected.
- **Let Better Auth own a separate `auth_*` schema** — keeps §8 untouched on paper but splits the
  user identity across two tables and needs a sync. More moving parts (PRD §0.3 rule 6). Rejected.

## Cost / benefit

Three additive columns and three small tables. No existing column, type or relation changes. The
seed, the cap tests and the enum-parity test all still pass. Reversible with one `DROP` migration.

## What the owner should do

Either accept this ADR and add the tables to PRD §8 in the next PRD revision, or choose a different
auth approach — in which case Phase 0 task 0.8 reopens. Logged as item 12 in
`docs/CONSISTENCY_REVIEW.md`.
