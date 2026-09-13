# Review of `RADemics_Thesis_Copilot_Pricing.docx`

Reviewed 2026-09-13 against the cost model in `packages/config`, with the models we actually run
(Haiku 4.5 on the fast tier, Sonnet 5 on the strong tier — which is exactly what the document
assumes, so no disagreement there).

**The structure is good.** Four tiers, device limits stated openly, one active project per account,
and the two most expensive features gating the Student → Pro upgrade — that last point is exactly
right, and it is the same conclusion the cost model reaches independently. The competitive framing
against Jenni.ai is sound.

**The cap numbers are not survivable.** Not by a margin that tuning fixes: the Student tier as
written costs **₹1,791 to serve at ₹349**, and that is the optimistic case.

---

## 1. What the caps cost

Unit costs, computed by `computeCallCost` with the configured models — the same function
`pnpm ai:verify` uses:

| Action | Cost each |
|---|---|
| Autocomplete (cache hit) | ₹0.18 |
| Autocomplete (no cache hit) | ₹0.53 |
| Citation suggestion | ₹0.24 |
| Chat question | ₹1.15 |
| AI edit (rewrite/expand/tighten) | ₹1.28 |
| Drafted section | ₹2.71 |
| **Coherence check** | **₹10.44** |

Applying the document's caps:

| Tier | Price | Cost if used | Margin |
|---|---|---|---|
| Student | ₹349 | **₹1,791** | **−413%** |
| Student, no cache | ₹349 | **₹4,598** | −1,217% |
| Thesis Pro | ₹699 | **₹2,893** | −314% |
| Thesis Pro, no cache | ₹699 | **₹7,103** | −916% |

Two lines dominate, and neither is the autocomplete number people notice first:

- **200 AI edits/month costs ₹256** on its own, against a ₹349 price. That single row spends 73% of
  the revenue before anything else runs.
- **Coherence at "2×/week"** is ~8/month at ₹10.44 = **₹84**. It is the most expensive action in the
  product by a factor of four, because it reads the whole thesis.
- 8,000 autocompletes is ₹1,442 by itself.

**₹349 buys zero autocompletes** once the document's own edit and coherence caps are paid for.

## 2. The document disagrees with itself

Three numbers in it cannot all be true:

- The margin table estimates **₹80–₹130** cost per user.
- The narrative estimates **$0.50–$1.00**, which at the document's own ₹85/USD is **₹42.50–₹85** —
  a different range from the table above it.
- The caps, priced, come to **₹1,791**.

The first two are plausible as *typical* usage. The third is what the caps *permit*. A cap is a
worst-case promise, so both can be true only if the caps are never approached — and then the caps
are not doing the job a cap exists to do.

## 3. Why this matters more than usual here

Since 2026-09-08 the product has a **runtime hard stop at ₹100 of real spend per user per month**
(`UsageService.consume`). It reads actual logged cost and refuses further AI with "You have used
this month's AI allowance." The owner chose that behaviour explicitly.

So if the Student tier advertises 8,000 autocompletes, a heavy user is cut off at roughly **500** —
and told their allowance is finished while the pricing page says they have 7,500 left. That is not
a cost problem, it is a refund and reputation problem.

**The advertised cap and the enforced ceiling have to be the same number.** Whichever way that is
resolved, they cannot disagree.

## 4. What actually fits

Keeping the document's own **60–75% margin target**, and noting the ₹100 ceiling was set when the
price was ₹299 — at ₹349 a 60% margin allows about **₹140**:

| | Student ₹349 | Thesis Pro ₹699 |
|---|---|---|
| Autocomplete | **300** | **600** |
| Citation suggestions | 40 | 80 |
| Chat questions | 20 | 40 |
| AI edits | 8 | 16 |
| Drafted sections | 6 | 12 |
| Coherence checks | 2 | 4 |
| **Worst-case cost** | **₹144** | **₹278** |
| **Margin** | **59%** | **60%** |

These are worst case — every unit consumed. Typical usage lands far below, which is where the
document's ₹80–130 estimate is realistic.

The shape of the document's ladder survives intact: Pro is roughly double Student, coherence and
edits still gate the upgrade, and the tier names and positioning do not change. Only the magnitudes
move, by roughly 25× on autocomplete and 25× on edits.

## 5. "Unlimited" cannot ship as written

PRD §11: *a feature that cannot be metered and capped does not ship.* Thesis Pro's "Unlimited AI
edits" and "Unlimited coherence (soft-throttled)" need a real number behind the throttle, even if
it is never printed on the pricing page. The system needs something to enforce; the marketing copy
can still say "unlimited, fair use".

Coherence especially: at ₹10.44 each, an unthrottled Pro user running one a day costs ₹313/month
against a ₹699 price, from that one feature.

## 6. Smaller things

- **Exchange rate.** The document uses ₹85/USD, `pricing.ts` uses ₹87. Worth agreeing one; it moves
  every figure by ~2%.
- **Autocomplete caching.** The ₹0.18 figure assumes prompt caching engages. It has not yet been
  proven on a real chapter (`docs/PENDING.md`), and without it the same action is ₹0.53 — so the
  whole model is sensitive to something still unmeasured. The five fixture papers settle it.
- **Annual discount.** ₹2,999/yr against ₹349/mo is 28% off, as stated. Cost is monthly and
  recurring, so an annual plan must still respect the monthly ceiling — it changes cash flow, not
  what a user may consume in a month.
- **What the code says today.** ₹299/mo, ₹2,499/yr, and three plans. Adopting this document means a
  fourth tier (`THESIS_PRO`), new prices in `packages/config/src/billing.ts`, and new caps in
  `plans.ts`. All of it is table data, not new logic — roughly half a day once the numbers are
  agreed.

## What I need decided

1. **The cost ceiling per user.** ₹100 as it stands, or ~₹140 to match the 60% margin at ₹349?
2. **The caps**, once the ceiling is fixed. The table in §4 is a starting point, not a
   recommendation to adopt unchanged.
3. **A number behind every "unlimited"**, even if it is not published.

Nothing here blocks other work; the plan tables are a config change whenever the numbers land.
