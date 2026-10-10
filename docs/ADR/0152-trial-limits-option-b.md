# ADR-0152: Trial limits, Option B

Date: 2026-10-10 · Status: accepted (the owner chose Option B, in full, on 2026-10-10)

## Context

In the side-by-side session on 2026-10-10 the free trial's two section commands were used by one
Formalise and one Simplify, and proofreading was then refused ("Section commands 2 of 2 used"),
about five minutes into a first session. Proofreading, tone review, equations, citation roles,
"Suggest fix", per-section re-planning and selection reviews all drew on the same allowance, and
the paid plan's four a month had the same wall a little later. `docs/TRIAL-LIMIT-OPTIONS.md` set
out three options priced with the `pnpm ai:verify` cost model; the owner chose Option B.

The options page also found a catch in ADR-0036's trial: its allowances were counted per calendar
month, so a trial that started on 25 October got October's allowance and November's as well.

## Decision

1. **Numbers** (`packages/config/src/plans.ts`). Trial: section commands 2 → 10, questions to the
   library 5 → 10, citation suggestions 10 → 20, drafted sections 2 → 3. Paid and institution
   plans: section commands 4 → 40. Everything else unchanged.
2. **Proofreading is its own metered action, `PROOFREAD`** (enum value in migration 0057). One
   unit is one run of up to 2,000 words (`PROOFREAD.maxWords`, `PROOFREAD_WORDS_PER_UNIT`): 10 on
   the trial, 30 a month on the paid plans. `POST /proofread` consumes, refunds and logs
   `PROOFREAD` and no longer touches `COMMAND`. The cap check and the increment are still the one
   atomic `INSERT … ON CONFLICT … DO UPDATE … WHERE` in `UsageService.consume`, before any
   provider call. The cost model prices a run on the fast tier at the tokens per word measured for
   proofreading (5,040 in, 2,220 out): ₹0.4844 on `gpt-4.1-mini`. The proofreading pass inside a
   chapter build stays part of `CHAPTER_BUILD`. The AI use statement (ADR-0148) no longer takes
   new runs' calls out of the edit count, because they are not in it; their audit mark says
   `action: 'PROOFREAD'`.
3. **The trial counts once over the whole trial.** `User.trialStartsAt` (migration 0057, default
   `now()`). A `FREE_TRIAL` account with trial dates counts every metered action on the ledger
   row of the month its trial started (`ledgerPeriodFor`), from the start to `trialEndsAt`; after
   the end the allowance is 0, as ADR-0036 has it. Paid plans count by the calendar month. The
   ledger key stays a `YYYY-MM` string, so no table changes shape and every existing reader of a
   paid account's row is unchanged; a trial that starts in the current month has the same key it
   always had. Refunds (API and worker), kept suggestions (`keep`), an admin's extra allowance,
   an admin's reset and the admin's usage view all find the trial's row the same way
   (`ledgerPeriodSql` for the statements that find it themselves).
4. **What the student is told.** A trial's cap refusal is titled "Trial limit reached", says
   "{allowance}: {used} of {cap} used in your free trial" and that the trial's allowances are for
   the whole trial and end on its date rather than starting again on the 1st (English and Hindi;
   `trialAllowance` and `trialEndsAt` on the problem, `resetsAt` set to the trial's end). The
   usage menu says "Your free trial" and "For the whole trial, which ends …"; the Account page
   says the same; the pricing and help pages say the trial's numbers are for the whole trial.
   "Proofreading runs" is listed as its own allowance everywhere the others are.
5. **The ₹100 runtime stop is unchanged.** It is still per calendar month on real logged spend.

## Migration 0057

Adds the enum value and `trialStartsAt`. Existing accounts get `GREATEST(createdAt, trialEndsAt -
14 days)`; an account with no trial end gets none. A trial running at release that started in an
earlier month has its later months' counts added to the start month's row (nothing deleted), so
it goes on from what it really used; accounts with a subscription row are left alone.

## Cost

At the production configuration (`gpt-4.1-mini` fast, `gpt-5-mini` strong), every allowance used
in full: trial **₹39.90 → ₹50.23** (proofreading ₹4.84, questions ₹2.43, citations ₹1.53,
commands ₹1.25, drafts ₹0.28), paid **₹145.62 → ₹165.79** (proofreading ₹14.53, commands ₹5.64).
With `gpt-5-nano` on the fast tier the paid figure is ₹104.93. The PRD's six-row table at its
reference prices goes from ₹99.17 to ₹149.92 (forty commands at §11.2's ₹1.41); the self-check
now asserts that it is inside the ₹175 projection limit, as the production budget has been since
ADR-0143, rather than inside ₹100. A trial that crosses the 1st can no longer reach the ₹92.77 the
options page showed. `docs/COSTING.md` has the table.

## Consequences

- An admin extending a trial moves its end, not its start, so the extension gives time on the
  same allowance; more units are an extra allowance, as before.
- A trial account that upgrades in the month its trial started shares that month's row with the
  paid plan, as it always did.
- An account whose trial an admin had already extended reads a later `trialStartsAt` from the
  backfill than it really had; at worst its trial counts from a later month.
- The admin's user list reads each user's latest 60 ledger rows and picks the one the account
  counts on, instead of filtering by this month in the query.
