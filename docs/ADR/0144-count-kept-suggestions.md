# 0144 — Assist counts only the suggestions a student keeps

Date: 2026-10-09
Status: accepted (the owner delegated the decision on 2026-10-09)
Closes: Jenni build plan D1, fix list 37 ("Every suggestion shown counts against the allowance
(dismissed too); Jenni counts only accepted")
Builds on: PRD §10.2 / §11.5 (cap check and increment in one atomic statement, before any
provider call), ADR-0035 (an admin's extra allowance), ADR-0143 (the projection may exceed ₹100)

## Context

Every Assist suggestion the editor fetched took one unit of the monthly allowance (180 paid, 50
trial) before the provider was called, whether the student kept it, dismissed it, or typed past it.
Jenni counts only what is accepted. The obstacle was the hard rule: the cap is checked and taken in
one atomic statement before any provider call, and whether a suggestion is kept is only known
after it is shown. A refund on dismissal would need every dismissal reported (a closed tab, a
typed-over ghost and a lost network all report nothing), so an allowance built on refunds would
still count most of what was never kept.

## Decision

Count in the other direction: **the allowance counts suggestions kept; the calls have a ceiling of
their own.** Both are checked by the same single statement, before the provider is called.

- **Two numbers on one ledger row.** `UsageLedger.count` stays the number of Assist calls this
  month; the new `UsageLedger.kept` is the number of suggestions kept (migration 0056).
- **The atomic statement checks both.** In `UsageService.consume`, for an action listed in
  `CALLS_PER_KEPT` (`packages/config/src/plans.ts`; today only `ASSIST: 3`), the `ON CONFLICT … DO
  UPDATE SET count = count + 1` now has
  `WHERE count < (allowance + bonus) × 3 AND kept < allowance + bonus`, on the row the statement has
  locked. So the student can keep at most the allowance, and the product makes at most three calls
  per unit of it: **540 calls a month on a paid plan, 150 on the trial**. Every other action passes
  a multiple of 1 and no kept check — the statement is unchanged for it. An admin's extra
  allowance raises both.
- **Keeping is counted once, in one statement.** `POST /assist/outcome` with `ACCEPTED` or
  `PARTIAL` and `keptChars > 0` calls `UsageService.keep`: a single SQL statement marks the
  `SuggestionEvent` counted (`countedAt`, new) only if it was not, and adds one to `kept` on the
  ledger row of the month the suggestion was shown only if that mark was made. A repeated or
  racing report counts nothing more; another student's suggestion, or a Draft or chapter-build
  event, counts nothing. Keeping is never refused — the text is already in the thesis — so a
  student with several suggestions on screen at the last unit can keep each of them; the money is
  bounded by the call ceiling, not by this.
- **Refunds are unchanged.** An empty answer, a provider error or "Cite from my library" with
  nothing of the student's gives back a call (`count − 1`), never a kept suggestion.
- **Why three.** Published autocomplete acceptance rates are around 25–35%, so a student who keeps
  one suggestion in three gets the whole allowance; a student who keeps fewer reaches the call
  ceiling first and is told so in its own words. The dev database's 9% (200 kept of 2,254 shown)
  is mostly end-to-end runs that reject on purpose, not students. The multiple is one constant;
  production's real rate (`pnpm pilot:report` counts outcomes) is what to tune it against.
- **What the student sees.** `GET /usage/me` reports Assist's `used` as the suggestions kept, with
  `countsKept`, `calls` and `callCeiling` beside it; the usage menu adds "Only the ones you keep
  count." At the allowance the refusal is the usual one ("You have used all 180 of this month's
  assist suggestions"); at the call ceiling it is `CAP_EXCEEDED` with `callCeiling` and says "you
  asked for 540 this month, the most one month allows. You kept 40 of your 180." (English and
  Hindi, `limit.cap.callCeiling`). The admin's "reset caps" zeroes both numbers.
- **No jump on the day it ships.** Migration 0056 sets this month's `kept` from the suggestions
  already accepted, and marks them counted; the old `count` stays the calls.

## Cost

The budget (`computeMonthlyBudget`) now prices Assist at its call ceiling, not the allowance: 540
calls on a paid plan, 150 on the trial (`callCeilings: false` reproduces the PRD's own §11.4 table,
which prints one call per unit). A fully active student, `pnpm ai:verify`'s table:

| | fast `gpt-4.1-mini` (production) | fast `gpt-5-nano` |
|---|---|---|
| Before both changes | ₹94.55 | ₹75.43 |
| After ADR-0143 (one literature review) | ₹111.94 | ₹92.81 |
| **After this ADR** (Assist line 180 → 540 calls, ₹16.84 → ₹50.51) | **₹145.62** | ₹96.32 |
| Free trial: before → after (Assist 50 → 150 calls) | ₹30.55 → **₹39.90** | ₹25.01 → ₹25.98 |

At production's fast tier that is **₹45.62 over the ₹100 ceiling** with every call ceiling used
in full, within the ₹175 projection limit ADR-0143 set. With the notes in `docs/COSTING.md` that
sit outside the table — and ADR-0082's rewording, which is a second call on about one suggestion
in six and so grows with the calls (≤ ₹0.46 → ≤ ₹1.38) — the all-in bound is **≤ ₹148.73**.

The runtime stop is what holds: `UsageService.consume` refuses every metered call once a student's
real logged spend this month reaches ₹100, so a student who asks for all 540 suggestions *and*
uses every other allowance is stopped at ₹100, not billed ₹145. A student who uses only Assist
costs at most 540 × ₹0.0935 = ₹50.51 in Assist calls.

## Not done

- Only Assist counts kept. Citation suggestions and the edit panel's applied edits (the D1 line's
  "applied edits") still count calls; adding one is a row in `CALLS_PER_KEPT` plus a `keep` call
  where the student applies it.
- The editor's own counter line was not changed: it reads `/usage/me`, which now reports kept.
- Not checked in a browser in this change; the Playwright editor spec's "Assist 0/" before and
  "Assist 1/" after a Tab still describe the new behaviour (the counter moves on keeping).

## Addendum (2026-10-09, after the v0.1.38 Playwright run)

The release's mock-stack run failed two specs on this change; nothing was deployed.

- **The meter read before the keep was recorded.** The editor fired `/assist/outcome` and
  refetched `/usage/me` at the same moment, so after a Tab the meter still showed the count from
  before the keep ("Assist 0/50"). It now refetches when the outcome call has answered.
- **One word, then typing past the rest, was reported as REJECTED** (with the kept characters),
  so a suggestion partly kept with "One word" never counted. The editor now reports it as
  PARTIAL, and the API counts any report with kept characters, whatever it is called.
- **`e2e/states.spec.ts`'s cap test** dismissed fifty suggestions to reach the cap; dismissals no
  longer count. It now dismisses one (the meter stays at 0), keeps fifty with Tab, and asks for the
  fifty-first: the same reset-date message. To keep fifty in a row the mock writes a new sentence
  once its own paragraph is already before the cursor (`mockSuggestionFor`; a unit test runs fifty
  through A.1's filters). A new test serves the API's call-ceiling refusal to the editor and checks
  its message; 150 real calls would trip §12.1's burst guard first.

## Evidence

`apps/api/test/cap-concurrency.spec.ts` (real Postgres, every migration): 20 parallel calls at the
call ceiling − 1 let exactly one through; a call not kept leaves the allowance untouched; a kept
suggestion counts once however often (and however concurrently) it is reported; nothing counts for
another student's suggestion or a Draft event; at the allowance kept the statement refuses with
calls to spare and changes nothing; at the call ceiling it refuses with `callCeiling` and the
message; parallel calls at kept − 1 all pass (keeping is what moves the allowance); an admin's
extra allowance raises both; a refund gives back a call, never a kept suggestion.
`apps/api/test/week1.spec.ts` (real HTTP): the outcome route counts a kept suggestion once and
`/usage/me` reports it; `/assist/suggest` is a 429 with no provider call at the kept allowance and
again at the call ceiling. `apps/web/test/limit.spec.ts`: the call-ceiling message.
`packages/config/test/cost-model.spec.ts`: Assist priced at 3 × the allowance on every plan, the
PRD table at 1 ×, the totals above.
