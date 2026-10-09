# 0143 — The literature review build is on: one a month on the paid plans

Date: 2026-10-09
Status: accepted (the owner delegated the decision on 2026-10-09)
Builds on: ADR-0124 (the literature review build, behind an off flag at a cap of 0), ADR-0039
(chapter build), ADR-0035 (an admin's extra allowance)

## Context

ADR-0124 built the whole literature review from one press and left two things to the owner: the
allowance and the switch. It priced a build at ₹12.92 (twenty sections at the chapter build's
per-section shape) and showed that one a month took the production worst case from ₹94.55 to
₹106.05 — over the ₹100 ceiling unless something else gave way.

On 2026-10-09 the owner said: "I don't care about the cost; my aim is that the production cost of 1
user is ₹100 per month — even if it's higher, no issue, just tell me the amount — and please do the
things as you wish."

## Decision

- **One literature review a month on the paid plans** (`STUDENT_MONTHLY`, `STUDENT_ANNUAL`,
  `INSTITUTION_SEAT`), **none on the free trial**. A thesis has one literature review chapter, so
  one a month is a full rewrite every month; the chapter build (3 a month) still writes it section
  by section. The trial already has one chapter build to show what a build does; a review is twenty
  sections — up to a sixth of the ceiling in one press — for an account that may never pay. An
  admin's extra allowance (ADR-0035) still adds more, on any plan.
- **The flag is on.** Migration 0055 sets `literatureReviewBuild` on (deploys migrate; they do not
  seed), and the seed creates it on. An admin can still turn it off under Admin → Settings. Since a
  plan now includes it, `offeredOnSomePlan('LIT_REVIEW_BUILD')` is true, so the pricing page, help
  page and usage list show it — on the trial as "not in your plan", as coherence checks are.
- **Repriced from a real run.** The first real review (below) cost ₹8.63 for ten sections — ₹0.86
  a section against the profile's ₹0.65 — because the reasoning model wrote more than the profile
  allowed (about 930 tokens a draft, 1,540 an examiner reading, 970 a fix), nothing was served from
  the prompt cache, and every section of a ten-section review was fixed. The `LIT_REVIEW_BUILD`
  profile now takes the larger of the old shape and the measurement for each part: twenty drafts
  (6,000 in, 930 out), twenty examiner readings (5,500 in, 1,540 out), ten fixes (3,250 in, 970
  out), the fast-tier calls doubled from the measured ₹0.48 to ₹0.96, and the 4,000-token cached
  block once per call. **₹17.39 a build** (was ₹12.92), and never less than twice the measured ten
  sections (a test holds it there). The chapter build's own profile (₹9.04) was not changed: its
  two latest real builds cost ₹8.13 and ₹8.36 for fourteen sections.
- **The projection may now exceed ₹100.** `computeMonthlyBudget` still reports `withinCeiling`
  against ₹100, and `pnpm ai:verify` prints the over-₹100 figure plainly. What it now fails on is
  `PROJECTION_LIMIT_INR` (₹175): a bound well above the figure the owner accepted, so a runaway
  configuration — a price rise, a wrong model id, a cap typed ten times too large — still fails
  `pnpm ai:verify` and CI (`cost-model.spec.ts` keeps a test for it).
- **The runtime stop is unchanged.** `UsageService.consume` sums the student's real logged spend
  this month before every metered call and refuses at ₹100 (`MONTHLY_CEILING_INR`). So no student
  actually costs more than ₹100 plus the one call that crosses the line. A projection above ₹100
  only means that a student who used every allowance in full, at every unit's priced ceiling,
  would be stopped before reaching the end of them. A literature review started below ₹100 runs to
  the end: the build is one unit, taken before the job, and the worker does not re-check the
  ceiling between sections, so a review started at ₹99 can end near ₹116.

## Cost

`pnpm ai:verify`'s table, a fully active `STUDENT_MONTHLY` student, `gpt-5-mini` on the strong
tier:

| | fast tier `gpt-4.1-mini` (production) | fast tier `gpt-5-nano` |
|---|---|---|
| Before (ADR-0131) | ₹94.55 | ₹75.43 |
| + one literature review a month (₹17.39) | **₹111.94 — over ₹100 by ₹11.94** | ₹92.81 |
| Free trial (unchanged, 0 reviews) | ₹30.55 | ₹25.01 |

With the notes in `docs/COSTING.md` that sit outside the table (research embedding, ADR-0133's
literature search on an edit), the all-in bound goes from ≤ ₹96.74 to **≤ ₹114.13**.
ADR-0144 (counting only kept suggestions) raises it again; `docs/COSTING.md` has the total.

## The real run (2026-10-09)

Against the local dev stack (`api-real` on :3001 and the real worker, `gpt-5-mini` strong,
`gpt-4.1-mini` fast), on an existing dev thesis — "Barriers to rooftop solar adoption among rural
households" (19 papers, 360 indexed passages), its "Literature Review" chapter with five outline
themes. Planned and started through the real HTTP routes, with one admin-style extra unit (the
running API still had the old cap of 0).

| | |
|---|---|
| Sections | 10 (introduction, five themes, framework, gap analysis, link to the objectives, summary) |
| Calls | 40: 30 on `gpt-5-mini` (103,921 in, 0 cached, 33,822 out), 10 on `gpt-4.1-mini` |
| Real cost | **₹8.63** (₹8.15 strong, ₹0.48 fast); no source search was needed (no `EMBED` row) |
| Time | **4 min 41 s** queued to delivered (drafting 1.5 min, examining 2 min, fixing 1.2 min) |
| Output | 3,421 words, 67 citations, 12 sentences fixed, 10 pending drafts; 15 blocking and 35 warning issues left open in the QA report for the student |

It ran well inside the ₹30 budget for real calls. The QA report's open issues are the examiner's
flags for the student to decide (flag, don't fix); the run measured cost and time, not quality.

## Not done

- A twenty-section review has not been run; ₹17.39 is the measured ten-section run scaled with
  the fixes capped at ten, not a measurement.
- No browser check of the build screen with the flag on in this change (the screen is ADR-0124's,
  unchanged).

## Evidence

`packages/config/test/cost-model.spec.ts`: the paid plans' cap is 1 and the trial's 0; the unit
is ₹17.3878 and at least twice the measured ten sections; the production total is ₹111.94 before
ADR-0144, over ₹100 and inside the projection limit; ten-times prices still fail the limit.
`apps/api/test/lit-review-build.spec.ts` (7, real HTTP, Postgres and Redis): the flag is on after
the migrations; turned off it is refused for nothing; on the trial the start is a 429 with no unit
and no job; on a paid plan the first review takes exactly one unit and queues
`lit-review-build__<id>`, and a second in the same month is a 429 before any job ("You have used
all 1 of this month's literature review builds"); an admin's extra unit still works.
