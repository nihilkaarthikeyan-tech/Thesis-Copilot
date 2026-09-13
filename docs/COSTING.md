# What one student costs us, what we charge, what is left

Recomputed 2026-09-13 against the models actually configured: `gpt-5-nano` on the fast tier,
`gpt-5-mini` on the strong tier, `voyage-3` for embeddings (ADR-0011).

Every figure below comes out of `packages/config` — the same code the product bills with. Nothing
here is typed in by hand. Reproduce all of it with:

```bash
pnpm ai:verify
```

---

## The short answer

| | |
|---|---|
| **What one student costs us to serve** | **₹14.18 per month, worst case** |
| **What we charge** | ₹299/month or ₹2,499/year (in the code today) |
| **Gross profit per student per month** | **₹284.82** |
| **Gross margin** | **95%** |
| Our own hard ceiling | ₹100/user/month — we are ₹85.82 under it |

"Worst case" means a student who uses **every** unit of their monthly allowance, every month. Most
will not come close. So ₹14.18 is the ceiling on what one student can cost, not an average.

On the annual plan (₹2,499 for 12 months = ₹208/month) the same student costs ₹14.18, leaving
**₹193.99/month, a 93% margin**.

---

## How the ₹14.18 is calculated

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
| `voyage-3` (embeddings) | 0.02 | — | — |

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
| One-time ops, amortised over 4 months | | 0.44 |
| Hosting share (at 500 active users) | | 7.00 |
| **TOTAL** | | **14.18** |

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

**One-time ops — ₹0.44/month.** When a student starts, we do a few things once: read and structure
their uploaded papers (₹0.61), generate the chapter outline (₹0.48), build their style profile
(₹0.13), and embed a ~30-paper library for search (₹0.52). That is ₹1.74 once, spread over the four
months a thesis typically takes — ₹0.44 a month.

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
