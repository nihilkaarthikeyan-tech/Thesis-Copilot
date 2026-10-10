# ADR-0147: Generated text reads as a careful academic writes (academic punctuation and style)

**Date:** 2026-10-10 · **Status:** backstop shipped; the prompt candidate was measured against the
criterion below (written before the runs) and **not adopted** · **Asked by:** the owner

## Context

The owner read generated thesis text and found it full of em dashes ("—"). A thesis examiner
reads that as careless: academic English punctuates with commas, semicolons, colons and
parentheses, and uses the en dash for ranges only. The owner's ask is that what the product
writes should read like a careful human academic, with Jenni's recorded output as the reference
for tone.

This is a writing-quality decision and nothing else. Nothing here is tested against, tuned for or
aimed at any detector, and no such feature exists or will (PRD §12.3). The rule is the same kind of
rule a university style guide gives.

### What makes Jenni's recorded samples read naturally

The study notes (`docs/research/side-by-side-2026-10-05.md` §4, `docs/JENNI-FULL-INVENTORY.md`
C1 and 13.6, `docs/JENNI-UX-STUDY.md` §8) record these pieces of Jenni's writing:

- "This persistent gap highlights a critical energy access issue, as rural communities continue
  to grapple with unreliable grid connectivity and limited infrastructure development (Adanma &
  Ogunbiyi, 2024)."
- A completion of the student's own half sentence: "Urban heat islands raise night-time
  temperatures in Indian cities because " → the rest of that sentence and one more, with
  (Kumar et al., 2017).
- The gap-analysis document: "This retrieval returned 77 works and 14 claims: 1 under-explored,
  1 contested, and 12 well-supported", then a table and sections.

What they have in common, and what ours often lacks:

1. **One sentence, one citation, inside the sentence.** The author-year sits before the full stop
   of the sentence it supports. Ours often put one marker after two sentences (ADR-0146: 10 of 28
   sentences on the typed-sentence set shared a citation).
2. **Punctuation a copy-editor would leave alone.** A subordinate clause ("as rural communities
   continue…", "because…"), a colon before a count, commas. No dash, no bullet, no bold.
3. **It continues the student's sentence**, mid-stream, in the student's register; it does not
   open with a connective. Ours opened 126 of 461 stored Assist outputs with "Furthermore,",
   "Moreover," or "Additionally,".
4. **Modest length**, about thirty words, and a figure where there is one (77 works, 14 claims).

Jenni is the reference for *tone*, not a word-level model: its own sample carries "critical" and
"grapple", and the study found its citation did not support its claim. Ours keeps the grounding
rules; what it takes from Jenni is the shape of the sentence.

## Decision

Two parts. The code backstop ships whatever the prompt round shows; the prompt changes only if the
candidate passes the criterion below (ADR-0038).

### 1. `academicPunctuation`, the code backstop (shipped)

`packages/ai/src/builder/academic-style.ts`. On every path that puts generated text in front of
the student, a dash used as punctuation becomes the sentence's own punctuation, and nothing else
changes:

- a pair of dashes around an aside → commas, or parentheses when the aside has its own comma, a
  list, or is a whole clause;
- one dash before a list or a short closing phrase → a colon;
- one dash between two whole clauses → a semicolon;
- one dash before "and", "but", "which", "such as", a participle, a prepositional phrase or a
  descriptive phrase → a comma;
- an em dash between two numbers → the en dash of a range.

Left exactly as written: ranges and hyphenated compounds, minus signs, citation and needs-source
markers, anything inside quotation marks (a quotation keeps its source's punctuation), code,
LaTeX, Markdown tables, rules and bullets, URLs. Devanagari and other scripts take the comma. The
function checks its own work (same letters and digits, same markers in order, every citation in
the sentence it was in; otherwise it returns the input unchanged) and is idempotent.

Wired in (`test/academic-style.spec.ts`, "the backstop on every path"): Assist ghost text
(`postProcessAssist`), draft sections and so the chapter build, the literature review build and
their fix pass (`postProcessDraft`), edit commands and the ADR-0066 edit actions
(`postProcessCommand`), chat and deep research (`postProcessChat`), guide-comment revisions
(`postProcessRevision`), tone rewrites (`postProcessTone`). Proofreading refuses a correction
that adds a dash. On a rewrite of the student's own text (commands, tone, revisions) the
student's dashes are the student's style and are kept (`academicPunctuationUnlessStudents`).

A property test runs the rule over every output the real models wrote in `eval/results`
(1,496 outputs): same words, same markers, no citation moved, idempotent, no dash left on a prose
path.

Stock phrases are counted (`stockPhrases`, `STOCK_PHRASES`) but never removed in code, because
removing a word changes the wording, and the student must see what the model wrote.

### 2. The measure, before (stored evaluation outputs, `eval/style-measure.ts`)

Counted on what the model wrote (`aRaw`, before any post-processing), side A (the prompt on disk
at the time of each run):

| Path | Outputs | Dashes as punctuation | Per output | Per 20 outputs | Stock phrases per 1k words | Of which "Furthermore/Moreover/Additionally," opener |
|---|---|---|---|---|---|---|
| Assist | 461 | 14 | 0.03 | 0.6 | 7.86 | 126 of 214 |
| Draft | 46 | 93 | 2.02 | 40 | 0.49 | 1 of 9 |
| Edit commands | 44 | 50 | 1.14 | 23 | 0.56 | 1 of 3 |
| Chat | 31 | 4 | 0.13 | 2.6 | 0.85 | 1 of 3 |
| Deep research | 11 | 6 | 0.55 | 11 | 0.35 | 0 of 1 |

After the backstop every path is at 0 dashes. The other stock words in Assist, in order:
"foster" 23, "underscores" 17, "crucial" 15, "holistic" 12, "plays a … role" 9,
"transformative" 7.

So the dash problem is the strong tier's (drafts, commands, deep research: the paths that write
paragraphs), and the stock-phrase problem is Assist's, almost entirely the padded opener.

### 3. One prompt candidate for A.1 and the draft path

`eval/candidates/assist-academic.md` and `eval/candidates/draft-academic.md`: the current prompts
with one "Style" block and one amended line each. The block combines

- the academic-style rule: no dash as punctuation, the stock-phrase list, no sentence opened by
  "Furthermore", "Moreover" or "Additionally", varied sentence length and openers, no rule-of-three
  padding, plain verbs;
- what ADR-0146's blind test showed full `gpt-4.1` does that `gpt-4.1-mini` does not: a citation
  in every sentence, placed in that sentence (29/29 against 18/28); never one citation stretched
  over two sentences (0 against 10); a specific figure, condition or name taken from the cited
  passage; no intensifiers (1 against 6).

### 4. Pass criterion (written and committed before any run)

Runs, on the production models (`gpt-4.1-mini` fast, `gpt-5-mini` strong and judge), each judged
blind in both orders by the harness's existing examiner-style judge:

- Assist, the typed-sentence default set (15 cases): `run.ts assist --candidate assist-academic`.
- Assist, `--set opener` (10 cases).
- Draft, the default set (5 topics, `--samples 2`): `run.ts draft --candidate draft-academic`.

Budget ₹60 in all; a quota refusal stops the round and is reported. The candidate is adopted for
a path only if, on that path's runs, **all** of these hold:

1. **Citation in every sentence** ≥ 90% on the typed-sentence set (`measures.citedSentences /
   sentences`, counted in code after post-processing).
2. **Dashes as punctuation** in the candidate's raw outputs ≤ 1 per 20 outputs, pooled over the
   path's runs (so ≤ 1 dash in the 25 Assist outputs; 0 in the 10 drafts), measured by
   `style-measure.ts --file` on the run's results file, before the backstop.
3. **Stock phrases** per 1,000 words down ≥ 70% against side A of the same runs.
4. **The judge:** candidate wins ≥ current wins, and candidate mean score not more than 0.2 below
   current, on each judged set of the path.
5. **Not up on any set:** hallucinated cites before the whitelist, six-word copied runs (`run6`)
   and flagged outputs, and offered-nothing.

If Assist passes and Draft does not (or the reverse), only the passing prompt changes. The code
backstop ships regardless.

## Results (2026-10-10; ₹17.28 spent, no quota refusal, no failed call)

Results files in `packages/ai/eval/results/` (the harness stamps UTC):
`assist-academic-2026-10-09-20-18.json`, `assist-academic-opener-2026-10-09-20-20.json`,
`draft-academic-2026-10-09-20-24.json`. A is the prompt on disk, B the candidate; same models.

| Set (runs) | Wins A–B–tie | Mean A → B | Cited sentences A / B | Shared citation A / B | Dashes (raw) A / B | Stock per 1k words A / B | Intensifiers A / B | run6 / flagged A vs B | Hallucinated A / B | Nothing A / B |
|---|---|---|---|---|---|---|---|---|---|---|
| Assist, typed sentence (15) | 1–**8**–6 | 7.30 → **8.23** | 19/30 (63%) / 25/29 (**86%**) | 11 / 4 | 0 / 0 | 6.8 / **11.3** | 5 / 4 | 3/3 vs **6/4** | 0 / 0 | 0 / 0 |
| Assist, opener (10) | 3–4–3 | 7.40 → 7.80 | 14/20 / 14/19 | 6 / 5 | 0 / 0 | 5.6 / **8.4** | 5 / 4 | 4/7 vs 4/6 | 0 / 0 | 0 / 0 |
| Draft (5 topics × 2) | **4**–1–5 | **8.55** → 8.30 | 92/122 (75%) / 103/127 (81%) | 30 / 24 | 13 / **7** | 0.95 / **0** | 7 / 6 | 7/8 vs 5/7 | 0 / 0 | 0 / 0 |

Against the criterion:

| | Assist | Draft |
|---|---|---|
| 1. Cited sentences ≥ 90% (typed set) | **86%, fails** (up from 63%) | not required |
| 2. Dashes ≤ 1 per 20 outputs, raw | 0 in 25, passes (A had none either) | **7 in 10, fails** (A: 13) |
| 3. Stock phrases down ≥ 70% | **up 66% and 49%, fails** | 100% down, passes |
| 4. Judge: wins ≥ A, mean ≥ A − 0.2 | passes on both sets | **1 against 4, mean −0.25, fails** |
| 5. Hallucinated, run6/flagged, nothing not up | **run6 6 against 3, fails** (typed); opener equal/down | passes |

**Neither prompt is adopted.** The prompt files are unchanged.

What the runs showed, for the next candidate (a separate round, at the owner's word):

- **A negative rule naming the word did not stop the mini writing it.** The candidate said "Do
  not begin a sentence with Furthermore, Moreover or Additionally", and the mini opened its
  second sentence with "Additionally," in 7 of 15 outputs, against 5 of 15 for the prompt on
  disk. "crucial", "significantly" and "plays a crucial role" also survived their listing. The
  next candidate should say what to write instead (open the second sentence with its subject, or
  with the condition that distinguishes it) and leave the banned words unnamed.
- **The citation-per-sentence rule moved the mini most of the way** (63% → 86%, shared citations
  11 → 4), and the judge rewarded it (8–1–6, +0.93). The misses are the ones ADR-0146 saw: a
  first sentence of mechanism with no marker, then both markers on the second.
- **Copying rose with specificity.** Asking for "the figure, condition or material from the
  passage" in every sentence produced three more six-word runs. The paraphrase rule and this one
  pull against each other on a 120-token answer.
- **On the draft path the style block cost more than it gave.** Stock phrases went to zero and
  dashes went from 13 to 7 (in 4 of 10 drafts, still), but the judge preferred the current
  prompt on 4 of 10 pairs. Its reasons for those four call the current draft "tighter and more
  focused", "more concise", and more specific in its numbers ("0.31 μm, 10^7 K/s"); the
  candidate's drafts were a little longer (4,360 words against 4,201) and no more specific. The
  dash rule alone, without the vocabulary list, is the next thing to test there; the backstop
  already removes the dashes the prompt still writes.

The backstop is what ships from this round: on every path, after it, the student sees no dash
they did not write.

## Consequences

- No AI output reaches the thesis with a dash the student did not write, on any path.
- The student's own dashes are never touched: a rewrite of a selection that used them keeps them.
- `eval/style-measure.ts` gives the dash and stock-phrase rates of any stored run without a
  model call, so a future prompt round can check the style rule as it checks copying.
- Prompts are content (CLAUDE.md rule 6): the prompt files change only on the criterion above.

## Round 2 (2026-10-10, A.1 Assist only)

Asked by the owner after round 1: keep what round 1 gained, stop the padded opener in code, and
try a prompt that says what to write instead of naming what not to write.

### 1. Code: `dropConnectiveOpeners` (ships on its tests)

`packages/ai/src/builder/academic-style.ts`, applied in `postProcessAssist` before
`academicPunctuation`. A bare "Additionally,", "Furthermore,", "Moreover,", "In addition,",
"Notably," or "Importantly," that opens a sentence is dropped and the next word capitalised. The
suggestion's first sentence counts only when the text before the cursor ends a sentence (or a
heading, or is empty); in a mid-sentence continuation the word joins the student's clause and is
kept. A later sentence of the suggestion always counts, since round 1's openers were almost all
on the second sentence. Kept as written: "In addition to…", "Notably higher…", an opener followed
by a citation marker, anything after "et al."; a mixed-case next word ("pH", "mRNA") keeps its
case; Hindi and every other script pass through. `test/connective-openers.spec.ts`.

This is the one place the product removes words the model wrote. It is allowed here because the
words carry no content (the sentence says the same without them) and because a prompt rule naming
them made them more frequent, not less. Other stock phrases are still only counted.

### 2. Prompt candidate v2: `eval/candidates/assist-academic2.md`

The prompt on disk, with round 1's citation-in-every-sentence and specific-detail rules kept, and
every negative word list replaced by a positive instruction: start each sentence with the subject
of its claim; continue a half-written student sentence directly; restate the finding in your own
sentence structure, keeping at most a short technical term verbatim, and quote longer wording in
quotation marks; give the size or direction of an effect. No word to avoid is named.

### 3. Pass criterion (written and committed before any run)

Runs on the production models (`gpt-4.1-mini` fast, `gpt-5-mini` judge), judged blind in both
orders, both sides post-processed by the same code (so both after step 1):

- `run.ts assist --candidate assist-academic2` (the typed-sentence default set, 15 cases);
- `run.ts assist --candidate assist-academic2 --set opener` (10 cases).

Budget ₹30 in all; a quota refusal stops the round. One extra variant may be run if the first
misses narrowly. The candidate is adopted only if **all** hold:

1. **Judge**, on each set: candidate wins ≥ current wins, and candidate mean not more than 0.2
   below current.
2. **Cited sentences** ≥ 90% on the typed set (`measures.citedSentences / sentences`).
3. **Stock phrases per 1,000 words** not above current on either set, counted on the text the
   student is offered (`style-measure.ts --processed --file <run>`, so after step 1 on both
   sides).
4. **Six-word copied runs** (`measures.run6`) not above current on either set.
5. **Not up** on either set: hallucinated cites, offered-nothing, failed calls.
