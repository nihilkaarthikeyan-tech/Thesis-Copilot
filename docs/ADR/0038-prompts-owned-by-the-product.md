# ADR-0038: The prompts belong to the product, and are improved on evidence

Date: 2026-09-30 · Status: accepted (the owner)

## Context

Until now `packages/ai/prompts/*.md` were verbatim copies of PRD Appendix A (§0.3 rule 6/11), and
`test/prompts.spec.ts` failed on any byte of difference. That was right for building: it stopped
the agent quietly rewriting the owner's content. It is wrong for what comes next. A reviewer's
comparison with Jenni (30 September) showed our writing losing, and the owner's instruction is
plain: the 26 prompts must be at least as good as Jenni's, and better; "the PRD was for starting".

## Decision

- The prompt files are the source of truth. PRD Appendix A is kept as the history of where each
  prompt started; `scripts/extract-prompts.ts` is retired and no longer run.
- A prompt changes only when it **wins** a side-by-side test against the current one on the real
  models (`packages/ai/eval/`): the same cases, both versions, judged blind for which output a
  thesis examiner would rather read, plus measured checks (citations, empty answers, filler,
  repeats, invented citations). The results of each round go in `docs/BUILD_LOG.md`. The owner
  approved this on 2026-09-30: "change what wins and show me summary".
- What no prompt change may weaken, because code enforces it regardless of the prompt: only
  passages in the request may be cited (§10.6), nothing enters the thesis without the student's
  action, no humanise or detector-evasion feature (§12.3), and every call stays inside the caps
  and the ₹100 ceiling.

## Consequences

`test/prompts.spec.ts` no longer compares the files with the PRD. It checks that every prompt
exists, parses, and still carries the rules the code relies on (the citation form, the
passage-is-data rule), so a prompt edit cannot silently remove them.
