# API audit — the eight rules

Audited 2026-09-12 against the code, endpoint by endpoint, not from memory. Two of the eight were
genuinely weak and are fixed in the same commit; the other six were already in place and the
evidence is below so the claim can be checked rather than believed.

| | Rule | Before | Now |
|---|---|---|---|
| 1 | Version everything | ✅ | ✅ |
| 2 | Use idempotency | ⚠️ **raceable on payments** | ✅ fixed |
| 3 | Validate inputs | ✅ | ✅ |
| 4 | Return meaningful errors | ✅ | ✅ |
| 5 | Paginate large datasets | ❌ **missing where it mattered** | ✅ fixed |
| 6 | Rate limit requests | ✅ | ✅ |
| 7 | Log every request | ✅ | ✅ |
| 8 | Never trust the client | ✅ | ✅ |

---

## The two that were wrong

### 2. Idempotency — the billing webhook could be applied twice

**What was there.** `BillingService.applyEvent` deduplicated by reading `AuditEvent` for a matching
event id and returning early if it found one. Its own comment claimed *"the row is written first,
and a duplicate event fails the unique constraint"* — there was no unique constraint, and the row
was written **last**.

**Why that is a money bug.** Razorpay retries until it gets a 2xx, so a slow first attempt
overlapping its own retry is the ordinary case. Both requests read, neither found a marker, both
proceeded, and the subscription's `currentPeriodEnd` was pushed forward twice — a free month per
race.

**The fix.** `AuditEvent.dedupeKey`, unique (migration `0011`). The marker and the subscription
change now go in one transaction with the marker **first**, so a concurrent duplicate loses on the
constraint and nothing after it runs. A `P2002` is caught and answered as `duplicate` with a 200,
because a duplicate is a correct outcome and a non-2xx would make Razorpay retry an event that has
already been applied. In a transaction rather than written up front alone, so a failed update rolls
the marker back with it and a genuine retry still applies.

Worth recording: the idempotency key is **synthesised** —
`subscriptionId:eventName:periodStart` — because Razorpay has no per-delivery event id in every API
version. That is a better key than a delivery id: two deliveries of one charge collapse, and a
genuinely new billing period does not.

Covered by `apps/api/test/billing-webhook.spec.ts`: two identical webhooks fired concurrently, with
assertions that exactly one applied, both returned 200, the period moved once, and exactly one
marker row exists.

**Elsewhere idempotency was already right.** Every BullMQ job is keyed on what it will read rather
than what it will write (`jobKeyDigest`), which is what stops a retry re-indexing a source.

### 5. Pagination — the one list that grows with the platform

Of 47 `findMany` calls, 44 had no `take`. Most of those are correct: exporting a thesis, running a
coherence pass or importing a `.docx` must read every row, and bounding them would produce a wrong
answer rather than a fast one. They are bounded by one student's work, and by the plan's own limits
(60 PDFs, 500 pages).

One was not. `GET /admin/users` read **every user on the platform**, plus three platform-wide
`groupBy` aggregates, on every visit.

Worse, `UsersService.get(userId)` called `list()` and then picked one row out of it — so answering
a question about one student read every student and all three aggregates.

**The fix.** `list()` takes `limit` (default 50, max 200) and `offset`, returns
`{ rows, total, limit, offset }`, and scopes its aggregates to the page's user ids with
`where: { userId: { in: ids } }`. `get()` queries the one user directly. The admin screen shows
"Showing the 50 newest of N students".

Ordering moved from last-activity to `createdAt desc`, deliberately: activity is derived from
aggregates over two other tables and cannot be a database sort key without denormalising it, and
ordering a *page* by something the database did not order by shows a different set of users
depending on which page you are on. Activity is still a column; it is no longer the sort.

---

## The six that were already right

**1. Version everything.** `app.setGlobalPrefix('api/v1')` in `main.ts`, with `/metrics` excluded
so Prometheus scrapes an unversioned path. Every route in §9 is under `/api/v1`.

**3. Validate inputs.** Zod at the edge of every controller — the request never reaches a service
as an untyped object. Query strings are coerced and bounded, not trusted (`usersQuery` is the
newest example). `packages/config` validates the environment at boot and the process refuses to
start on a missing variable.

**4. Return meaningful errors.** RFC 9457 problem details throughout (`apps/api/src/common/errors.ts`),
with a stable `type` slug the web app switches on rather than parsing prose. Typed classes:
`ValidationError`, `NotFoundError`, `CapExceededError`, `CeilingExceededError`,
`UnauthorizedError`. `CeilingExceededError` exists precisely because reusing the cap error would
have told a student "you have used all 180" when they had 40 left.

**6. Rate limit requests.** `apps/api/src/common/rate-limit.ts`, hand-written after
`@fastify/rate-limit`'s `createRateLimit` was found to build a broken key and refuse every request.
§12.1's limits: 20 sign-in attempts per minute per IP, 60 AI requests per minute per user.

**7. Log every request.** `nestjs-pino` with a request id on each line, plus `AiCallLog` for every
model call (tokens, cost, latency, ok/error) and `AuditEvent` for the things no other table records.

**8. Never trust the client.** §12.1: every document, chapter and source query is scoped by
`ownerId` or an active `GuideShare` — 28 call sites — and an object the caller may not see is
reported absent rather than forbidden, so the API does not confirm it exists. `SuperadminGuard` on
admin routes. The webhook verifies its HMAC signature before the body is parsed. Prototype-pollution
keys are stripped from anything that reaches a JSON column (`stripUnsafeKeys`).

---

## What this audit did not cover

Load. Every number here is about correctness, not throughput: PHASES 5.7's k6 run against the VPS
is what tests the second, and it is still on `docs/PENDING.md` because it needs a server.
