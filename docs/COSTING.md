# What one student costs us, what we charge, what is left

Recomputed 2026-09-13 against the models actually configured: `gpt-5-nano` on the fast tier,
`gpt-5-mini` on the strong tier, `voyage-4` for embeddings (ADR-0011, ADR-0032).

> **2026-09-25 — viva preparation (ADR-0030).** A seventh allowance, 30 viva uses a month on the
> paid plans, adds up to ₹11.16 (30 × ₹0.3719) and takes the worst case from ₹14.18 to **₹25.34**.
> The short answer and the Step 3 table below include it. The sensitivity sections further down
> were computed before it: add ₹11.16 to their per-student figures. Measured on the real models, a
> question set costs ₹0.11 and one answer's feedback ₹0.08, so ₹0.37 a use is a ceiling.
>
> **2026-10-01 — chapter builds (ADR-0039).** An eighth allowance: 3 chapter builds a month on
> the paid plans (1 on the trial), each priced for its worst case of 14 sections written once and
> examined once on the strong model with half of them fixed once, plus a fast-tier proofread pass
> — ₹9.0415 a build, ₹27.12 a month. The worst case for a fully active student is now **₹52.72**;
> `pnpm ai:verify` prints it. The tables below are as they stood before it: add ₹27.12 to the
> paid-plan totals and ₹9.04 to the trial's.
>
> **2026-10-04 — Assist on `gpt-4.1-mini` (ADR-0051).** Autocomplete moves to the model that won
> a blind comparison against `gpt-5-nano` (mean 8.03 against 6.95 over 30 judged cases). The fast
> tier changes as a whole, so citation suggestions and chat cost more too. Same allowances, a
> fully active student goes from ₹52.72 to **₹74.64**. At 300 suggestions a month (Jenni's free
> level) it would be ₹85.87; at 500, ₹104.58, over the ceiling. `gpt-4.1-mini` was priced from
> OpenAI's page on 2026-10-04 ($0.40 in, $0.10 cached, $1.60 out per million tokens).
>
> **2026-10-04 — examiner reviews (ADR-0056).** A ninth allowance: 6 examiner reviews a month on
> the paid plans (1 on the trial). One review is priced for its worst case of 8 sections, each one
> examiner call of the chapter build's shape on the strong model (5,500 in, 4,000 cached, 600 out):
> ₹1.8618 a review, ₹11.17 a month. A fully active student goes from ₹52.72 to **₹63.89** with
> `gpt-5-nano` on the fast tier, and from ₹74.64 to **₹85.82** with ADR-0051's `gpt-4.1-mini` —
> both within the ₹100 ceiling. `pnpm ai:verify` prints it.
>
> **2026-10-05 — chat on the strong tier (ADR-0077, the owner's decision).** Chat answers move
> to `gpt-5-mini`: ₹0.3741 a question with its reasoning priced in, 15 a month on a paid plan. A
> fully active student goes from ₹85.82 to **₹88.19** at the production configuration (Assist on
> `gpt-4.1-mini`), and from ₹63.89 to ₹69.06 with `gpt-5-nano` on the fast tier — within the ₹100
> ceiling. Drafting was already on the strong tier.
>
> **2026-10-05 — chapters planned from the title (ADR-0072).** "Start writing now" plans the
> chapters from the title with the existing outline call. It is not a new allowance: a thesis still
> has one outline call, already in the one-time line. Measured on `gpt-5-mini`, one plan costs
> ₹0.68, against the ₹0.48 profiled, because of reasoning tokens. Title plans are bounded at 5 a
> month on the paid plans and 2 on the trial. The worst case beyond the one-time line is therefore
> 4 × ₹0.68 = **₹2.72** a month: ₹85.82 → ₹88.54 with ADR-0051's fast tier. The ₹100 ceiling and
> the site budget refuse a plan like any metered action.
>
> **Research chat (ADR-0074).** A question to a thin library also sends up to six search abstracts
> and gets a longer, sectioned answer: the chat unit is priced at ₹0.4850 (6,700 in, 4,000 cached,
> 1,900 out on `gpt-5-mini`), plus at most ₹0.039 of embedding for the search, logged as `EMBED`.
>
> **All of 2026-10-05's changes together** (strong-tier research chat, title plans): the worst case
> for a fully active student at the production configuration is ₹89.85 + 15 × ₹0.039 + ₹2.72 =
> **₹93.16**, within the ₹100 ceiling.
>
> **2026-09-25 — Voyage's price.** `voyage-3` now lists at USD 0.06 per million tokens (Voyage
> calls it an older model; no free tokens), not the 0.02 this file used. Embedding a library costs
> ₹1.57 instead of ₹0.52, the one-time line becomes ₹0.70 a month, and the worst case **₹25.60**.
> Every figure below is updated for it. Later the same day the model moved to `voyage-4`
> (ADR-0032): the same price, and the first 200M tokens free — so in practice the embedding line
> is ₹0 until roughly the 650th library.

Every figure below comes out of `packages/config` — the same code the product bills with. Nothing
here is typed in by hand. Reproduce all of it with:

```bash
pnpm ai:verify
```

---

## The short answer

| | |
|---|---|
| **What one student costs us to serve** | **₹25.60 per month, worst case** |
| **What we charge** | ₹299/month or ₹2,499/year (in the code today) |
| **Gross profit per student per month** | **₹273.40** |
| **Gross margin** | **91%** |
| Our own hard ceiling | ₹100/user/month — we are ₹74.40 under it |

"Worst case" means a student who uses **every** unit of their monthly allowance, every month. Most
will not come close. So ₹25.60 is the ceiling on what one student can cost, not an average.

On the annual plan (₹2,499 for 12 months = ₹208/month) the same student costs ₹25.60, leaving
**₹182.65/month, an 88% margin**.

---

## How the ₹25.60 is calculated

There are three kinds of cost, and they are added up in `computeMonthlyBudget`
([`packages/config/src/cost.ts`](../packages/config/src/cost.ts)).

### Step 1 — what one AI call costs

Every model charges per million tokens, and charges more for what it writes than for what it reads.
`computeCallCost` is the whole formula:

```
cost in USD = ( fresh input tokens      × input price per million
              + cached input tokens     × input price per million × 0.1
              + output tokens           × output price per million ) ÷ 1,000,000

cost in ₹   = cost in USD × 87
```

The `× 0.1` is the prompt cache. We send the same instructions at the top of every request, so the
provider keeps them and charges a tenth for re-reading them. That discount is why the numbers below
are as small as they are — see the caveat at the bottom.

Prices are in [`packages/config/src/pricing.ts`](../packages/config/src/pricing.ts), read off each
provider's own pricing page on 2026-09-13:

| Model | Input $/M | Output $/M | Cached input |
|---|---|---|---|
| `gpt-5-nano` (fast tier) | 0.05 | 0.40 | 0.1× |
| `gpt-5-mini` (strong tier) | 0.25 | 2.00 | 0.1× |
| `voyage-4` (embeddings) | 0.06 | — | — |

### Step 2 — what each *action* costs

Each thing a student can do has a known shape: how much text goes in, how much comes back. Those
shapes are `ACTION_PROFILES`, taken from PRD §11.2.

| Action | Tier | Tokens in / cached / out | Cost each |
|---|---|---|---|
| Autocomplete (Assist) | fast | 1,200 / 4,000 / 50 | **₹0.0097** |
| Citation suggestion | fast | 3,000 / 4,000 / 100 | ₹0.0183 |
| Chat question | fast | 4,000 / 4,000 / 300 | ₹0.0296 |
| AI edit (rewrite/expand/tighten) | strong | 2,000 / 4,000 / 600 | ₹0.1566 |
| Drafted section | strong | 6,000 / 4,000 / 800 | ₹0.2784 |
| **Coherence check** | strong | 15,000 / 0 / 1,500 | **₹0.5873** |

Coherence is the most expensive single action in the product, because it reads the whole thesis and
nothing about it can be cached. Autocomplete is the cheapest by a factor of sixty, which matters
because it is the one students fire hundreds of times.

Autocomplete carries one extra adjustment: `assistCacheMissUplift = 1.12`. The cache has to be
written once per session before it can be read cheaply, so the real average is about 12% above the
cache-hit price. That is why the table below bills it at ₹0.0097 rather than ₹0.0087.

**Two later actions ride on units already in this table** rather than adding lines to it.
Proofreading (ADR-0026) is charged as one AI edit per run of up to 2,000 words: measured at
₹0.25 for 5,004 words on `gpt-5-nano`, so about ₹0.10 a run, which is less than the AI-edit
unit at the prices the budget actually uses — and at the E.2 reference prices, 2,000 words is
sized to cost no more than the unit (a test holds it there). The citation-support check
(ADR-0023) runs inside a coherence check: about ₹0.3 more per run on the fast tier, and about
₹1.5 since it moved to the strong tier on 2026-09-30 (it alone can tell a finding about another
material from one about the thesis's). One run a month on a paid plan: about ₹1.2 a month more.

### Step 3 — multiply by the caps, then add the fixed costs

Caps are per student per calendar month, from [`plans.ts`](../packages/config/src/plans.ts).

**Paid student plan (`STUDENT_MONTHLY` / `STUDENT_ANNUAL` / `INSTITUTION_SEAT`):**

| Item | Cap × unit | ₹ |
|---|---|---|
| Autocomplete | 180 × 0.0097 | 1.75 |
| Drafted sections | 10 × 0.2784 | 2.78 |
| Citation suggestions | 30 × 0.0183 | 0.55 |
| Chat | 15 × 0.0296 | 0.44 |
| AI edits | 4 × 0.1566 | 0.63 |
| Coherence | 1 × 0.5873 | 0.59 |
| Viva preparation (ADR-0030) | 30 × 0.3719 | 11.16 |
| One-time ops, amortised over 4 months | | 0.70 |
| Hosting share (at 500 active users) | | 7.00 |
| **TOTAL** | | **25.60** |

**Free trial (14 days):**

| Item | Cap × unit | ₹ |
|---|---|---|
| Autocomplete | 50 × 0.0097 | 0.49 |
| Drafted sections | 2 × 0.2784 | 0.56 |
| Citation suggestions | 10 × 0.0183 | 0.18 |
| Chat | 5 × 0.0296 | 0.15 |
| AI edits | 2 × 0.1566 | 0.31 |
| Coherence | 0 | 0.00 |
| One-time ops + hosting | | 7.44 |
| **TOTAL** | | **9.12** |

A trial that never converts costs us **₹9.12** — and ₹7 of that is the hosting share, which we pay
whether or not the seat is filled. The AI a trial user can consume is ₹1.69.

### The two fixed lines, explained

**One-time ops — ₹0.70/month.** When a student starts, we do a few things once: read and structure
their uploaded papers (₹0.61), generate the chapter outline (₹0.48), build their style profile
(₹0.13), and embed a ~30-paper library for search (₹1.57). That is ₹2.79 once, spread over the four
months a thesis typically takes — ₹0.70 a month.

**Hosting share — ₹7.00/month.** The whole server, backups and object storage is budgeted at
₹3,500/month. Split across an assumed 500 active users that is ₹7 each. **This is the number most
sensitive to being wrong**: at 100 users it is ₹35 each, at 50 users it is ₹70 each. It does not
change the AI cost at all, but it changes the total a great deal.

So, at different scales, the same fully-active student costs:

| Active users | Hosting share | Total cost | Margin at ₹299 |
|---|---|---|---|
| 50 | ₹70.00 | ₹77.18 | 74% |
| 100 | ₹35.00 | ₹42.18 | 86% |
| 250 | ₹14.00 | ₹21.18 | 93% |
| **500** | **₹7.00** | **₹14.18** | **95%** |
| 1,000 | ₹3.50 | ₹10.68 | 96% |

**The AI is not the risk. Getting to 500 users is.** Below **35** paying users the hosting line
alone eats the whole ₹100 ceiling.

---

## What actually stops us overspending

Two separate mechanisms, and only the second is a guarantee.

1. **The projection.** `pnpm ai:verify` recomputes the table above from the real configured models
   and exits non-zero if it goes over ₹100. CI runs the same check. This catches a bad *plan* —
   a cap raised too far, a model swapped for an expensive one, a price rise.

2. **The runtime hard stop.** `UsageService.consume` sums the student's actual logged spend for the
   month **before** every AI call, and refuses at ₹100 with "You have used this month's AI
   allowance." (`apps/api/src/modules/usage/usage.service.ts`, 11 tests in
   `apps/api/test/ceiling.spec.ts`.) This catches reality being different from the plan. It is what
   makes ₹100 a fact rather than an estimate.

There is also an email to the admin at ₹85, so somebody sees a heavy user before the wall.

---

## About the manager's pricing document

`RADemics_Thesis_Copilot_Pricing.docx` proposes ₹349/month with much larger caps — 8,000
autocompletes, 200 AI edits, coherence twice a week. When [`PRICING-REVIEW.md`](PRICING-REVIEW.md)
was written we were on Claude Haiku 4.5 and Sonnet 5, and those caps cost **₹1,772** to serve. That
review said the caps were not survivable.

**On the models we run today, they very nearly are.** Recomputed 2026-09-13:

| Scenario | Cost/user/month | Margin at ₹349 |
|---|---|---|
| Document's caps, old models (Haiku + Sonnet) | ₹1,772 | −408% |
| Document's caps, today's models | ₹128.98 | 63% |
| Document's caps, AI edits moved to the fast model | ₹103.92 | 70% |
| **Document's caps, edits on fast + autocomplete at 7,500** | **₹99.05** | **72%** |
| Our current caps | ₹14.18 | 96% |

So the document's tier fits inside the ₹100 ceiling with two changes: cap autocomplete at **7,500**
instead of 8,000, and run AI edits on the fast model instead of the strong one. That is a config
change in `plans.ts`, not new code.

Alternatively, a tier far more generous than what we ship today still leaves plenty of room:

| | Ships today | A generous tier that still fits |
|---|---|---|
| Autocomplete | 180 | 4,000 |
| Citation suggestions | 30 | 100 |
| Chat | 15 | 100 |
| AI edits | 4 | 100 |
| Drafts | 10 | 20 |
| Coherence | 1 | 8 |
| **Cost** | **₹14.18** | **₹64.60** |
| **Margin at ₹299** | 95% | **78%** |

Our current caps are far tighter than the money requires. That is a decision for the owner, not the
code: **we could be roughly 20× more generous and still keep a 78% margin.** See
[`PENDING.md`](PENDING.md) → "Decisions and reviews".

---

## What is still unproven

Three honest caveats. None of them is hidden anywhere else in the docs.

**1. The prompt cache has not been proven on a real chapter.** Every autocomplete price above
assumes the 4,000-token instruction prefix is served from cache at 0.1×. If it never engages,
autocomplete costs ₹0.0244 instead of ₹0.0097 — the student plan goes from ₹14.18 to **₹16.81**,
which is still fine, but the 7,500-autocomplete tier above goes from ₹99 to **₹215.71**, which is
not. Proving it needs the five fixture papers listed in `PENDING.md`; a real chapter with pinned
passages is the only prompt long enough to test it.

**2. The token profiles are the PRD's estimates, not measurements.** `pnpm ai:verify` measures a
real call, but a two-sentence probe, not a full chapter. The same five fixture papers settle this.

**3. Hosting is a budget, not an invoice.** ₹3,500/month is what we expect a VPS plus backups plus
object storage to cost. No server has been rented yet.

**What is measured and real:** the model prices (read off both providers' pricing pages on
2026-09-13), the exchange rate assumption (₹87/USD), the arithmetic, the caps, and the runtime
₹100 stop.

---

## Changing any of this

Nothing above is hardcoded in a way that needs a deploy:

- **Prices or exchange rate** — set `PRICING_OVERRIDE_JSON` in the environment. It merges over
  `DEFAULT_PRICING`, and the app refuses to start if the JSON is malformed.
- **Models** — `AI_FAST_MODEL` and `AI_STRONG_MODEL`. The vendor is derived from the model id, so
  moving a tier back to Anthropic is one environment variable (ADR-0011). Run `pnpm ai:verify`
  afterwards; it will fail if the new configuration breaks ₹100.
- **Caps** — `packages/config/src/plans.ts`, one table.
- **The ceiling itself** — `MONTHLY_CEILING_INR` in `cost.ts`. Both the projection and the runtime
  stop read it.
- **What we charge** — `packages/config/src/billing.ts` (₹299/₹2,499 today).
