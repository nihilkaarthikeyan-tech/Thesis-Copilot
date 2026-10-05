# 0084 — A tone review of written text, against the student's profile or a chosen paper

Date: 2026-10-05
Status: accepted (agent, under ADR-0059; the partial list, round two)
Follows: row 57 of `docs/research/coverage-map.md`; FR-4.7 / A.10 (the writing profile);
ADR-0026 (proofreading, whose shape this takes).

## Context

Jenni's "Tone of voice" card reviews what the student wrote against a tone, and can take a
library paper as the model. Ours learned a writing profile from the student's own text (A.10) and
let it steer suggestions, but never read back what was already written. A student who drafted
three chapters across a year, or pasted in a paragraph written in a hurry, had no way to find
the sentences that do not sound like the rest.

## Decision

- **A new prompt, `tone.md`** (not an Appendix A section; ADR-0038's rule for new prompts, as
  ADR-0026's and ADR-0030's). Fast tier, structured output: for each sentence whose tone clearly
  differs from the sample, a reason in twelve words and a rewrite. The prompt asks for a clear
  difference, not polish: an empty list is a correct answer.
- **The sample** is one of two: the student's learned writing profile rendered as a description
  (register, voice, hedging, sentence length, transitions, the voice note, their own guidance and
  the stored example sentences); or the first ~600 words of a library paper they choose, from
  its stored chunks. A paper with too little readable text is refused; no profile and no paper
  is refused before any unit, with the fix in the message.
- **Rules in code** (`postProcessTone`): the sentence is in the batch; the rewrite differs; it
  carries exactly the citation markers the sentence had; it is between 0.4 and 2.5 times the
  sentence's length. A rewrite that drops or adds a citation is a different claim, not a tone.
- **Shown as corrections, metered as COMMAND**, through the proofreading panel in a second mode
  (`mode="tone"`, under the Flags tab with a "Match: my own profile / the paper: …" chooser):
  Accept, Dismiss, Show me, Accept all, Y / N, one unit a run of up to 2,000 words, the rest on
  "Read the next part". Nothing changes until the student accepts a sentence; accepted words are
  COMMAND provenance, as proofreading's are.
- **Not §12.3.** Matching a chapter to the student's own register, or to a journal's, is the
  "formalise" family of edits, done sentence by sentence with the student reading each one. It
  is not humanising and it does not touch meaning, sources or figures, which the rules forbid.

## Cost

One COMMAND unit a run, priced as proofreading's (fast tier; ~2,000 words in, up to ~2,000
tokens of rewrites out): under ₹0.10 on `gpt-4.1-mini`. Within the COMMAND profile.

## Tests

`packages/ai/test/tone.spec.ts` (request, sample rendering, the rules, the mock);
`apps/api/test/tone-review-api.spec.ts` (Testcontainers: a paper as the sample, the profile,
refusals before any unit, the refund).
