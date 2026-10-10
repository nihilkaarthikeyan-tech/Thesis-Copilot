# Trial limits: three options

Date: 2026-10-10. For the owner. Nothing in the product has changed; this page is for deciding.

**The problem.** In the side-by-side on 2026-10-10 the free trial allows 2 "section commands" a
month. One Formalise and one Simplify used both, and then proofreading was refused ("Monthly limit
reached — Section commands 2 of 2 used"). A new student reaches that in about five minutes.

**Why it happens.** Eight different things count as a "section command": the edit menu (Formalise,
Simplify, Expand and the rest, and every follow-up in the edit panel), proofreading (one count for
each 2,000 words), tone review, an equation from words or a photo, changing a citation's role,
"Suggest fix" on a comment, re-planning one section of the outline, and an examiner review of a
selection. The paid plan allows only 4 a month for all of them, so the paid plan has the same
problem, only a little later.

**How the money was worked out.** With the same code `pnpm ai:verify` uses (`computeMonthlyBudget`
in `packages/config`), offline, with no calls to OpenAI. The models are the ones in production:
`gpt-4.1-mini` for suggestions, citations and proofreading, `gpt-5-mini` for edits, chat and
drafting. "Worst case" means a student who uses every allowance in full, and it includes the ₹7.70
of hosting and one-time setup that every student carries. It reproduces today's figures: **₹39.90**
for a trial student and **₹145.62** for a paid student a month.

Two things put a limit on all of this, whichever option you choose:

- **The ₹100 hard stop.** Once a student's real spend in a calendar month reaches ₹100, every AI
  feature refuses until the 1st (`UsageService.consume`). The paid figures below are already over
  ₹100 (you accepted that on 2026-10-09), so the stop is what holds them. No trial figure here
  reaches it.
- **The 14-day trial.** The AI stops 14 days after sign-up. One catch: the trial's limits are
  counted per **calendar month**. A trial that starts on 25 October gets October's allowance and
  then November's as well. That can double a trial's AI cost, and the "if the trial crosses the
  1st" line shows it.

The "if every command were a proofread" line is a check on the model. The cost model prices a
section command as an edit on `gpt-5-mini`, about 16 paise. A 2,000-word proofread on today's
`gpt-4.1-mini` costs about 48 paise at the rates measured for proofreading. Tone review has never
been measured; going by its own output limits, it costs at most ₹1.46 a run. That line shows the
cost if every command were the dearer kind.

## What a new student uses in the first hour

From the side-by-side session (one sitting, about an hour):

| Allowance | Trial today | Used in the session | A wall in the first hour? |
|---|---|---|---|
| Assist suggestions (only kept ones count) | 50 kept | 2 | No |
| Section commands (edits, proofreading, tone…) | 2 | 2, then proofreading was refused | **Yes, within minutes** |
| Questions to your library | 5 | 2 | Not in an hour; by the second day |
| Draft sections | 2 | 1 | Not in an hour; by the second day |
| Citation suggestions (automatic citing is on by default) | 10 | not counted | Possibly, when writing many claims |
| Chapter build / examiner review / deep research | 1 / 1 / 1 | examiner review 1 | No; one try each is the point |
| Coherence check | 0 | — | Not offered on the trial |
| Finding papers, the chapter plan, the citation report | not counted against the student | used | No |

So the wall is the section commands. Questions and drafts run out next.

---

## Option A — Ten section commands (the smallest change)

Only change the numbers in `packages/config/src/plans.ts`, plus the tests and pages that print the
totals.

| Allowance | Trial: today → proposed | Paid: today → proposed |
|---|---|---|
| Section commands | 2 → **10** | 4 → **40** |
| Everything else | unchanged | unchanged |

| Worst case | Trial student / month | Paid student / month |
|---|---|---|
| Today | ₹39.90 | ₹145.62 |
| **Option A** | **₹41.16** | **₹151.26** |
| If every command were a proofread | ₹44.43 | ₹164.37 |
| If the trial crosses the 1st (two months' allowance) | ₹74.61 | — |

**First hour:** 10 edits and proofreads together. For example, 6 edits and a proofread of an
8,000-word chapter (4 runs). The wall moves from five minutes to about an afternoon. Proofreading
still uses up the same allowance as editing, so a student who proofreads a whole chapter has few
edits left.

## Option B — Proofreading gets its own allowance, and the trial covers a first week

A small build: a new "Proofreading" allowance (one run is 2,000 words), with its own price line in
the cost model, its own name on the usage screens, and a migration. The other numbers are config
only.

| Allowance | Trial: today → proposed | Paid: today → proposed |
|---|---|---|
| Section commands | 2 → **10** | 4 → **40** |
| Proofreading (new; one run = 2,000 words) | (shared) → **10** (20,000 words) | (shared) → **30** (60,000 words, a whole thesis a month) |
| Questions to your library | 5 → **10** | 15 (unchanged) |
| Citation suggestions | 10 → **20** | 30 (unchanged) |
| Draft sections | 2 → **3** | 10 (unchanged) |
| Everything else | unchanged | unchanged |

| Worst case | Trial student / month | Paid student / month |
|---|---|---|
| Today | ₹39.90 | ₹145.62 |
| Step 1 only: the config numbers, no separate proofreading yet | ₹45.39 | ₹151.26 |
| **Option B in full** (proofreading priced at ₹0.48 a run) | **₹50.23** | **₹165.79** |
| If every command were a proofread | ₹53.51 | ₹178.90 |
| If the trial crosses the 1st (two months' allowance) | ₹92.77 | — |

The trial's extra ₹10.33 over today is made up of proofreading ₹4.84, questions ₹2.43, citations
₹1.53, commands ₹1.25 and drafts ₹0.28. The paid plan's extra ₹20.17 is proofreading ₹14.53 and
commands ₹5.64. All of it is held at ₹100 by the hard stop.

**First hour:** 10 edits *and* a proofread of 20,000 words (two or three chapters), neither using
up the other. Also 10 questions, 20 citation suggestions and 3 drafted sections, which is enough
for the first week of a trial, not just the first hour. The paid plan can proofread a whole thesis
every month and still have 40 edits.

## Option C — A daily allowance through the 14 days

A larger build: the trial counts by the day, not the month (a new kind of period in the usage
ledger). One-off items stay one per trial.

| Allowance | Trial today (a month) | Proposed (each day, for 14 days) |
|---|---|---|
| Assist suggestions | 50 kept | **5 kept** a day (70 over the trial) |
| Citation suggestions | 10 | **5** a day |
| Questions to your library | 5 | **3** a day |
| Section commands (proofreading still shared) | 2 | **5** a day |
| Draft sections | 2 | **1** a day |
| Viva, chapter build, examiner review, deep research | 3 / 1 / 1 / 1 | the same, once per trial |
| Paid plan | | as Option A (40 commands); paid plans stay monthly |

| Worst case | Trial student (all 14 days) | Paid student / month |
|---|---|---|
| **Option C** | **₹86.64** | ₹151.26 |
| If every command were a proofread | ₹109.59 (held at ₹100 by the stop) | ₹164.37 |

**First hour:** *less* than today for suggestions (5 kept against 50), citations (5 against 10)
and questions (3 against 5), and more only for commands (5 against 2). A student who has a good
first hour is told to come back tomorrow. Spread over 14 days, the worst case is also nearly twice
Option B's, because every day starts fresh. It does fix the calendar-month catch on its own,
because the trial is counted from sign-up.

---

## Recommendation: Option B, in two steps

Give the trial and the paid plan more section commands now: step 1, numbers only, trial ₹45.39,
paid ₹151.26. Then give proofreading its own allowance as the next small build: trial ₹50.23,
paid ₹165.79. With it, count the trial's allowance over its 14 days rather than by calendar month,
so that a trial crossing the 1st cannot reach ₹92.77.

The wall the side-by-side hit is the section commands, and they are the cheapest strong-model
action in the product, about 16 paise each. Raising them from 2 to 10 costs a trial student at
most ₹1.25. Proofreading is not editing. A student who proofreads a chapter should not lose their
edits for doing it, and naming it separately makes the usage screen say what actually happened. A
trial at ₹50 in the worst case is half the ₹100 stop and still a fraction of what it shows the
student. The paid figure rises on paper, but the ₹100 stop still holds every account.
Option A is a sound stopgap but leaves proofreading and editing competing. Option C makes the
first hour worse, which is the opposite of the problem, and costs more.

One thing to watch: the site-wide budget in Admin, ₹2,000 a month when last set. That much covers
about 40 trial students using everything under Option B. Real use is far below the worst case,
but raise it before any campaign that brings in many students at once.

If you choose, say "Option B" (or A or C). The build then follows with an ADR, the plan table in
`packages/config/src/plans.ts`, the cost-model tests and `docs/COSTING.md` updated together.
