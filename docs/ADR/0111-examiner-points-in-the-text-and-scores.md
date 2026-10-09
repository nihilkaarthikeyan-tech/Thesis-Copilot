# 0111 — Examiner points in the text, tagged Major / Minor; the score card evaluated and not shown

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R24; inventory §13.3; fix list 25; owner decision D2,
delegated under ADR-0059)

## Context

Jenni's peer review leaves its points in the document, each tagged Major or Minor, and ends with
scores: soundness, presentation, contribution and overall, out of ten. Our examiner review
(ADR-0056) wrote its points as flags in the side list, labelled "blocking" and "warning" (the
prompt's own words), with Go to; it gave no scores.

## Decision

- **Major and Minor.** An examiner flag is labelled "Examiner: major" (the prompt's `blocking`) or
  "Examiner: minor" (`warning`), the words an examiner's report uses. The result line says
  "N issues, M major".
- **In the text when the review finishes.** A review that finishes while the Check tab is open
  opens its points in the text through review mode (ADR-0110): each point highlighted on its
  sentence, tagged, with its explanation and suggested correction in the bar; Y resolves, N
  ignores. The points stay in the flags list, and "Review in the text" opens them again.
- **No score card, after four evaluation rounds** (below). The card was built: a new prompt
  (`examiner_scores.md`, product-owned, not from Appendix A) runs once at the end of a review of a
  whole chapter (never of a selection), inside the same `EXAMINER_REVIEW` unit, on the strong
  tier with a time limit. It reads the chapter (cut at 24,000 characters, each section keeping a
  share) and the issues the review wrote, each with its type, and grades the chapter on a fixed
  scale (9–10 ready to submit … 1–2 not yet a chapter), each score with a one-sentence reason. In
  code: any missing or non-numeric score drops the whole card; soundness is held at 6 or below
  when the review wrote a blocking issue of a soundness type; a failed or timed-out call leaves
  the review standing without a card. It failed the criterion set before its last round, so the
  review does not make the call and nothing is shown or spent. The prompt, its builder and tests
  (`packages/ai/src/builder/examiner-scores.ts`) and the evaluation script stay, unwired, as the
  starting point for a next candidate; any candidate must pass the same script first.
- **Why not show it anyway.** Students read a number as a measurement. A "Contribution 3/10" that
  did not move when half the chapter was removed would mislead the person it claims to help; the
  issue count ("N issues, M major") says what the review found without pretending to more.

## Cost

Nothing new: Major / Minor and the points in the text use what the review already wrote. Had the
card shipped, it was one strong call more per review (8k in, the 4k cached block, 500 out plus
500 for reasoning): ₹1.8618 → ₹2.2185 a review, a fully active student ₹93.13 → ₹95.27 on the
production configuration. The four rounds cost about ₹45 in all.

## Evaluation

A new prompt has no current version to beat, so the round checks what a grade must do, in code,
on four real chapters from the local database (two introductions, an engineering literature
review, a short introduction; a chapter build's pending drafts read as text), after the real
per-section examiner has reviewed each (`apps/worker/scripts/eval-examiner-scores.ts`):

- **Stable:** the same chapter and issues scored twice, every score within one point.
- **Presentation falls** when each section's sentences are shuffled and the sections reversed.
- **Soundness falls** when the chapter is made to contradict itself and the issue list says so
  (on the model's own number; "already at the floor" counts).
- **Contribution falls** when the chapter is cut to its first section.

Rounds so far (the criterion for showing the card was set before round 4: stable on all four,
and each of the three falls on at least three of four):

| Round | Prompt | Stable | Presentation | Soundness | Contribution | Passed |
|---|---|---|---|---|---|---|
| 1 | v1, no issues sent, poor chapter set | 1/2 | 0/1 | 0/1 | 0/1 | — |
| 2 | v1 with the review's issues | 4/4 | 2/4 | 3/4 | 2/4 | 11/16 |
| 3 | v2: issue types, each score its own evidence, reason first | 4/4 | 1/4 | 2/4 | 1/4 | 8/16 |
| 4 | v3: a written reading of order and coverage before scoring | 3/4 | 3/4 | 3/4 | 1/4 | 10/16 |

Round 4 failed the criterion (stable 3/4 — presentation 7 then 5 on the same solar-adoption
chapter — and contribution 1/4). Across the rounds the card was stable but mostly echoed the issue
list: presentation and contribution did not reliably fall when the order was destroyed or half
the chapter removed. The strong tier runs at low reasoning effort and ignores temperature
(`providers/openai.ts`), which fits both observations; a next candidate might try a higher effort
for this one call, priced first.

Found on the way: the existing examiner prompt returned output that did not match its schema for
one section in round 2 (the section was reported as not reviewed, as designed); and the examiner's
own issue lists vary a lot between runs on the same chapter (4 issues in round 2, 15 in round 3).

## Evidence

`packages/ai/test/examiner-scores.spec.ts` (5) pins the unwired builder: the request, the cut,
rounding into 1–10, the soundness ceiling, no card on a missing score.
`apps/web/test/examiner-review.spec.ts` (6): "Examiner: major" / "Examiner: minor" and "N issues,
M major". The browser proof of the points opening in the text is in docs/BUILD_LOG.md (R24).

## Addendum, 2026-10-09: round 5, the score call at a higher reasoning effort

**Criterion, written and committed before the run** (the owner approved real-model spend for one
round; budget for it about ₹30 of the day's ₹40).

- **The candidate.** Prompt v3 and its builder unchanged; only the score call's reasoning effort
  rises from the strong tier's `'low'` to `'high'` (a per-request option on `LlmRequest`, honoured
  by the OpenAI adapter for a reasoning model, with the thinking headroom raised to match so a
  long think cannot eat the answer). Every other call in the product keeps its effort.
- **The round.** `apps/worker/scripts/eval-examiner-scores.ts`, unchanged in its checks, on the
  four chapters it picks from the local database (ids printed with the results), with the real
  per-section examiner first.
- **Pass, all of:**
  1. every run gives a full card (a missing card is a failed check, as before);
  2. **stable on all four** chapters (every score within one point on a second run);
  3. **presentation falls** on at least three of four;
  4. **soundness falls** (or is already at the floor) on at least three of four;
  5. **contribution falls** on at least three of four;
  6. the priced review (measured tokens of the score call at `'high'`, at the production model's
     prices) keeps a fully active student under the ₹100 ceiling.
- **If it passes**, the review of a whole chapter makes the call (inside the same
  `EXAMINER_REVIEW` unit, as built) and the card is shown with its reasons; the price is recorded
  here. **If it fails**, nothing is wired, nothing is shown or spent in production, and the round
  is recorded below. One round only: no prompt changes, no second effort tried in this run.
