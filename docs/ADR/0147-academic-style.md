# ADR-0147: Generated text reads as a careful academic writes (academic punctuation and style)

**Date:** 2026-10-10 · **Status:** backstop built; prompt candidate under evaluation (criterion
below, written before the runs) · **Asked by:** the owner

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

## Results

_To be filled from the runs._

## Consequences

- No AI output reaches the thesis with a dash the student did not write, on any path.
- The student's own dashes are never touched: a rewrite of a selection that used them keeps them.
- `eval/style-measure.ts` gives the dash and stock-phrase rates of any stored run without a
  model call, so a future prompt round can check the style rule as it checks copying.
- Prompts are content (CLAUDE.md rule 6): the prompt files change only on the criterion above.
