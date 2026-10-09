# ADR-0146: Would full-size models improve our writing? (model-size test)

**Date:** 2026-10-09 · **Status:** cost measured, quality not yet measured (OpenAI credit
exhausted); no change made · **Asked by:** the owner

## Context

The owner asked whether Jenni's output reads better because it runs a bigger or better-tuned GPT,
and asked us to measure whether our own quality improves on full-size models: the fast tier
`gpt-4.1-mini` (Assist, citation suggestions) against `gpt-4.1`, and the strong tier `gpt-5-mini`
(outlines, edit commands, chat since ADR-0077, drafting, examiner review) against `gpt-5`. Same
Appendix A prompts; only the model differs.

## What was done

- `packages/ai/eval/run.ts`: `--strong-model <id>` puts side B's strong tier on another model
  (`--model <id>` already did the fast tier). The judge stays on the configured strong model and
  sees both orders, so it never knows which side is which. Side A now has its own meter, so the
  summary reports `spentRupeesBySide` and `rupeesPerCase`; every case prints the running ₹ total;
  `--max-rupees <n>` stops a run at a spend.
- `packages/config/src/pricing.ts`: `gpt-4.1` ($2.00 in / $0.50 cached / $8.00 out per M) and
  `gpt-5` ($1.25 / $0.125 / $10.00), read off developers.openai.com/api/docs/pricing on
  2026-10-09. They were missing from the table. Without them the meter would have priced them at
  the tier fallback (wrong in both directions). The page also confirms the existing `gpt-4.1-mini`
  and `gpt-5-mini` entries.
- All four ids exist: each answered a one-word call. But in both runs of that probe, one call
  (a different model each time) was refused with `insufficient_quota` /
  `credit_balance_exhausted`. The account's balance is at or near zero. The planned spend
  (≤ ₹120) assumed about $25.

## Why the judged comparison was not run

With calls refused at random, a refused call counts as "offered nothing" and the judge scores it
down. That would decide the comparison for reasons that have nothing to do with model size. The
same balance also pays for production. Spent so far: about ₹0.2.

To run it once credit is added (from `packages/ai`):

```
pnpm exec dotenv -e ../../.env '--' tsx eval/run.ts assist --model gpt-4.1 --max-rupees 40
pnpm exec dotenv -e ../../.env '--' tsx eval/run.ts assist --set opener --model gpt-4.1 --max-rupees 25
pnpm exec dotenv -e ../../.env '--' tsx eval/run.ts command --strong-model gpt-5 --max-rupees 40
```

## The cost side (measured from the cost model)

`computeMonthlyBudget('STUDENT_MONTHLY', { models })` gives the fully active student's worst case,
using COSTING.md's call counts:

| Configuration | ₹/student/month | Extra |
|---|---|---|
| Today (`gpt-4.1-mini` / `gpt-5-mini`) | 145.62 | — |
| Fast tier on `gpt-4.1` | 366.04 | +220.42 (Assist 540 calls × ₹0.47 = ₹252.56; citations +₹18.38) |
| Strong tier on `gpt-5` | 478.10 | +332.48 (chapter builds ₹135.62, lit review ₹86.94, examiner ₹62.98, viva ₹55.79, chat ₹36.38) |
| Both | 698.52 | +552.90 |
| Draft only on `gpt-5` | ~156.76 | +11.14 |

A full switch of either tier is 5× the per-call price and costs more than the whole ₹100 ceiling
again. That holds before any quality result, so the only switch the cost model leaves room for is
a narrow one: one low-volume action, such as drafting, at about ₹11 more a month. It should go
ahead only if the judged run shows a clear win on it.

## Decision

No change. Production model ids and `.env` are untouched. The quality question stays open until
the OpenAI balance is topped up and the three runs above are made.
