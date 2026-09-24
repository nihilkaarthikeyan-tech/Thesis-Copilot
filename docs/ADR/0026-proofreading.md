# ADR-0026 — Spelling and grammar, as corrections the student accepts one at a time

**Date:** 2026-09-24
**Status:** Accepted
**Adds:** a proofreading action the PRD does not have. Metered against the existing `COMMAND`
cap (PRD §11.3), following ADR-0008. Adds one prompt that is not from Appendix A
(`packages/ai/prompts/proofread.md`), as ADR-0010 and ADR-0023 did.

## What prompted it

The competitor gap list (2026-09-24) had "grammar / proofreading" as something every
general-purpose writing tool has and this product did not. A thesis is examined line by line;
spelling and agreement mistakes cost marks and credibility.

## The line this has to hold

PRD §12.3 bans humanise and detector-evasion features, ever. A proofreader is the nearest honest
thing to a paraphraser: both take the student's sentence and hand back a different one. The
difference has to be enforced, not hoped for, because the prompt is only an instruction and the
chapter text it reads is the student's (a sentence can carry an instruction too).

So a correction is shown only when **code** agrees it is a correction (`correctionSize` in
`packages/ai/src/builder/proofread.ts`). It may:

- fix a word's spelling or inflection — the same word, a few letters away ("recieved",
  "appear" → "appears"), never a number;
- put one grammar word for another *of its kind* — a/an/the, is/are/was/were, has/have,
  who/whom, this/these, less/fewer, then/than, a basic set of prepositions;
- add or remove punctuation, an article or a similar grammar word, or a doubled word;
- change spacing, hyphens and capitals.

It may not put a different word in. A synonym ("farmers" → "growers"), an inserted "not", "more"
for "less", "with" for "without", "all" for "some", a negating prefix ("significant" →
"insignificant") are refused whatever the model labels them. Refusals are counted and logged, not
shown. The one thing this cannot see is an antonym one letter away; the student reads every
correction before accepting it.

## The decision

- **`POST /proofread { chapterId, fromSentence? }`** reads the chapter's saved text in batches of
  40 sentences, up to 2,000 words a run, at the Fast tier, and returns the corrections as data.
  It changes nothing. A longer chapter is read in parts: the response says where the next part
  starts. Pending AI drafts are not read (FR-4.10: they are not the student's text yet).
- **One `COMMAND` unit a run**, charged before the first call and refunded if nothing was served
  (§11.5); a chapter with nothing to read is not charged. ADR-0008's rule is that a shared unit is
  priced for the most expensive thing that draws on it, so the run is sized to the unit rather
  than the other way round. Measured on `gpt-5-nano` over 5,004 words: 2.52 tokens in and 1.11
  out per word, on text with far more mistakes than a draft has (a ceiling). At the reference
  prices Appendix E.2's budget uses, 2,000 words then costs ₹1.40 against the unit's ₹1.41, and
  `proofread.spec.ts` fails if either side moves past the other. At real prices a run is about
  **₹0.10**.
- **In the editor**, under the Flags tab ("what should I look at before I hand this in?"): each
  correction with its kind, the struck-through words and the replacement, and **Accept**,
  **Dismiss**, **Show me**. Accept finds the words in the chapter *as it is now* (the student may
  have typed since the run) nearest to where they were read; words that are no longer there say
  so and are not applied, rather than landing somewhere else. An accepted correction is
  provenance `COMMAND` (FR-4.11). A dismissal is remembered in the browser per chapter, so a
  deliberate spelling is not offered again.
- **What the model returns is cut down to size in code.** gpt-5-nano, asked for "the shortest
  span", answered with whole sentences — once with three fixes in one. The answer is split into
  one correction per change (a word-level diff), each narrowed to whole words that occur once in
  the sentence, then labelled by what it does where the model's label no longer fits.
- **The schema is written for OpenAI's strict mode** (no defaults, no length limits). With
  defaults it fell back to JSON mode, the model invented kinds ("doubling"), and one bad label
  failed validation for a whole batch of forty sentences.

## Consequences

- The Commands allowance is shared: four a month on STUDENT (ADR-0008), two on the trial, which
  is 8,000 words of proofreading a month at most. A 50,000-word thesis needs 25 runs to be
  proofread once. Whether proofreading gets its own allowance is a pricing decision and is in
  `docs/PENDING.md` with the numbers; at real prices those 25 runs cost about ₹2.50.
- `pnpm ai:shakedown` has a proofreading case (and, belatedly, the ADR-0023 citation-support
  case), each failing when a schema-valid answer is empty — how a silent failure looks once
  defaults fill it in.
- Only English has the grammar-word lists. In another document language spelling and inflection
  fixes still pass; grammar-word swaps are refused, which errs towards showing less.
- Tests: `packages/ai/test/proofread.spec.ts` (what is a correction, splitting, narrowing, the
  mock), `apps/web/test/proofread-locate.spec.ts` (placing a correction in changed text),
  `apps/api/test/proofread.spec.ts` (metering, the cap, drafts, long chapters),
  `apps/api/test/authz.spec.ts` (another student's chapter), `apps/web/e2e/proofread.spec.ts`
  (accept, a stale correction declining, dismiss) — the last passing against the real model.
