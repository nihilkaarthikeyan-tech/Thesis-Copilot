# 0082 — A suggestion that copies a passage is asked for again, once

Date: 2026-10-05
Status: accepted (agent, under ADR-0059; the partial list, round two)
Follows: ADR-0071 (copying flagged), ADR-0075 (the paraphrase round), the side-by-side study's
item A3 ("regenerate once or mark it as a quotation").

## Context

After the paraphrase round, about one Assist suggestion in six still shares a six-word run with
the passage it cites, and the editor flags it ("follows Bagla 2026's wording closely… put it in
your own words"). The flag is right but the work is left to the student, every time. The
side-by-side list proposed the obvious next step: when the check fails, ask once more.

## Decision

- **When `closeToPassages` flags a suggestion, Assist asks the model once more** with
  `REWORD_INSTRUCTION` in A.1's own `<instruction>` slot (the prompt file is unchanged; ADR-0038
  holds): say the same finding in your own words, no six consecutive words from any passage,
  terms and figures exact, the same citations. The student's own guided instruction, if any, is
  appended after it.
- **The rewording replaces the first answer only when it is better**: not empty, still cited,
  and no longer close (or no longer verbatim where the first was). Otherwise the first answer
  stands, flagged as before. The `done` event carries `reworded: true` and the editor says so
  ("The first answer followed a paper's wording, so it was asked for again in its own words").
- **Same unit.** The second call is logged as a second `ASSIST` row (cost is real) but takes no
  second unit: the student asked once. A failed second call leaves the first answer, flagged.
- **Flag, don't fix holds.** Nothing changes after the student has the suggestion: the rewording
  happens before `done`, and what is shown as final is what the check passed. The first text is
  streamed as ghost text and replaced at `done` as A.1's post-processing already does.
- **Drafts are not reworded here.** A draft's copying is listed in its notice per passage
  (ADR-0071) and the draft is long; a second whole-draft call would double its cost. Later, per
  flagged sentence, if the numbers ask for it.

## Cost

About one suggestion in six (ADR-0075's measure) costs a second fast-tier call: ~₹0.03 on
`gpt-4.1-mini`, +17% on the Assist line in the worst case (₹0.46 of the ₹93 monthly). Not folded
into `ACTION_PROFILES.ASSIST`; noted in `docs/COSTING.md`.

## Tests

`packages/ai/test/reword.spec.ts`; `apps/api/test/assist-reword.spec.ts` (Testcontainers: the
second request carries the instruction, the rewording is shown unflagged, one unit, two rows; a
still-verbatim rewording is not taken; a failed second call keeps the first; an answer in its
own words is not asked again).
