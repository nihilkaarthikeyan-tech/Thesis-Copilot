# 0063 — An equation described in words

Date: 2026-10-04
Status: accepted
Follows: ADR-0059 (row 70). Amends the reading of §0.3 rule 6 the way ADR-0010 did.

## Context

The equation field takes LaTeX. ADR-0045 added examples, a live preview and a cheat sheet, which
help a student who half knows LaTeX. The students who first raised it do not: they know the
equation and not the notation. Jenni lets them describe it in words. Appendix A has no prompt for
this, so building it needs one.

## Decision

- A new prompt, `packages/ai/prompts/equation.md`, marked **NOT FROM PRD APPENDIX A** like
  `cite_role.md`. Strong tier, 300 output tokens, temperature 0, JSON `{ latex, reading }`.
- `POST /equations/from-words` takes the description (and the field's current LaTeX, when the
  student is changing it), consumes one **COMMAND** unit atomically before the call, and gives it
  back when the provider fails or the answer does not render — the student pays for an equation
  they can use.
- Code, not the prompt, decides what is offered: wrappers (`$ … $`, `\[ … \]`, an equation
  environment) are stripped, and the LaTeX must render in KaTeX — the engine the editor and the
  export use — or it is refused.
- Nothing is inserted. The LaTeX fills the field, the preview draws it, the plain-words reading is
  shown under it, and the student presses Apply. Flag, don't fix.
- A 30-second limit on the call (CLAUDE.md: no model call without one).

## Evaluation (2026-10-04, gpt-5-mini via `.env`)

`packages/ai/scripts/eval-equation.ts`, 14 agent-written cases (regression, statistics, calculus,
thermodynamics, a change to existing LaTeX, and one non-equation): 13 matched an accepted form
exactly; the fourteenth (sample variance) was also correct but wrote `\bigl( … \bigr)`, which the
comparison did not normalise. The non-equation ("please summarise my chapter") came back empty with
an explanation, as the prompt asks. 7,955 tokens for the 14 — about 570 a call, roughly ₹0.05.

## Cost

Within the COMMAND allowance; no cap changes. The monthly total in docs/COSTING.md does not move,
because COMMAND's allowance is already priced at its cap.
