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
