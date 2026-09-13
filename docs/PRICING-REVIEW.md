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

---

# Addendum — can a different model make the document's caps work?

Added 2026-09-13. Prices read that day from
`platform.claude.com/docs/en/about-claude/pricing` and
`developers.openai.com/api/docs/pricing`. None of them is a guess.

## First: our own price table was wrong

`pricing.ts` priced the strong tier at **$3/$15 per MTok**. That is Sonnet 4.6's rate. **Sonnet 5 is
$2/$10**, and Anthropic's pricing page carries an explicit note that the scheduled rise to $3/$15
on 2026-09-01 did not happen.

Correcting it drops the modelled cost of a fully active Student from **₹98.92 to ₹86.03** — ₹14 of
headroom that was always there. Everything below uses the corrected figure. (The tier *fallback*
stays at $3/$15 deliberately: it prices an unverified model, where guessing high is the safe
direction.)

## What Jenni.ai runs

Reviews of Jenni in 2026 describe it as running on GPT-4-class infrastructure, specialised for
academic writing. Worth noting what that does *not* tell us: Jenni charges **$12–20/month
(₹1,020–1,700)**. They have three to five times our revenue per user to spend on the same work.
Matching their limits at ₹349 is not a model choice, it is a different business.

## Cost of one autocomplete, by model

Our ASSIST profile — 1,200 fresh + 4,000 cached input, 50 output, with §11.2's cache-miss uplift:

| Model | Per call | × 8,000/month | No cache hit |
|---|---|---|---|
| `claude-haiku-4-5` (today) | ₹0.1803 | ₹1,442 | ₹4,248 |
| `claude-sonnet-5` | ₹0.3605 | ₹2,884 | ₹8,497 |
| **`gpt-5-nano`** | **₹0.0097** | **₹78** | ₹218 |
| `gpt-4.1-nano` | ₹0.0234 | ₹187 | ₹421 |
| `gpt-4o-mini` | ₹0.0497 | ₹398 | ₹631 |
| `gpt-5-mini` | ₹0.0487 | ₹390 | ₹1,091 |

`gpt-5-nano` is **18× cheaper per autocomplete than Haiku 4.5** — $0.05/$0.40 against $1/$5, with a
90% cached-input discount against Anthropic's 90% too.

## Whole Student tier at ₹349, keeping the document's caps

| Autocomplete model | Total cost | Margin |
|---|---|---|
| Haiku 4.5 (today) | ₹1,730 | −396% |
| gpt-5-nano, edits still on Sonnet | ₹365 | −5% |
| **gpt-5-nano, edits also on nano** | **₹158** | **55%** |
| gpt-4.1-nano, edits also on nano | ₹270 | 23% |

**So yes — the document's 8,000 autocompletes are affordable, but only on a nano-class model, and
only if the 200 AI edits move off Sonnet too.** At that point it lands at 55% margin, near the
document's 60% target.

## What that costs in quality — and what it does not

The honest part: `gpt-5-nano` is a nano-class model. Its prose will be worse than Haiku 4.5's, and
Haiku is already the cheap half of this product. Nobody should adopt it on arithmetic alone.

The reassuring part is narrower than it looks. The product's integrity promise does **not** rest on
the model behaving: `stripUnknownCitations` (§10.6) removes any citation the model was not shown and
counts it as `HALLUCINATED_CITE`. A weaker model cannot invent a source here — the post-processor
deletes it before the student sees it. So the risk is *prose quality*, not *academic integrity*,
which is a far more testable and far less dangerous thing to be wrong about.

The way to settle it is the prompt golden set (Appendix C.5, `docs/PENDING.md`): the same ten
scenarios through Haiku and through nano, judged side by side. That needs the fixture papers, like
everything else that would settle a question here.

## What adopting OpenAI would actually cost to build

Small, and that is by design. `packages/ai` already hides the provider behind `LlmProvider`, with
`AnthropicLlmProvider` and `MockLlmProvider` as the two implementations and every call site going
through the interface. An `OpenAiLlmProvider` is one new class plus a branch in `createProviders`,
and the per-tier model ids already come from the environment.

Two things it is not free of:

- **PRD §7.2 fixes the stack** at the Vercel AI SDK with `@ai-sdk/anthropic`. A second provider is a
  substitution and needs an ADR.
- **`packages/config` prices by model id**, which now works correctly for both directions (see the
  audit above), so OpenAI ids just need entries — but `pnpm ai:verify` must be taught to probe a
  second provider, or it will keep reporting only half the picture.

## Recommendation

1. **Take the ₹86.03 correction now.** It is a real ₹14 that was being thrown away, and it needs no
   decision from anyone.
2. **Do not move the whole product.** Drafting, coherence and citation suggestions are where the
   product's value and its integrity claims live; Sonnet 5 at $2/$10 is now cheap enough that
   moving them saves little and risks much.
3. **Test nano on autocomplete specifically**, against the golden set, before committing to it. That
   is the one action with the volume to matter and the least at stake per call.
4. **Decide the caps independently of the model.** Even on nano, "8,000" is a number nobody will
   reach; 300–600 would cost a fraction and read as generous. A cap that no user approaches is not
   a feature, it is an unpriced liability.
