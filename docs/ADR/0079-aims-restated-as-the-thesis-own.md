# 0079 — A paper's aims restated as the thesis's own: the round that found nothing to change

Date: 2026-10-05
Status: accepted (agent, under ADR-0038 and ADR-0059)
Follows: ADR-0078 (its addendum: the same-topic run) and ADR-0038 (prompts change only by
evaluation).

## Context

The same-topic run (one thesis title written in both tools, 2026-10-05) left one fault in ours
uncovered: by the third suggestion in a row, Assist restated what a library paper set out to do
as if it were the thesis's own — "The study focuses on rural women in Virudhunagar district…
(Mathivathana 2025)" and "This research concentrates on…". ADR-0078's renaming (`nameTheSource`)
and filter (`isCitedOwnStudy`) cover "this study" and "this research" but not "The study
focuses on…". The expected fix was a prompt rule with an evaluation round.

## The round (`eval/run.ts assist --set aims`, real models, Assist on `gpt-4.1-mini`)

- **The set.** A new topic, the same-topic run's thesis (`TAMILNADU` in `eval/topics.ts`), and
  nine real full-text chunks of its library as stored (`eval/papers/tamilnadu-aims.json`:
  Mathivathana & Alagulakshmi 2025, Sneha & Patil 2026, Sowmya 2025). Six state what their own
  paper aims to do, focuses on or where it was conducted; three report findings. Three cursor
  positions and the empty section, each asked with all nine passages (**mixed**) and with the
  six aims passages alone (**aims-only**, what retrieval returned in the real run), plus two
  **exhausted** paragraphs that already say what the aims passages say — the real condition, the
  third suggestion in a row.
- **The measure.** `aims` in `eval/copying.ts` (`statesAims`): a research noun followed in the
  sentence by a verb of intent or setting (aims, intends, seeks, set out, focuses, concentrates,
  was conducted, examines, investigates, explores…), or "focuses on"/"concentrates on" anywhere.
  It matches the three real sentences and not a finding ("adoption rose from 11.1% … to 72.2%").
- **Two candidates** (`eval/candidates/assist-aims.md`, `assist-aims2.md`): a rule that a paper's
  aims, scope or setting are not findings and are never restated; and the same with a worked
  finding and a NEEDS SOURCE fallback when every passage states only aims.

| | runs | aims sentences | 6+ word runs | flagged | cited sentences |
|---|---|---|---|---|---|
| current, mixed | 12 | 0 | 5 | 9 | 20 of 24 |
| aims (v1), mixed | 12 | 1 | 1 | 6 | 19 of 24 |
| aims2 (v2), mixed | 12 | 0 | 4 | 7 | 20 of 24 |
| current, aims-only | 12 | 0 | 4 | 7 | 21 of 24 |
| v1, aims-only | 12 | 0 | 3 | 6 | 22 of 24 |
| v2, aims-only | 12 | 0 | 5 | 8 | 22 of 24 |
| current, exhausted | 6 | 0 | 1 | 2 | 6 of 12 |
| v1, exhausted | 6 | 0 | 1 | 3 | 6 of 12 |
| v2, exhausted | 6 | 0 | 2 | 3 | 4 of 12 |

Result files: `eval/results/assist-aims*-aims-measured-2026-10-05-*.json`. Cost ₹10.69, no judge.

**The current prompt never produced the fault**: 0 aims sentences in 60 outputs over the three
conditions. With aims passages alone it wrote from the problem statement ("Rural women in
Virudhunagar district face obstacles like low digital literacy…"), and on an exhausted paragraph
it added consequence sentences rather than restating aims. The two candidates were therefore
neither better nor worse on the measure they were written for, and v1's lower copying on the
mixed set (1 run of six words against 5) reversed on the other two.

## Decision

1. **No prompt change.** Under ADR-0038 a prompt changes only when a candidate wins a round on
   the real models; nothing won. Both candidates stay in `eval/candidates/` as candidates that
   did not win, and the `aims` set and measure stay in the harness for the next round that
   touches A.1.
2. **The guard goes in code**, where ADR-0078 already put the sibling rule: `isCitedOwnStudy`
   (`packages/ai/src/builder/quality.ts`) now also drops a **cited** sentence that opens "The
   study / research / investigation / paper / review …". That is the same rule the evaluation
   measures by (`OPENS_THE_STUDY`, ADR-0078): at the start of a sentence "the study" has not
   named its source and reads as the student's own; mid-sentence ("Bagla surveyed…; the study
   found…") it has, and is kept, as is "The study by Bagla 2026 found…", the form
   `nameTheSource` writes. "This research concentrates on…" was already dropped by the
   ADR-0078 pattern. Tests in `packages/ai/test/own-study.spec.ts`.
3. **What was not reproduced is recorded, not assumed.** The real run's sentences came from the
   web app: the whole chapter before the cursor and the proposal's memory block, on passages
   retrieval chose. The harness builds the request as production does (`buildAssistRequest`,
   `nameTheSource` included) but from fixed passages and short befores. If the fault appears
   again on the site, the recorder (`e2e/_measure/same-topic.spec.ts`) saves the request's
   passages and the text before the cursor; add that case to the `aims` set before writing a
   candidate.

## Consequences

- A suggestion that opens with a cited "The study…" sentence loses that sentence; if nothing
  remains it is an empty suggestion, not charged (`EMPTY_SUGGESTION`).
- No change to cost or to the prompts. `pnpm ai:shakedown` is not needed: no provider, model
  id or schema changed.
