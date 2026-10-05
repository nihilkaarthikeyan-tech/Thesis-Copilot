# 0075 — The copying round: Assist and Draft paraphrase, and B8 stays out of the prompt

Date: 2026-10-05
Status: accepted (agent, under ADR-0038 and ADR-0059; see "For the owner" below)
Follows: the side-by-side study (`docs/research/side-by-side-2026-10-05.md` §4, §7; items B8, C5)
and ADR-0071, which *flags* copying but does not prevent it.

## Context

On production, Assist offered two sentences that reused Bagla (2026) almost word for word
("informational gaps, procedural complexity, structural limitations, and perceived financial
risk"), with one citation covering both sentences and a "significantly" A.1 already forbids. A
section draft opened "This chapter presents…". Jenni offered an opening sentence before the
student typed anything (B8).

ADR-0038: a prompt changes only when a candidate wins a side-by-side round on the real models.

## The round

- **Cases** (`eval/run.ts --set copying`): the 15 Assist cases of the earlier rounds (five theses,
  five fields, real OpenAlex abstracts), the production case (Karnataka rooftop solar: six real
  Crossref abstracts led by Bagla 2026, plus the one sentence of Bagla p. 11 we hold verbatim from
  ADR-0071's test), and one **empty section** per thesis (the heading only, as the editor sends it):
  24 Assist cases. Draft: the six theses' sections.
- **Models:** `AI_FAST_MODEL=gpt-4.1-mini` (Assist), `AI_STRONG_MODEL=gpt-5-mini` (Draft and the
  judge). Both sides through production's builders and post-processing.
- **Measured in code** (`eval/copying.ts`), on what the student would see: the longest run of words
  shared with any passage (ADR-0071's `longestCommonRun`, quotations left out) — outputs with a run
  of 6+ and of 8+; whether production's `closeToPassages` flag would show; sentences carrying their
  own citation; intensifiers no passage uses; self-describing sentences; hallucinated citations
  (before the whitelist); empty answers.
- **Usefulness:** the earlier rounds' blind judge, both orders, a win only when both agree. The
  judge was **not** told about copying, so it is an independent guard on quality, not a second
  count of the same thing.

## Results

Assist, adopted candidate (`eval/candidates/assist-copying3.md`; its first judged run was the
near-identical `assist-copying2`, which differs by one clause, below). Judged runs pooled, 72 pairs:

| Measure | Current | Adopted |
|---|---|---|
| Outputs with a 6+ word run from a passage | 24 of 70 | 13 of 72 |
| … with an 8+ word run (ADR-0071's verbatim bar) | 10 | 3 |
| Would be flagged by `closeToPassages` | 40 | 19 |
| Sentences carrying their own citation | 94 of 131 (72%) | 101 of 136 (74%) |
| Intensifiers no passage uses | 21 | 15 |
| Hallucinated citations (stripped) | 4 | 1 |
| Empty answers | 2 | 0 |
| Judge: wins / ties | 21 | 20 (31 ties) |
| Judge: mean score | 7.59 | 7.54 |

The pooled runs are `assist-copying2-copying-2026-10-05-10-00` (48) and
`assist-copying3-copying-2026-10-05-10-09` (24), both after the code fixes below. The earlier
judged run `…-09-48` is left out: its judge failed on every Karnataka case (a harness fault, now
fixed) and it predates the fixes.

A measure-only run of the adopted text (48 answers) agrees: 6+ runs 11, 8+ runs 0, flagged 15,
hallucinated 0, empty 0 — against 14, 5, 24, 1, 0 for the current prompt's measure-only run.

Draft, adopted candidate (`eval/candidates/draft-copying2.md`), 12 pairs:

| Measure | Current | Adopted |
|---|---|---|
| Drafts with a 6+ / 8+ word run | 11 / 9 | 7 / 4 |
| Flagged by `closeToPassages` | 11 | 8 |
| Mean longest run | 9.75 words | 6.75 words |
| Sentences carrying their own citation | 127 of 157 (81%) | 122 of 161 (76%) |
| Intensifiers / hallucinated / empty | 13 / 0 / 0 | 12 / 0 / 0 |
| Judge | 3 wins, 8.29 | 4 wins (5 ties), 8.40 |

## Decision

1. **Assist (A.1)** gains, as its first constraint, "Paraphrase; never copy": six or more
   consecutive words from a passage are the author's words and are copying without quotation
   marks, even when cited; change the sentence's structure, verbs and order; keep technical terms,
   names and every figure exact; quote a short phrase when the exact words matter. A worked example
   from a field outside the evaluation (groundwater), and "compare each sentence with the passage it
   cites before answering". The citation rule now says each finding sentence ends with its own
   marker. The intensifier rule names the usual words and asks for the size of the effect instead.
2. **Draft (A.2)** gains the same paraphrase rule, without the example. Nothing else changed.
3. The reason the rule gives is **attribution**, not a similarity check. `assist-copying2` said "an
   examiner's similarity check will flag them"; that reads as advice on getting past a checker,
   which §12.3 rules out, so the adopted text says the words "are still the author's words". Its
   copying measures matched v2's within noise. Nothing here rewrites a student's text or scores it
   against a checker; the model is asked to write original, attributed prose in the first place,
   and ADR-0071's flag still runs on every answer.
4. **B8 is not a prompt change.** Both prompts already offer an opening on an empty section when
   the library has passages. In the first measured run all 12 of the current prompt's
   empty-section answers had words, but on the Karnataka case both were uncited (one claimed
   "similar studies … highlight…", one was cut off by the token limit). The adopted prompt's 12
   all had words and 11 carried a citation; the twelfth lost its marker to the token limit
   ("…{{cite:S3#c1"), which fault 2 below now closes. The two B8 candidates did worse:
   - *a framing opener* (an uncited sentence "making no factual claim"): on the rooftop theses the
     model copied the prompt's own example sentence word for word, and that sentence ("Households
     … still meet obstacles …") is itself a claim; on the others it was ignored;
   - *a cited topic sentence*: one empty answer and three answers cut off by the token limit.
   "Never an unsupported factual claim" could not be kept with an uncited opener, so none is
   allowed. What B8 still needs is the editor asking for a suggestion on an empty paragraph under
   a heading, which is a product change, not a prompt one.
5. Not adopted: `assist-copying` (v1: copying unchanged, 6+ runs 16 against 14), `assist-copying4`
   (an extra "keep every figure" sentence: judge 10–8 for the current, no copying gain over v3),
   `draft-copying` (also one marker per sentence and a content-first opener: copying better, but
   the judge preferred the current prompt 4–1, finding the drafts shorter and list-like).
6. Self-describing openers: **none** in any run, either prompt. The production "This chapter
   presents…" came from the draft working on contents-page chunks, which ADR-0071 fixed; no opener
   rule was needed.

## Faults the round found in code (fixed, with tests)

1. **A suggestion under a heading vanished.** `filterSentences` compared the answer with every
   line of `before`, including the section heading. An on-topic sentence shares the heading's
   words, so it was dropped as the heading's "duplicate" and the student got nothing — in the
   empty-section case (B8's case) and anywhere under a heading of five content words.
   `isHeadingLine` now leaves whole short lines without a sentence end out of the comparison.
2. **A cut-off answer reached the student.** At A.1's 120 tokens about one answer in ten stopped
   mid-sentence, sometimes inside a marker ("…{{cite:S6#c"), so a half sentence without a citation
   was shown, with the broken marker as raw text. `dropUnfinishedTail` closes an unclosed marker
   whose id is exactly one passage in the request (only the braces were lost), removes any other,
   and removes an unfinished last sentence when a finished one precedes it. Grounding is
   unchanged: a closed marker still goes through the whitelist.

## Consequences

- Copying is roughly halved at the source; ADR-0071's flag remains the backstop, and it still
  fires (3 of 72 Assist answers kept an 8+ word run).
- Usefulness is unchanged within the judge's noise (the same current prompt scored 7.39 and 7.98
  in two runs of the same cases). The judge rewards precise detail, and paraphrase sometimes rounds
  a figure ("nearly half" for 45.8 per cent); the prompt says to keep figures exact.
- Draft's share of sentences carrying their own citation fell from 81% to 76%. One citation per
  claim in drafts remains open: the one candidate that enforced it lost on usefulness.
- Cost of the round: about ₹95 of model calls (₹87.70 recorded in the result files, ₹6.39 for a
  misfired first run whose flags were not passed, and a run stopped after a minute).

## For the owner

The Assist change is adopted on the copying measures with usefulness a tie (21 wins to 20), not a
judge win as in round 1. If a tie on the judge should keep the current prompt, revert
`packages/ai/prompts/assist.md` to its 2026-09-30 block; the code fixes stand either way.
