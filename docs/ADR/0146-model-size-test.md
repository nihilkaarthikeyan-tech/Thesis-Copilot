# ADR-0146: Would full-size models improve our writing? (model-size test)

**Date:** 2026-10-09 · **Status:** measured, no change made · **Asked by:** the owner

## Context

The owner asked whether Jenni's output reads better because it runs a bigger or better-tuned GPT,
and asked us to measure whether our own quality improves on full-size models: the fast tier
`gpt-4.1-mini` (Assist, citation suggestions) against `gpt-4.1`, and the strong tier `gpt-5-mini`
(outlines, edit commands, chat since ADR-0077, drafting, examiner review) against `gpt-5`. Same
Appendix A prompts and the same post-processing; only the model differs.

## Method

- `packages/ai/eval/run.ts`: `--strong-model <id>` puts side B's strong tier on another model
  (`--model <id>` already did the fast tier). Side A now has its own meter, so the summary
  reports `spentRupeesBySide` and `rupeesPerCase`. Each case prints the running ₹ total, and
  `--max-rupees <n>` stops a run at a spend.
- The comparison is blind. The judge is the harness's own judge, on the configured strong model
  (`gpt-5-mini`). It never sees model names and judges every pair twice with the order swapped. A
  preference counts only when both orders agree; otherwise the case is a tie.
- `packages/config/src/pricing.ts`: `gpt-4.1` ($2.00 in / $0.50 cached / $8.00 out per M) and
  `gpt-5` ($1.25 / $0.125 / $10.00), read off developers.openai.com/api/docs/pricing on
  2026-10-09. They were missing from the table. The page also confirms the existing `gpt-4.1-mini`
  and `gpt-5-mini` entries.
- All four ids were first proven with a one-word call each. Two probe calls were refused for
  credit; the coordinator restored the credit before the runs. No call in the runs was refused for
  quota.
- **Runs:**
  - Assist on the typed-sentence default set (15 cases).
  - Assist on `--set opener`, Start writing now (10 cases).
  - `command` on the strong tier: expand and formalise, 10 cases.
- **Spend:** ₹31.38 in all (₹11.01 + ₹9.71 + ₹10.46, plus about ₹0.2 of probes).
- **Results files** (`packages/ai/eval/results/`):
  - `assist-vs-gpt-4.1-2026-10-09-19-34.json`
  - `assist-vs-gpt-4.1-opener-2026-10-09-19-36.json`
  - `command-vs-gpt-5-2026-10-09-19-40.json`

## Results

| Set (cases) | A / B | Wins A–B–tie | Mean score A → B | Hallucinated cites A / B | Copying: 6-word runs / flagged, A vs B | Median latency A / B | ₹ per call A / B |
|---|---|---|---|---|---|---|---|
| Assist, typed sentence (15) | gpt-4.1-mini / gpt-4.1 | 3–**10**–2 | 7.27 → **8.30** | 1 / 0 | 2/3 vs 4/5 | 1.67 s / 1.81 s | 0.127 / 0.414 |
| Assist, opener (10) | gpt-4.1-mini / gpt-4.1 | 4–4–2 | 7.20 → 7.80 | 0 / 0 | 5/7 vs 5/5 | 2.09 s / 1.80 s | 0.131 / 0.654 |
| Edit commands, expand + formalise (10) | gpt-5-mini / gpt-5 | 1–3–6 | 7.70 → 7.95 | not counted (whitelisted in post-processing) | — | 4.41 s / 12.69 s | 0.106 / 0.770 |

**Assist, typed sentence.**
- `gpt-4.1` wins clearly.
- It cited every sentence it wrote (29 of 29, against 18 of 28), never leaned one citation over
  several sentences (0 shared, against 10), and used fewer intensifiers (1, against 6).
- Its sentences carry more specific figures and trial details. The judge's reasons name exactly
  that.
- It copies a little more: four outputs with a six-word run shared with a source, against two.
  Five flagged outputs, against three.
- Neither model offered nothing.

**Assist, opener.** Even: 4–4–2, and a +0.6 mean that is within one or two verdicts.
- `gpt-4.1` opened in the thesis's own place more often: 7 of 10 first sentences, against 5.
- Its cost per call is the highest of any set, at 5× the mini.

**Edit commands.** Six ties, with a +0.25 mean. Each side had one call fail the COMMAND schema,
which scored that pair 1.5 against 9:
- The `mhealth-diabetes-expand` failure was `gpt-5`'s (the loss).
- The `microfinance-women-expand` failure was `gpt-5-mini`'s (one of the wins).

Without those two pairs it is 2–0–6 for `gpt-5`. That is a small gain, at 2.9× the latency and
7× the cost per call. The judge here is `gpt-5-mini`, side A's own model, so any self-preference
would favour A; it still did not prefer A.

## The cost side (cost model)

`computeMonthlyBudget('STUDENT_MONTHLY', { models })` gives the fully active student's worst case,
using COSTING.md's call counts:

| Configuration | ₹/student/month | Extra |
|---|---|---|
| Today (`gpt-4.1-mini` / `gpt-5-mini`) | 145.62 | — |
| Assist only on `gpt-4.1` | 347.69 | +202.07 (540 calls × ₹0.47 instead of ₹0.09) |
| Fast tier on `gpt-4.1` (Assist + citations) | 366.04 | +220.42 |
| Strong tier on `gpt-5` | 478.10 | +332.48 (chapter builds ₹135.62, lit review ₹86.94, examiner ₹62.98, viva ₹55.79, chat ₹36.38) |
| Both | 698.52 | +552.90 |
| Drafting only on `gpt-5` | 156.76 | +11.14 |

## Answer to the owner's question

**Partly.** A bigger fast model does write better mid-paragraph Assist suggestions. It is more
specific, and it cites every sentence. So model size is part of the gap the owner sees against
Jenni on that path.

It makes no measurable difference to the first sentence of a new thesis. A bigger strong model
makes only a small difference to edit commands.

## Decision

**Keep both tiers as they are.** Production model ids and `.env` are untouched.

- **Strong tier.** The gain from `gpt-5` is small. It is nearly three times slower, and it would
  add ₹332 a month at the worst case.
- **Fast tier.** The quality gain is real, but it sits on the highest-volume action. Moving
  Assist alone adds ₹202 a month at the worst case, twice the ₹100 ceiling.
- **Drafting.** A draft-only switch to `gpt-5` (+₹11) has no evidence behind it. The edit-command
  result suggests the gain would be small, so it is not recommended without its own draft run.

**Worth trying instead (not built, needs the owner's word):** much of what the judge rewarded in
`gpt-4.1` can be stated as rules and checked in code:
- one citation per sentence, never shared across sentences;
- no intensifiers;
- a concrete figure or finding from the cited passage.

An Assist prompt candidate that asks `gpt-4.1-mini` for these, judged on the same 15 cases, costs
about ₹10. A plan-level option, `gpt-4.1` Assist only on a dearer paid plan, is a pricing decision
for the owner.
