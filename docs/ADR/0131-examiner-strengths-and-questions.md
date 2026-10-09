# 0131 — Strengths and questions for the author on the examiner review: built, evaluated, not shown

Date: 2026-10-09
Status: accepted — the candidate is **not wired**; it failed its evaluation round (below).
Jenni build plan "What remains" (a) item 4; coverage map row 55. Extends ADR-0056 (examiner
review of a chapter), follows ADR-0111 (the score card, also evaluated and withheld).

## Context

Jenni's peer review ends with what the paper does well and the questions a reviewer would put to
its author. Our examiner review (ADR-0056) reports issues only: `examiner.md` says "do not
praise". Row 55 stays PARTIAL for want of strengths, questions and ratings (ratings: ADR-0111).

## Decision

**The design.** No new call and no new allowance: the review of a whole chapter already makes one
strong call per section (at most eight), so each call is asked for a few strengths and questions
as well, inside the same `EXAMINER_REVIEW` unit.

- **A new prompt, `examiner_review.md`.** `examiner.md`'s issues part word for word (one line
  changed: `Return "issues": [] only if…`, since the answer now has three lists), plus a strengths
  part and a questions part, plus two lines holding the issues' strictness: find the issues first
  as if nothing else were asked; a strength never makes a blocking issue a warning. The chapter
  build keeps `examiner.md` unchanged. A review of a selection (ADR-0067) would keep it too.
- **The ask.** Each section's request carries `<ask strengths="N" questions="M"/>`: four
  strengths and five questions, plus one spare of each, dealt over the sections, larger first
  (`askPlan`). The chapter keeps at most four and five, taken from its sections in turn
  (`pickHighlights`), skipping a question on the same point as one already taken.
- **Checked in code** (`packages/ai/src/builder/examiner-highlights.ts`), never trusted:
  - a strength is kept only if its `quote` is found, as words, in a sentence of the section (it
    is pinned to that sentence, with its positions, so "Go to" works), not on a sentence with a
    blocking issue, and one per sentence; its reason loses passage ids and citation markers;
  - a question is kept only if it ends with "?", is at most 60 words, names no passage id, shares
    a content word with the section (not a generic one: "chapter", "evidence", "thesis"…), and
    every year and "Name et al." in it appears in the section or its passages.
- **Schema** `examinerReviewSchema`: no `.default()`, no `.max()` (OpenAI strict mode); bounds
  in code. `maxTokens` 2,600 (the examiner's 1,500 plus room; round 1's 2,000 cut off a
  50-sentence section's answer twice).
- **The wiring, built and reverted.** The worker storing `strengths` / `questions` on
  `Document.meta.examinerReviews[chapterId]`, the API view passing them on, and the Flags tab
  showing "Strengths" (quote, reason, Go to) and "Questions for the author" under the result line
  are commit `485a472`, reverted by `fd8e404`. A passing round restores them by reverting the
  revert.

## Evaluation

`apps/worker/scripts/eval-examiner-highlights.ts`, on the real models from `.env` and five
chapters of five theses in the dev database (read only): an EDM literature review (68
sentences), two mobile-banking introductions (100 and 29), an urban-heat gap analysis (6
sections, 43) and a rooftop-solar introduction (10). Every section of every chapter is reviewed
by the old prompt and twice by the candidate. The criterion, fixed in the script before the
first run:

- **(a) issues no fewer, no worse:** pooled, the candidate's issues and blocking issues each at
  least 80% of the old prompt's; the old prompt's blocking sentences found by the candidate about
  as often as by the old prompt's own second run (cross recall ≥ self recall − 0.10);
- **(b) every strength points at the chapter:** every kept quote re-checked against the plain
  text of its sentence; at least two strengths per chapter in every candidate run; at least 70%
  of the raw strengths survive the code;
- **(c) questions are about the chapter:** every kept question names a content word of the
  chapter; at least three per chapter in every candidate run; at least 70% of the raw questions
  survive the code.

| Round | Issues / run (old → new) | Blocking / run | Blocking recall (self → cross) | Raw strengths kept | Raw questions kept | Per-run counts | Passed |
|---|---|---|---|---|---|---|---|
| 1 | 73.0 → 71.5 | 51.5 → **39.0 (76%)** | 0.59 → 0.53 | 42/44 | 45/57 | questions 9/10 runs ≥ 3 | no |
| 2 | 71.3 → 77.0 | 48.0 → 45.0 (94%) | 0.59 → 0.53 | 37/47 | 56/60 | **strengths 9/10 runs ≥ 2** | no |

Round 1 failed on blocking issues (the candidate marked more as warnings) and on one run whose
100-sentence chapter lost a section to an answer cut off twice (schema mismatch). Round 2's
candidate added the severity line, raised the limit to 2,600 tokens, forbade passage ids in
questions and asked for one question per point; to stay inside the round budget it pooled one
fresh old run per chapter with round 1's two (the old prompt had not changed, so they are still
samples of it) and kept round 1's self recall, 0.59, as the floor. Every issue check passed.
It failed one check of 45: on the 10-sentence rooftop-solar introduction one candidate run kept
a single strength — four of its five raw strengths were dropped, on sentences with blocking
issues or not quoted exactly. That is the code doing its job (nothing unanchored was shown), but
the criterion said two in every run, and it was not changed after the fact.

What a person reading the output sees: the strengths quote real sentences and say something
specific ("Defines the primary parameters controlling recast thickness and ties the claim
directly to experimental evidence"); the questions are viva questions about the chapter's own
claims ("How do you reconcile describing the evidence as 'limited in scope and depth' with the
cited review's … nearly 10% current productivity losses?"). The faults seen: reasons naming
passage ids ("(P5)", once a trailing `{{cite:P1}}`, now cleaned in code), questions citing
passage ids (dropped in code), two sections asking the same question (now skipped in code), and
a strength praising product boilerplate in a generated gap analysis.

Found on the way, as ADR-0111 found: the old prompt's own issue lists vary run to run on the
same chapter (blocking 4 then 7 on the EDM review; self recall of blocking sentences only 0.59),
so a single run of either prompt is a weak judge of the other. One candidate run gave 15 issues
and none blocking on the EDM review where the other gave 8.

**Verdict: FAIL.** The review does not ask for strengths or questions, and nothing is shown or
spent. The prompt, its builder and tests, and the evaluation script stay for the next candidate,
which must pass the same script (`--old-runs=1` reuses round 1's old baseline).

## Cost

Nothing, unwired. Had it shipped: measured output per section call 1,126 → 1,530 tokens
(reasoning included, +404), and a system block about 600 tokens longer (cached). Priced on the
existing profile plus that margin — 8 × (6,100 in, 4,600 cached, 1,000 out) on `gpt-5-mini` —
₹1.8618 → **₹2.5334 a review**, ₹4.03 a month at the cap of 6: a fully active student
₹93.13 → **₹97.16** at the production configuration. Within the ₹100 ceiling but not the "small
margin" the plan item allowed; a next candidate should ask fewer sections (for example only the
two largest) to bring it down. The two rounds cost ₹15.28 and ₹11.71 (₹26.99).

## Next candidate (for whoever runs round 3)

- Ask the strengths of fewer, larger sections, and let a chapter show one strength when only
  one survives the code — then the criterion should say so *before* the round.
- Or a separate call after the issues (as ADR-0111's card was): the issues cannot change, but it
  is a new strong call per review (about ₹0.36, ADR-0111's figure).

## Evidence

`packages/ai/test/examiner-highlights.spec.ts` (13): the ask plan, the request, anchoring,
re-pinning, the drops, the reason cleaning, the same-point skip, the mock.
`packages/ai/test/prompts.spec.ts`: 39 prompts. The reverted wiring had
`apps/worker/test/examiner-review.spec.ts` (+3) and `apps/web/test/examiner-review.spec.ts` (+2),
all passing at `485a472`. Round logs: printed by the script; numbers above.
