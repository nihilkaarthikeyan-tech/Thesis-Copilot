# 0066 — More edit actions on a selection

Date: 2026-10-04
Status: accepted
Follows: ADR-0059 (row 49).

## Context

A.11 gives five section commands (expand, formalise, simplify, shorten, consistency). Jenni offers
seventeen. The ones a thesis writer actually reaches for that we lacked: softening an overclaim,
firming up a needlessly hedged cited claim, active voice, past or present tense for reporting, and
a counter-argument. A.11's prompt does not describe them, so they need their own.

## Decision

- Six actions — **hedge, direct, active, past, present, counter** — in a new prompt,
  `packages/ai/prompts/edit.md` (NOT FROM PRD APPENDIX A). They run through the exact path the five
  section commands use (`buildCommandRequest` picks `edit.md` for them), so they share the
  diff-and-Replace screen, Try again, Insert below, the COMMAND allowance and every check:
  `postProcessCommand` strips any citation not in the selection or the passages sent, and reports
  any citation the rewrite dropped.
- `counter` is sent the retrieved passages (as `expand` is) and may cite only those; the others are
  sent none and may add no citation.
- `direct` is offered only on a selection that carries a citation — firming up an uncited claim is
  how a thesis overclaims.
- Not built: "to table" (needs structured output into a table node) and "translate" (the document
  language, §2.2, already governs what the model writes; translating the student's own text brushes
  §12.3). Revisit with evidence.

## Evaluation (2026-10-04, gpt-5-mini)

`packages/ai/scripts/eval-edit-actions.ts`: 3 agent-written thesis passages × 6 actions.

- Round 1: 18 of 18 kept every citation and invented none, but `active` dropped the student's own
  hedge ("It could perhaps be argued that") and missed the one passive sentence with a named doer,
  and `direct` changed tenses it was not asked to.
- The prompt gained two rules — only hedge/direct touch qualifiers, only past/present touch tense —
  and a worked example for `active`.
- Round 2: grounding still 18 of 18; `direct` kept tenses; `past` left the arguing phrase in the
  present; `active` turned "Interviews were conducted by the researcher" into "The researcher
  conducted interviews" and kept the hedge, in 3 of 3 reruns (one earlier run returned output that
  failed the schema, which the service already reports as a failed call). About 1,150 tokens a call.

## Cost

Within the COMMAND allowance; caps unchanged.
