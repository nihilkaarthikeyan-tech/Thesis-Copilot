# 0140 — The opener of an empty section is one sentence

Date: 2026-10-09
Status: rejected — the candidate failed the criterion fixed before the round; nothing changes in
production
Follows: ADR-0038 (prompts change only by evaluation), ADR-0078 (the opener), ADR-0082 (an
instruction sent through A.1's own `<instruction>` slot), ADR-0135 (`--set opener`).

## Context

Jenni's first suggestion on a new document is one short sentence set in the thesis's own place,
for example "The integration of rooftop solar photovoltaic systems is essential for Karnataka to
achieve energy autonomy and address the escalating electricity demands of its rural populace
(Kawle, 2025)." Ours, A.1 in an empty section (the editor's opener, ADR-0078), is a long
paragraph.

Measured on the stored rows of the last round, no new call: ADR-0135's 20 current-prompt opener
outputs (`eval/results/assist-setting-opener-2026-10-09-11-09.json`) are **all** two sentences,
median 71 words, first sentences 21–44 words (median 33). Only **5 of 20** first sentences carry
a citation: the model usually puts one marker at the end of the second sentence.

## Where the length comes from

- `ASSIST.maxTokens` is 120 for every Assist call; the opener uses all of it on two sentences.
- A.1 says "Write at most two sentences"; step (3) of the post-processing cuts after the second.
- Nothing tells the model that an empty section wants one.

## What is enough in code alone, and what is not

Cutting the opener after its first sentence (step 3 with a limit of one) would make every opener
one sentence, but on the stored rows it would leave **15 of 20 uncited** and many over 35 words.
A code-only cut fails the brief. A lower `maxTokens` would cut sentences mid-way
(`dropUnfinishedTail` then drops them), which is worse.

## Change (candidate)

All in code; `assist.md` (A.1) is not edited, so every continuation request stays byte for byte
as it was:

1. `isSectionOpener(before, after, section)` (`packages/ai/src/builder/assist.ts`): the cursor is
   in an empty paragraph straight under the heading the editor names as `cursorContext.section` —
   `before` ends with that heading and "\n", and nothing follows on the cursor's line.
2. For an opener, `OPENER_INSTRUCTION` goes in A.1's `<instruction>` slot (as ADR-0082's
   rewording instruction does), ahead of any guided instruction:
   > The section is empty, so this is its opening sentence. Write one sentence only, of 20 to 35
   > words: the central finding the passages report on this thesis's own subject, in its own
   > setting where a passage covers it, ended with its citation marker.
3. Post-processing step (3) cuts an opener after its first sentence (`maxSentences: 1`).

The words of the instruction are model-facing, so this is evaluated as a prompt change would be.

## The round

Real models (Assist `AI_FAST_MODEL`, judge `AI_STRONG_MODEL`), production's post-processing,
the judge unchanged (its opener task text still says "the first sentence or two"; it is not told
the opener should be short), each pair judged twice with the order swapped. Side A: today's code.
Side B: `--opener-mode`, the same prompt file with the three changes above, the detector run on
each case's own `before` and heading.

- **`--set opener --samples 2`**: ADR-0135's five fresh libraries, `chapter1` and `titled`
  retrieval, 20 runs. The commonest real path.
- **`--set copying --only empty --samples 2`**: the six named empty sections of ADR-0075's set
  (a section heading the student or the plan wrote), 12 runs.
- **`--set copying`, the 18 typed-sentence cases, `--no-judge`, 1 sample**: continuations. The
  detector must leave every one alone, and then side B's request is side A's.

### Pass criterion (fixed before running)

Adopted only if **all** hold. "Openers" means the 32 runs of the first two sets together, side B,
counting only outputs that offer something.

1. **One sentence:** ≥ 90% of answered openers are one sentence.
2. **Cited:** ≥ 90% of answered openers carry a citation.
3. **Length:** median 20–35 words (markers excluded), and ≥ 80% of answered openers within 15–40.
4. **Judge not worse,** on each of the two judged sets: candidate wins ≥ current wins, and mean
   score not lower than the current's by more than 0.2.
5. **Setting not worse:** mismatched sentences (`unmarkedOtherSettings`, ADR-0135) on each judged
   set no more than the current's.
6. **No regression in code measures,** on each judged set: offered-nothing up by at most 1;
   hallucinated citations not up; outputs with a 6+-word run shared with a passage not up by more
   than 1; intensifiers not up by more than 1; failed calls not up.
7. **Continuations unaffected:** the detector fires on all 32 opener cases and on none of the 18
   typed-sentence cases (so their requests are identical by construction, also pinned by
   `test/opener.spec.ts`); on the unjudged run, answered-with-a-citation and offered-nothing on
   side B within 1 of side A (sampling noise only).

If any fails, nothing changes in production: the service is not wired, and the code stays as an
evaluated candidate.

Spend limit: ₹25 for the round.

## Result

Real models: Assist `gpt-4.1-mini`, judge `gpt-5-mini`.
`eval/results/assist-opener-mode-opener-2026-10-09-15-13.json`.

**`--set opener --samples 2`, 20 runs per side:**

| | current | candidate (opener mode) |
|---|---|---|
| judge: wins (both orders agree) | **15** | **3** (2 ties) |
| judge: mean score | **7.97** | **6.60** |
| one sentence (answered) | 0 / 20 | 20 / 20 |
| first sentence cited / answered with a citation | 5 / 20, 19 / 20 | 19 / 20, 19 / 20 |
| median words (markers excluded); within 15–40 | 67; 0 / 20 | 30; 20 / 20 |
| first sentence set in the thesis's own place or its country | 9 / 20 | 16 / 20 |
| mismatched setting sentences | **0** | **1** ("… in India, including regions like Assam …", Karnataka thesis) |
| hallucinated citations (before the whitelist) | **0** | **2** |
| outputs with a 6+-word run / 8+ | 11 / 7 | 5 / 1 |
| intensifiers | 8 | 0 |
| offered nothing / failed calls | 0 / 0 | 0 / 0 |
| detector: fired on the 20 opener cases | — | 20 / 20 |

Against the criterion: 1 (one sentence, 100%), 2 (cited, 95%) and 3 (median 30, 100% within
15–40) **pass**. 4 **fails** (wins 3 against 15; mean 1.37 lower, limit 0.2). 5 **fails** (1
against 0). 6 **fails** on hallucinated citations (2 against 0; the whitelist removed them, so
the student would not have seen them). One failed criterion is enough; the judged
`copying --only empty` run and the continuation run were not spent on, since neither could
change the outcome.

What the judge said, case by case: it prefers the two-sentence opener for its *detail* — the
named scheme (PMSGY), the second finding, the second and third source — and calls the one
sentence "accurate but terse and more generic". It preferred the candidate only where today's
opener was a generic, uncited framing of renewable energy in general (Karnataka under the
"Chapter 1" query). It also caught the candidate compressing badly twice: "reduce drying time by
up to 30%" (no such figure in Bustos 2025) and "reduces drying time" (not in Hin 2024). Asked for
one sentence of 20–35 words, the model packs a list of outcomes into it and sometimes adds one.

A run lost on the way: the first attempt (`eval/results/assist-2026-10-09-15-10.json`, ₹6.72)
was the default 15 typed-sentence cases with no opener mode, because Windows PowerShell 5.1
drops a bare `--` before a native command and `dotenv-cli` then took `--set`, `--samples` and
`--opener-mode` as its own options. Both sides sent identical requests there, so it measures only
sampling noise between two runs of today's code (wins 5–5, 5 ties; mean 7.27 and 7.67; 15 of 15
cited on both sides). Against that noise, the opener round's 15–3 is not chance. Quote it: `dotenv -e <file> '--' tsx …`.

**Cost:** ₹14.90 on the models (₹8.18 the opener round, ₹6.72 the lost run). Limit ₹25.

## Decision

1. **Not adopted.** The service is not wired; every Assist request, opener included, is what it
   was. `assist.md` is untouched.
2. `isSectionOpener`, `OPENER_INSTRUCTION`, `assistInstruction` and the `maxSentences` option of
   `postProcessAssist` stay in `@tc/ai` as the evaluated candidate (pinned by
   `test/opener.spec.ts`); with no caller passing them, production behaviour is unchanged. The
   harness keeps `--opener-mode` and the sentence measures for the next attempt.
3. What would have to change for a short opener to pass: the judge rewards detail and has no
   reason to prefer brevity, so a one-sentence opener loses to two sentences on content. Whether
   Jenni's shape is worth that is a product decision, not something this round can settle — it
   would need the owner to say that a short first sentence is the goal even at a lower examiner
   score, and a criterion written that way. A candidate that keeps the detail (the named scheme,
   the figure) inside one sentence, and a check in code that a figure in the opener appears in
   the passage it cites, are the obvious next steps.
