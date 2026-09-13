# 0011 — A second provider, for the fast tier

Date: 2026-09-13
Status: accepted
Amends: PRD §7.2's stack table (AI SDK row), §13.3's environment list, §11.1's price table.

## Context

PRD §7.2 fixes the stack at "Vercel AI SDK (`ai`) + `@ai-sdk/anthropic`, behind `packages/ai`", and
§0.3 rule 3 requires an ADR before that changes.

The owner's pricing document (`docs/PRICING-REVIEW.md`) sets the Student tier at ₹349/month with
8,000 autocompletes. Priced against the models we run, that tier costs ₹1,791 to serve. The review
established that no arrangement of Anthropic models closes a gap that size: Haiku 4.5 is the
cheapest model Anthropic sells, and 8,000 autocompletes on it is ₹1,442 before anything else runs.

Prices read from both providers on 2026-09-13:

| Model | Input $/MTok | Output $/MTok | Cached input | One autocomplete |
|---|---|---|---|---|
| `claude-haiku-4-5` | 1.00 | 5.00 | 0.10 | ₹0.1803 |
| `claude-sonnet-5` | 2.00 | 10.00 | 0.20 | ₹0.3605 |
| `gpt-5-nano` | 0.05 | 0.40 | 0.005 | **₹0.0097** |
| `gpt-4.1-nano` | 0.10 | 0.40 | 0.025 | ₹0.0234 |
| `gpt-4o-mini` | 0.15 | 0.60 | 0.075 | ₹0.0497 |

`gpt-5-nano` is 18× cheaper per autocomplete than the cheapest Anthropic model. With it on the fast
tier and the AI edits moved across too, the document's Student tier costs ₹158 against ₹349 — a 55%
margin, against the document's own 60% target. That is the whole reason this ADR exists; there is no
engineering argument for a second provider, only an arithmetic one.

## Decision

Add `@ai-sdk/openai` as a second provider behind the existing `LlmProvider` interface, and select
the provider **per tier**, from the configured model id.

Three things this deliberately is not:

- **Not a migration.** Anthropic remains the provider for the strong tier — drafting, section
  commands, chat, coherence and the citation-role rewrite. Sonnet 5 at $2/$10 is now cheap enough
  that moving that work saves little and risks the outputs the product is actually judged on.
- **Not a new abstraction.** `packages/ai` already hides the provider behind `LlmProvider`, with
  `AnthropicLlmProvider` and `MockLlmProvider` as implementations and every call site going through
  the interface. This is a third implementation, not a redesign. Both use the same Vercel AI SDK
  primitives (`streamText`, `generateObject`), so the new class is close to a transcription of the
  existing one.
- **Not yet a decision to run nano in production.** It makes nano *testable*. Whether its prose is
  good enough is a question for the Appendix C.5 golden set, which needs the fixture papers.

### The provider comes from the model id

`AI_FAST_MODEL=gpt-5-nano` implies OpenAI, because no other provider serves that id. So
`providerForModel()` derives it, rather than a separate `AI_FAST_PROVIDER` variable.

The alternative — one explicit variable per tier — was rejected because the two can disagree. Setting
`AI_FAST_MODEL=gpt-5-nano` and forgetting `AI_FAST_PROVIDER=openai` produces a confusing 404 from
Anthropic rather than a clear error, and nothing in the system could tell which of the two the
operator meant. Deriving from the id makes that state unrepresentable.

`AI_PROVIDER` keeps its job: `mock` forces the mock for every tier regardless of model ids, which is
what every test relies on. It is no longer the thing that picks between real providers.

## Consequences

- **`OPENAI_API_KEY` joins §13.3.** Optional, and required only when a configured model id is an
  OpenAI one — `packages/config` refuses to start if it is missing then, the same way it does for
  `ANTHROPIC_API_KEY`.
- **`pnpm ai:verify` probes both.** It already makes one real call per tier; those calls now go to
  whichever provider each tier's id belongs to, and the printed table says which.
- **Prices for the OpenAI ids go in `pricing.ts`.** OpenAI publishes a cached-input *price* rather
  than a multiplier, so those entries carry `cacheReadMult` derived from the published pair
  (e.g. 0.005/0.05 = 0.1 for `gpt-5-nano`) — the same shape the cost model already uses, and
  `computeCallCost` needs no change.
- **Two vendors to watch.** A second provider is a second status page, a second set of rate limits
  and a second bill. Accepted knowingly: the fast tier degrading is a worse suggestion, not a
  broken product, and the ₹100 ceiling now measures real spend whichever provider produced it.
- **§10.6 is unchanged and is what makes this safe.** `stripUnknownCitations` removes any citation
  the model was not shown, so a weaker model on the fast tier cannot invent a source. The exposure
  is prose quality, not academic integrity.
- **The PRD should be amended** — §7.2's AI SDK row and §13.3's variable list. `docs/PENDING.md`
  carries that, as it does for ADR-0010.

---

## Measured, 2026-09-13 (after the key arrived)

Two things the arithmetic could not have told us, both found on the first real call.

### `gpt-5-nano` reasons by default, and reasoning is billed as output

At the fast tier's 120-token cap it spent all 64 tokens reasoning and returned an **empty string**.
Raising the cap to 500 spent 448 the same way. That is not a worse answer; it is paying full price
for nothing.

| `maxOutputTokens` | Reasoning tokens | Text tokens |
|---|---|---|
| 120, default | 64 | **0** |
| 500, default | 448 | **0** |
| 120, `reasoningEffort: 'minimal'` | 0 | **75** |
| 120, `reasoningEffort: 'low'` | 64 | **0** |

So the adapter sets `reasoningEffort: 'minimal'` on the fast tier, and leaves the strong tier at the
model's default — the fast tier is short continuations under a 120-token cap, where there is neither
budget nor use for reasoning. Non-reasoning models such as `gpt-4o-mini` ignore the option, so it is
safe to send whatever id is configured.

`pnpm ai:verify` also had to change: its probe asked for 5 output tokens, and OpenAI rejects
anything under 16. No real action is near that — the smallest is ASSIST at 120 — so this was the
probe only.

### Format compliance is the risk, not prose quality

Six runs of the same real Assist prompt with two pinned sources, through each candidate. "Usable"
means the editor received a `{{cite:ID}}` it could turn into a citation:

| Model | Usable | Raw id in prose | Avg output | Cost per call |
|---|---|---|---|---|
| `claude-haiku-4-5` | 6/6 | 0/6 | 84 | ₹0.1027 |
| **`gpt-5-nano`** | **6/6** | 0/6 | 72 | **₹0.0055** |
| `gpt-4.1-nano` | **2/6** | 0/6 | 34 | ₹0.0072 |
| `gpt-4o-mini` | 6/6 | 0/6 | 74 | ₹0.0129 |
| `gpt-5-mini` | 6/6 | 0/6 | 94 | ₹0.0315 |

The prose was not the problem. Every model that cited at all cited correctly and quoted the
passages accurately. What separates them is whether they emit the marker the editor needs.

- **`gpt-4.1-nano` is out.** Two usable answers in six; it writes a fluent paragraph and simply
  omits the citation.
- **`gpt-5-nano` is 19× cheaper than Haiku and was 6/6 here** — but on an earlier single run it
  wrote `(S1#c1; S2#c1)` as literal text instead of the marker. One failure in thirteen runs. At
  8,000 suggestions a month that is not a rounding error, and a student seeing `S1#c1` in their
  own paragraph reads it as a bug in the product.
- **`gpt-4o-mini` is 8× cheaper and was 6/6**, with no reasoning behaviour to configure around.

### What this changes

Nothing yet, deliberately. The fast tier stays on `claude-haiku-4-5`. One prompt six times is not
an eval: it rules `gpt-4.1-nano` out and it proves the adapter works, but choosing between nano,
`gpt-4o-mini` and Haiku is what the Appendix C.5 golden set is for, and that needs the fixture
papers.

The costs are no longer the question. Anything on that list clears the ₹100 ceiling with room —
with nano on the fast tier the modelled Student total is **₹38.45** against ₹86.03 on Haiku. The
question is now entirely reliability, which is a better problem to have and a measurable one.

---

## Configuration as shipped, 2026-09-13

The owner asked to move off Anthropic entirely, keeping the key but not using it. Both tiers are
OpenAI:

| Tier | Model | Why |
|---|---|---|
| fast | `gpt-4o-mini` | 6/6 on citation format, no reasoning behaviour to work around, ₹0.0125 a suggestion against Haiku's ₹0.1014 for output of the same quality |
| strong | `gpt-5-mini` | 4/4 valid structured output, ₹0.0614 against Sonnet's ₹0.2079; it reasons, which is what the strong tier is for |

`ANTHROPIC_API_KEY` stays in `.env`, unused. Nothing reads it while both model ids are OpenAI ones,
and putting a Claude id back in either tier restores that path with no code change — which is the
point of deriving the vendor from the id.

**Modelled cost of a fully active Student: ₹26.40**, against ₹86.03 on Anthropic and a ₹100 ceiling.

### Two adapter details the probe caught

- `reasoningEffort` now goes only to models that reason (`gpt-5*`, o-series). `gpt-4o-mini` logged
  "reasoningEffort is not supported" on every call — harmless, but a warning on every call is how
  real warnings stop being read.
- `pnpm ai:verify`'s probe budget went from 16 to 256. At 16, `gpt-5-mini` spent everything
  reasoning and returned an empty string, so the probe failed a model that works. The probe asks
  for one word; nothing but a reasoning model will use more than a handful of the 256.

### What this does and does not do to the pricing document

At **our** caps (180 autocompletes) this configuration is ₹26.40. At the **document's** caps it is
still a loss:

| Configuration | Student at doc caps | Thesis Pro at doc caps |
|---|---|---|
| Haiku + Sonnet 5 (before) | ₹1,709 — loss | ₹2,724 — loss |
| **`gpt-4o-mini` + `gpt-5-mini` (now)** | **₹451 — loss** | ₹698 — 0% margin |
| `gpt-5-nano` + `gpt-5-mini` | ₹129 — 63% margin | ₹214 — 69% |
| `gpt-5-nano` + `gpt-4o-mini` | ₹109 — 69% margin | ₹172 — 75% |

So moving to OpenAI cut the cost by 4× but did not by itself make 8,000 autocompletes affordable.
Only `gpt-5-nano` does that — and nano is the model that wrote `(S1#c1; S2#c1)` as literal text once
in thirteen runs. **The choice is between the document's caps and a model with an observed failure
rate**, and it stays open until the golden set can measure that rate properly. Lowering the caps
removes the choice entirely, which is what `docs/PRICING-REVIEW.md` §4 recommends on other grounds.

---

## Correction: the six-run sample was wrong

The owner asked why the fast tier was not on `gpt-5-nano`, given the cost. The answer given was
"one format failure in thirteen runs" — which was too small a sample to reject a model on, so it
was measured properly: **30 runs each, rotating three different sentences and source sets** so the
result is not one prompt answered thirty times.

| Model | Usable | Failure mode | Cost/call | At 180/month |
|---|---|---|---|---|
| **`gpt-5-nano`** | **29/30 (97%)** | 1 × raw id in prose | **₹0.0048** | ₹0.87 |
| `gpt-4o-mini` | 27/30 (90%) | 3 × no citation at all | ₹0.0114 | ₹2.05 |

`gpt-5-nano` is **both more reliable and 2.4× cheaper**. The earlier six-run comparison had it at
6/6 and `gpt-4o-mini` at 6/6, which distinguished nothing; the single nano failure that drove the
recommendation was noise in a sample too small to carry it.

The failure *modes* also differ, and not in `gpt-4o-mini`'s favour. Nano's one failure wrote
`{S1#c1}` — a single brace instead of the double the editor expects — which is visible: the student
sees a stray token and deletes it. `gpt-4o-mini`'s three failures wrote clean prose with **no
citation at all**, which is silent, and a silently uncited claim in a thesis is the more dangerous
of the two for a product whose whole promise is that it cites what it can show you.

So the fast tier is `gpt-5-nano`. **Modelled Student cost: ₹16.68**, against ₹86.03 on Anthropic.

This also changes the pricing answer: at the document's caps, `gpt-5-nano` + `gpt-5-mini` is ₹129
against ₹349 — a 63% margin — so **the document's 8,000 autocompletes are now affordable as
written**, without touching the caps. Lowering them remains worthwhile for the reasons in
`docs/PRICING-REVIEW.md` §4, but it is no longer forced by cost.

Thirty runs over three prompts is better evidence than six over one; it is still not the Appendix
C.5 golden set, which judges whether the suggestion is *good* rather than merely well-formed. That
remains open and still needs the fixture papers.
