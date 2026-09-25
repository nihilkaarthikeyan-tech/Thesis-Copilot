# ADR-0030 — Viva preparation, and the ₹100 ceiling judged at the models production runs

**Date:** 2026-09-25
**Status:** Accepted (the budget basis is the owner's decision, 2026-09-25)
**Adds:** a metered AI action the PRD does not have (`VIVA`), a table (`VivaQuestion`), two
prompts that are not from Appendix A (`viva_questions.md`, `viva_feedback.md`), and a second
basis for the Appendix E.2 cost check.

## What prompted it

The "ideas to pull further ahead" list (2026-09-25): a thesis ends in a viva, and nothing in the
product helps with it. General writing tools cannot do it well because they do not hold the
thesis; this product does.

## What it is

`/app/d/:id/viva`, linked from the thesis list and the Submit screen.

- **A question set.** Up to twenty paragraphs of the student's own prose, spread evenly across
  the chapters (`apps/api/src/modules/viva/passages.ts`), go to the Strong model, which writes up
  to eight questions an examiner could fairly ask, each naming the paragraph it is about and what
  it tests. A question naming a paragraph that was not sent is dropped and counted as
  `HALLUCINATED_CITE` (§10.6's rule, applied to passages of the thesis).
- **Feedback on an answer.** The student types what they would say. The question, its paragraph,
  up to three more paragraphs that share its terms, and the answer go to the Strong model, which
  returns a verdict (strong / partial / weak), what worked, what an examiner would find missing,
  up to two quotations from the thesis, and the likely follow-up question. A quotation is shown
  only if it is in the named paragraph word for word (`verbatimQuote`, the support check's test).

## The lines it holds

- **The student owns the thesis.** Nothing here writes to a chapter. Pending AI drafts are never
  examined on (FR-4.10: not the student's text yet). The feedback says what to cover, never the
  words to say — the prompt forbids a model answer, and the student's answer sits inside an
  `<answer>` tag it cannot close (`clean` strips the request's own tags from student text).
- **Metered and capped (§10.2).** One `VIVA` unit for a question set, one for one answer's
  feedback, taken atomically before the provider call and refunded if nothing was served. A thesis
  too short to examine (fewer than three paragraphs of 25+ words) is refused before the unit is
  taken. Caps: 30 a month on STUDENT and INSTITUTION_SEAT, 3 on FREE_TRIAL.

## The budget decision

At the PRD's reference prices (§11.1, Claude Haiku/Sonnet), the six §11.3 rows already cost
₹98.92 of the ₹100 ceiling — ₹1.08 left, which no useful viva allowance fits. At the models
production actually runs (ADR-0011: `gpt-5-nano` / `gpt-5-mini`), a fully active student costs
₹14.18. The owner was offered three options — viva on its own allowance with the ceiling judged at
the production models, viva drawing on the Chat allowance, or Assist cut to make room — and chose
the first.

So the Appendix E.2 check now has two bases (`packages/config/test/cost-model.spec.ts`):

1. **The PRD's own table** — the six §11.3 rows at the reference prices — still ≤ ₹100
   (`computeMonthlyBudget(plan, { actions: PRD_METERED_ACTIONS })`).
2. **The whole budget, viva included, at the production models** ≤ ₹100. Today ₹25.34, of which
   viva at full use is ₹11.16 (30 × ₹0.37, priced for 5,000 tokens in and 1,500 out).

A third test pins that the whole budget at reference prices is *over* ₹100, so the day it is not,
the split is visibly unnecessary. `pnpm ai:verify` checks the whole budget against whatever models
the environment configures, and `UsageService.consume`'s runtime stop at ₹100 of real spend still
holds whatever the configuration.

**The consequence:** if the strong tier is ever moved back to a Claude model, the viva cap must
come down first — at Sonnet prices one unit is ₹3.29 and thirty are ₹98.66. `pnpm ai:verify` will
say so.

Measured 2026-09-25 against the real models (`pnpm --filter @tc/ai shakedown viva`): a question
set ₹0.11, one answer's feedback ₹0.08.

## Not done

- Spoken answers. Typing what you would say is the honest minimum; speech would need a
  transcription provider, which is another vendor and another cost line.
- A saved history of question sets. The page shows the latest set; older rows stay in the table.
