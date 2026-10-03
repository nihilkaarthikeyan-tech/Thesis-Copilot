# ADR-0051 — Autocomplete on gpt-4.1-mini

**Status:** accepted · **Date:** 2026-10-04 · **Changes:** ADR-0011's fast-tier choice.

## Context

Autocomplete is Jenni's core feature and reviews call it "fast and fluent". Ours ran on
`gpt-5-nano`, chosen in ADR-0011 as the cheapest model that cited reliably. The owner approved
switching to a better model if it still fits the ₹100 ceiling.

## Evidence

`packages/ai/eval/run.ts assist --samples 2 --model <id>` (the harness gained `--model` for this):
the production Assist request on 15 real thesis cases, twice each, both sides through production's
post-processing, judged blind by `gpt-5-mini` in both orders.

| Candidate vs `gpt-5-nano` | Preferred (cur / cand / tie) | Mean score | Cited |
|---|---|---|---|
| **gpt-4.1-mini** | 8 / **14** / 8 | 6.95 → **8.03** | 29 → 30 |
| gpt-5.4-nano | 15 / 12 / 3 | 7.32 → 6.82 | 30 → 30 |
| gpt-4.1-nano | 10 / 9 / 11 | — | 30 → 29 |

`pnpm ai:shakedown` with `AI_FAST_MODEL=gpt-4.1-mini`: every fast-tier structured path passed;
two strong-tier cases failed once and passed on rerun with the unchanged strong model.

## Decision

`AI_FAST_MODEL=gpt-4.1-mini` (a setting; applied at release). Priced from OpenAI's page on
2026-10-04 and added to `pricing.ts`. At today's allowances a fully active student costs ₹74.64,
up from ₹52.72. The allowance itself (180 a month on paid plans) is the owner's decision
(`docs/PENDING.md`).

## Consequences

- Every fast-tier action moves to the new model: citation suggestions, chat, themes, proofreading.
  They passed the shakedown; citation suggestions and chat cost about seven times more each, both
  small in the total.
- `gpt-4.1-mini` does not reason, so it takes no reasoning setting and no headroom; the adapter
  already handles that from the model id.
