# ADR-0147: Generated text reads as a careful academic writes (academic punctuation and style)

**Date:** 2026-10-10 · **Status:** backstop shipped; the prompt candidate was measured against the
criterion below (written before the runs) and **not adopted**; rounds 2 and 3 (A.1 only) not
adopted either; round 4 (A.1 v4 and the A.2 draft candidate) won the judge on every set and was
not adopted, both tracks failing on copying · **Asked by:** the owner

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

### 4. Results (2026-10-10; ₹11.54 spent, no quota refusal, no failed call)

`eval/results/assist-academic2-2026-10-10-12-08.json` (typed) and
`assist-academic2-opener-2026-10-10-12-10.json`. A is the prompt on disk, B candidate v2; both
sides after `dropConnectiveOpeners`.

| Set | Wins A–B–tie | Mean A → B | Cited sentences A / B | Stock per 1k, offered A / B | run6 A / B | Hallucinated, nothing, failed |
|---|---|---|---|---|---|---|
| Typed (15) | 3–**8**–4 | 7.13 → **8.20** | 20/28 / 26/29 (**89.7%**) | 1.17 / 1.04 | 2 / **5** | 0 both sides |
| Opener (10) | **4**–3–3 | 7.42 → 7.53 | 12/20 / 17/17 | 4.32 / **7.45** | 7 / 5 | 0 both sides |

Against the criterion: 1 fails on the opener set (3 wins against 4); 2 fails by one sentence
(89.7%); 3 fails on the opener set; 4 fails on the typed set; 5 passes. **Not adopted**; the
prompt file is unchanged. Four misses are not a narrow miss, so no extra variant was run.

What it showed:

- **The code does what the prompt could not.** The typed runs' raw outputs opened 6 (A) and 7 (B)
  sentences with the padded connective; the offered text has none, and stock phrases on that set
  fell from 6.1 and 7.8 per 1k words (raw) to 1.2 and 1.0. What remains is vocabulary
  ("crucial", "foster", "plays a vital role"), mostly on the opener set.
- **The judge prefers the citation-per-sentence shape again** (8–3–4, +1.07 on the typed set;
  shared citations 8 → 3; every opener-set sentence cited). It is the copying that holds it back.
- **The copied runs are names.** Four of B's five typed-set runs are a study's or population's
  own phrase ("pragmatic randomized controlled trial of the BlueStar", "adolescents with type 1
  diabetes"): the "keep a short technical term" and "one specific detail" instructions pull
  toward the passage's wording. A next candidate would need a rule for naming a study without
  its title, and the run6 measure may want to discount proper names; neither is done here.

## Round 3 (2026-10-10, A.1 Assist only)

Asked by the owner after round 2: keep round 2's gains (the judge's 8–3–4 and the
citation-per-sentence shape), and fix what failed it: copied study and population names, and the
framing opener on the Start-writing-now set.

### 1. Prompt candidate v3: `eval/candidates/assist-academic3.md`

Round 2's candidate with five changes, all said positively; no word to avoid is named:

- **A study is named by its marker and its finding**, not by its title, the programme or product
  it tested, or the passage's description of its own design ("one trial found…", or the finding
  with its marker). The owner's wording was "by its author/year"; the prompt on disk already tells
  the model not to write author names or years because the marker renders them, so "let the marker
  identify the study" is the same instruction in this product's terms.
- **The population is described briefly in the thesis's own words**, or left to the citation.
- **Keep as written: figures and proper names only.** Round 2's "keep a short technical term
  exactly as written" is narrowed; every other word is the writer's.
- **At an opening** (empty text, or a heading), the first sentence is the most concrete fact the
  passages report about the thesis's subject: a figure, a measured effect, or a finding in a named
  place, with its marker.
- **Things are described by what was measured or what they do**, with plain verbs, rather than by
  how important or promising they are; one finding per sentence, about thirty words.

### 2. The copying measure: names discounted, raw kept

Round 2's copied runs were partly names ("the Pradhan Mantri Surya Ghar Muft Bijli Yojana",
"BlueStar"), which the prompt itself tells the model to keep exactly as written. Counting them as
copying penalises following the instruction. `eval/copying.ts` now also reports **`run6Names`**:
outputs whose shared run with a passage holds six or more words that are *not* a proper name
(capitalised other than at a sentence start, or an all-capitals acronym), a figure (any digit), or
a word of a term the passage itself defines by an acronym in parentheses whose letters it spells
("sustainable crop residue management practices (SCRMPs)"). The words are marked by their position
in the passage (`passageTokens`), so the same word elsewhere still counts; the run must still match
word for word; the threshold is still six. Nothing else is discounted: a design phrase ("pragmatic
randomized controlled trial of the") and a population ("adolescents with type 1 diabetes", less
its digit) still count.

On round 2's stored outputs (re-measured on the raw text, no model call) the discount changes the
typed set not at all (A 2 → 2, B 5 → 5: those runs were ordinary words) and the opener set
A 7 → 5, B 5 → 4. So it removes the scheme names and acronyms and leaves the copying of ordinary
wording in. **Pass is judged on `run6Names`**; raw `run6` is reported beside it on both sides.

### 3. Pass criterion (written and committed before any run)

Runs on the production models (`gpt-4.1-mini` fast, `gpt-5-mini` judge), judged blind in both
orders, both sides post-processed by the same code:

- `run.ts assist --candidate assist-academic3` (typed-sentence set, 15 cases);
- `run.ts assist --candidate assist-academic3 --set opener` (10 cases).

Budget ₹35 in all; a quota refusal stops the round. One extra variant may be run if v3 misses
narrowly, against this same criterion. The candidate is adopted only if **all** hold:

1. **Judge**, on each set: candidate wins ≥ current wins, and candidate mean not more than 0.2
   below current.
2. **Cited sentences** ≥ 90% on the typed set (`measures.candidate.citedSentences / sentences`).
3. **Stock phrases per 1,000 words** not above current on either set, on the text the student is
   offered (`style-measure.ts --processed --file <run>`).
4. **Six-word copied runs, names discounted** (`measures.run6Names`) not above current on either
   set; raw `run6` reported.
5. **Not up** on either set: hallucinated cites, offered-nothing, failed calls.

As information only (not part of the criterion, no adoption): one draft run,
`run.ts draft --candidate draft-academic3` (the draft prompt on disk plus round 3's three writing
rules, one line each), to see whether the rules carry to the strong tier.

### 4. Results (2026-10-10; ₹14.87 spent, no quota refusal, no failed call)

`eval/results/assist-academic3-2026-10-10-13-10.json` (typed),
`assist-academic3-opener-2026-10-10-13-09.json` and, as information,
`draft-academic3-2026-10-10-13-09.json`. A is the prompt on disk, B the candidate; same models.

| Set | Wins A–B–tie | Mean A → B | Cited sentences A / B | Stock per 1k, offered A / B | run6Names A / B (raw run6) | Hallucinated, nothing, failed |
|---|---|---|---|---|---|---|
| Typed (15) | **7**–3–5 | **7.93** → 7.37 | 21/29 / 21/30 (**70%**) | 4.43 / 2.42 | 3 / 2 (3 / 2) | 0 both sides |
| Opener (10) | 3–3–4 | 7.60 → **7.95** | 15/20 / 16/19 | 7.04 / **7.87** (5 phrases each) | 2 / **3** (3 / 5) | 0 both sides |

Against the criterion: 1 fails on the typed set (3 wins against 7, mean −0.56); 2 fails (70%);
3 fails on the opener set (the same five phrases in fewer words); 4 fails on the opener set; 5
passes. **Not adopted**; `prompts/assist.md` is unchanged. The typed-set misses are not narrow,
so no extra variant was run.

What it showed:

- **Asking the model to let the marker name the study made it less specific, and the judge
  punished that.** In the seven typed pairs A won, the judge's reasons are the same each time: A
  kept the sample size (223 participants), the effect (a 50% rise in daily checks, 0.016 HbA1c
  points per day of use) or a second corroborating source, and B dropped them. v3 also replaced
  v2's "Name what was studied and how: the material, method, population, setting, conditions"
  with "Say what was found and under what conditions"; together with "describe the population
  briefly or leave it to the citation", that removed the very detail the judge rewards. Copying
  did fall on the typed set (run6Names 3 → 2), and B dropped the product name A still copied
  ("the BlueStar app", though it kept "one pragmatic randomized controlled trial"), but at that
  price.
- **Citations per sentence fell back** (round 2's 89.7% to 70%): B wrote more two-sentence
  answers whose first sentence carried no marker. The extra instructions crowd the one the mini
  followed best in round 2.
- **The opener rule mostly did not take.** The judge preferred B's openings on the mean (+0.35),
  but read side by side, most of B's first sentences are still a general statement about the
  topic ("Dried fish is a crucial form of preservation in many coastal communities…"), as A's
  are; both sides wrote "crucial" and "plays a vital role" on the same two dried-fish cases, and
  both copied the passages' own lists ("sun drying, salting, fermentation and smoking", the eight
  factor types).
- **Judge noise is large on 15 cases.** Side A, the same prompt, scored 7.13 in round 2 and 7.93
  here. A future round should run the typed set with `--samples 2` before reading a 0.2 margin.
- **Draft, as information:** the three lines on the draft path won 2–0–3 (mean 8.0 → 8.4), and
  every sentence cited its own passage (60/60 against 49/66; shared citations 17 → 0), stock
  phrases unchanged (0.46 / 0.50 per 1k), raw dashes 10 → 5, run6 3 → 4. Five topics, one sample:
  a candidate worth a proper draft round with its own criterion, not adopted here.

For a next A.1 round: keep v2 (its specificity bullet and its citation rule) and add only the
opening rule, with the study-naming rule narrowed to "not by its title or the product's name";
run with `--samples 2`.

## Round 4 (2026-10-10, A.1 Assist and A.2 Draft, two tracks)

Asked by the owner after round 3: try round 3's own suggestion for A.1, and give the draft path
the proper round its information run earned. Each track has its own criterion, written and
committed before its runs; each is adopted or not on its own.

### Track A: Assist (A.1), candidate v4 `eval/candidates/assist-academic4.md`

Round 2's `assist-academic2.md` exactly (its specificity line, "Name what was studied and how:
the material, method, population, setting, conditions, and the result", and its
citation-in-every-sentence rule), with two lines added and nothing else:

- **round 3's opening rule:** when `<text_before>` is empty or ends with a heading, the first
  sentence is the most concrete fact the passages report (a figure, a measured effect, or what was
  found in a named place), with its marker;
- **a narrowed naming rule:** "Name a study by its finding and its marker, not by its title or the
  name of the product it tested." Round 3's wider rule also told the model to leave the
  population and design to the citation, and that removed the detail the judge rewards.

Runs on the production models (`gpt-4.1-mini` fast, `gpt-5-mini` judge), judged blind in both
orders, both sides post-processed by the same code, **`--samples 2`** (round 3 measured judge
noise of ±0.8 on side A between rounds):

- `run.ts assist --candidate assist-academic4 --samples 2` (typed-sentence set, 15 cases, 30 runs);
- `run.ts assist --candidate assist-academic4 --set opener --samples 2` (10 cases, 20 runs).

Adopted only if **all** hold:

1. **Judge**, on each set: candidate wins ≥ current wins, and candidate mean not more than 0.2
   below current.
2. **Cited sentences** ≥ 90% on the typed set (`measures.candidate.citedSentences / sentences`).
3. **Stock phrases per 1,000 words** not above current on either set, on the text the student is
   offered (`style-measure.ts --processed --file <run>`).
4. **Six-word copied runs, names discounted** (`measures.run6Names`) not above current on either
   set; raw `run6` reported on both sides.
5. **Not up** on either set: hallucinated cites, offered-nothing, failed calls.

### Track B: Draft (A.2), candidate `eval/candidates/draft-academic3.md`

The file round 3 ran for information, unchanged: the draft prompt on disk plus three lines (open
each paragraph with a concrete finding with its marker; let the marker identify a study, not its
title, programme or product, or the passage's description of its design; describe a thing by what
was measured or what it does, with plain verbs). Round 3's one-sample run won 2–0–3 (mean
8.0 → 8.4), cited every sentence (60/60 against 49/66), raw dashes 10 → 5, run6 3 → 4.

Run on the production models (`gpt-5-mini` strong and judge), judged blind in both orders:
`run.ts draft --candidate draft-academic3 --samples 2` (the default set, 5 topics, 10 runs).

Adopted only if **all** hold:

1. **Judge:** candidate wins ≥ current wins, and candidate mean not more than 0.2 below current.
2. **Cited sentences** (`measures.citedSentences`) not lower than current, as a share of sentences.
3. **Six-word copied runs, names discounted** (`measures.run6Names`) not above current + 1; raw
   `run6` reported.
4. **Not up:** hallucinated cites, failed calls.
5. **Chapter-build compatibility:** the draft output schema is unchanged by the prompt (it is
   Markdown with `###` headings and `[[NEEDS SOURCE: …]]` lines, which the candidate does not
   touch), and the existing tests of the draft and chapter-build paths, including
   `unchangedSentencesKept` (`test/checks.spec.ts`, `test/academic-style.spec.ts`) and
   `test/prompts.spec.ts`, pass with the candidate in `prompts/draft.md`.

Budget ≤ ₹45 for both tracks together; a quota refusal stops the round and is reported.

### Results (2026-10-10; ₹27.47 spent, no quota refusal, no failed call)

`eval/results/assist-academic4-2026-10-10-13-33.json` (typed, 30 runs),
`assist-academic4-opener-2026-10-10-13-31.json` (opener, 20 runs) and
`draft-academic3-2026-10-10-13-32.json` (draft, 10 runs). A is the prompt on disk, B the
candidate; same models; two samples per case.

| Set | Wins A–B–tie | Mean A → B | Cited sentences A / B | Stock per 1k, offered A / B | run6Names A / B (raw run6) | Hallucinated A / B | Nothing, failed |
|---|---|---|---|---|---|---|---|
| Assist, typed (15 × 2) | 4–**17**–9 | 7.28 → **8.27** | 40/57 (70%) / 49/57 (**86.0%**) | 2.31 / 2.27 | 5 / **7** (5 / 8) | 0 / **1** | 0 both sides |
| Assist, opener (10 × 2) | 2–**13**–5 | 6.95 → **8.25** | 24/38 / 31/35 | 8.35 / **3.85** | 5 / **8** (7 / 11) | 0 / 0 | 0 both sides |
| Draft (5 × 2) | 3–**4**–3 | 7.95 → **8.20** | 97/130 (75%) / 106/108 (**98%**) | 1.46 / 0 (raw) | 4 / **7** (4 / 7) | 0 / 0 | 0 both sides |

Draft raw dashes as punctuation (before the backstop): 23 in 8 of 10 drafts (A) against 12 in
6 of 10 (B); after the backstop, 0 on both sides.

Against the criterion:

| | Track A, Assist (v4) | Track B, Draft (`draft-academic3`) |
|---|---|---|
| Judge: wins ≥ A, mean ≥ A − 0.2 | passes on both sets (17–4, 13–2) | passes (4–3, +0.25) |
| Cited sentences | **86.0% on the typed set, fails** (≥ 90%) | 98% against 75%, passes |
| Stock phrases, offered | passes on both sets | not in the criterion (0 against 1.46) |
| run6Names | **7 against 5 (typed), 8 against 5 (opener), fails** | **7 against a limit of 4 + 1, fails** |
| Hallucinated, nothing, failed not up | **one hallucinated cite against none (typed), fails** | passes |
| Chapter-build compatibility | n/a | not reached (the track failed before adoption) |

**Neither track is adopted.** `prompts/assist.md` and `prompts/draft.md` are unchanged, and
nothing changes for the student. Both candidates win the judge clearly, with two samples, so the
preference is no longer within the noise; both fail on copying.

What it showed:

- **Both candidates copy more, and the copying is the specificity the judge rewards.** Track A's
  extra copied runs are the findings the specificity line asks for, kept in the passage's words:
  "each additional day of app use corresponded with a 0.016 point decrease in", "a median of 36
  days over 14 weeks", "a pragmatic randomized controlled trial of the BlueStar mobile app". The
  draft's are lists of measured quantities and indicators in the passage's order: "a higher
  pitting potential, lower corrosion current density and lower corrosion rate than", "economic,
  social, political and psychological indicators of empowerment". The current draft prompt
  already says to keep "names of methods, materials, measures" exactly and not to repeat a list in
  the passage's order; the candidate's "open each paragraph with a concrete finding" made the
  model reach for those lists more often.
- **The narrowed naming rule did not stop the product name.** B still wrote "the BlueStar mobile
  app" with the trial's own design phrase in one of the two diabetes-3 samples, and the design
  phrase in another. A rule about naming does not outweigh "Name what was studied and how".
- **The opening rule copies the passage's own first sentence.** On the opener set, B's openings
  are concrete, and the judge preferred them 13–2 (+1.30); but the most concrete sentence in a
  fresh paper's abstract is often its first, and B restated it nearly word for word: the
  fish-drying definition ("aquatic animals preserved using simple techniques such as sun drying,
  salting, fermentation and smoking", 17 words), "crop residue burning in Indian Punjab emits
  particulate matter" (both samples), the eight solar-adoption factor types (11 words).
- **The citation rule still stops short of 90% on the mini.** 86.0% with two samples (round 2:
  89.7% with one). The misses are the same shape as before: a first sentence of mechanism with no
  marker, then the marker on the second.
- **On the draft path the three lines do what they were meant to:** every sentence but two cited
  (shared citations 33 → 2), stock phrases 6 → 0, raw dashes 23 → 12, intensifiers 14 → 4, and
  the judge's win. The judge's reasons for A's three wins are synthesis ("reads like a finished
  literature-review section: it synthesises findings across studies"); for B's four, specificity
  (graphite grades, ANOVA results, effect sizes). The one obstacle to adoption is copying of
  measure lists.

For a next round, if the owner wants one: the copying measure and the specificity rules are now
the binding constraint on both paths. Either a paraphrase instruction aimed at lists ("when a
passage lists several measures or factors, name the two that matter for the point, in your own
order") added to these same candidates, or a decision by the owner on whether a run made of a
passage's measured quantities ("lower corrosion current density and lower corrosion rate") is
copying at all. That second question is a change to the measure, not to a prompt, and is the
owner's to make; it is not made here.

## Round 5 (2026-10-10, A.1 Assist and A.2 Draft, two tracks)

Asked by the owner after round 4, in two words: "fix this". Round 4's candidates won the judge on
every set and failed on copying, on the typed set's cited sentences (86%) and on one hallucinated
cite.

### 1. The measure: `run6Figures` (the owner's decision, delegated under ADR-0059)

Round 4 left one question to the owner: whether a run made of a passage's measured quantities is
copying. The owner settled it ("fix this", delegating the wording of the rule under ADR-0059): a
six-word run counts as copying **unless its words are a figure with its unit and the name of the
quantity measured** ("a 0.016 point decrease in HbA1c"). Citing a figure exactly is normal
academic practice. Ordinary phrasing, a list of findings in the passage's order, a product or study
name, and an abstract's own sentence all still count.

`eval/copying.ts` now reports **`run6Figures`** beside `run6` and `run6Names`
(`passageFigureTokens`, `test/copying-figures.spec.ts`). The words discounted, by position in the
passage, are the figure (tokens with a digit), up to three units or counted nouns after it ("per
cent", "mg per day", "223 participants"), one direction or comparison word ("decrease", "lower",
"mean"), then "in"/"of" and up to three words of the quantity's name; before it, an article, a
currency or statistic symbol ("Rs 500", "p 0.05"), or up to two linking words ("of", "by", "of
about") and up to three words of the quantity's name. A quantity's name stops at a function word.
**Proper names are not discounted** (that is `run6Names`, which stays reported). As with
`run6Names`, the remaining words of a run are counted against the threshold of six, so a figure
phrase does not excuse the ordinary words around it.

`run.ts --remeasure <file>` re-runs production's post-processing on a stored run's raw outputs and
measures them again (no model call; it reproduces round 4's stored `run6` and `run6Names`
exactly). Round 4, re-measured:

| Set | run6 A / B | run6Names A / B | run6Figures A / B |
|---|---|---|---|
| Assist, typed (15 × 2) | 5 / 8 | 5 / 7 | 4 / 6 |
| Assist, opener (10 × 2) | 7 / 11 | 5 / 8 | 7 / 11 |
| Draft (5 × 2) | 4 / 7 | 4 / 7 | 4 / 7 |

So the measure alone does not pass round 4's candidates: their extra runs are ordinary phrasing
around a figure ("showed that each additional day of app use corresponded with"), the product and
design phrase ("a pragmatic randomized controlled trial of the BlueStar mobile app"), lists in the
passage's order ("a higher pitting potential, lower corrosion current density and lower corrosion
rate than", the eight factor types) and an abstract's first sentence ("defined broadly as aquatic
animals preserved using simple techniques such as sun drying, salting, fermentation and smoking").
Those are what the prompt lines below address.

### 2. Track A: Assist v5 `eval/candidates/assist-academic5.md`

Round 4's v4 exactly, plus the owner's three lines, word for word:

1. "Put each finding in your own sentence order; when the passage lists several results, say what
   they show together rather than repeating the list."
2. "Name the intervention by what it does (e.g. a diabetes self-management app), not by its
   product name."
3. "Open an empty section with the fact itself in your own words, not the abstract's first
   sentence."

and one citation line, for the ≥ 90% the owner asked for: "One sentence, one marker inside it:
every sentence you write, the first as well as the second and a sentence that explains a mechanism
or a cause, holds its own {{cite:ID}} before its full stop, with the id copied from the passage's
id attribute (such as S1#c1). When only one sentence has a passage behind it, write that one
sentence." (Round 4's misses were a first sentence of mechanism with no marker; its one
hallucinated cite was `{{cite:Huis et al. 2017}}`, an author name in the marker.)

Runs on the production models (`gpt-4.1-mini` fast, `gpt-5-mini` judge), judged blind in both
orders, both sides post-processed by the same code, `--samples 2`:

- `run.ts assist --candidate assist-academic5 --samples 2` (typed set, 15 cases, 30 runs);
- `run.ts assist --candidate assist-academic5 --set opener --samples 2` (10 cases, 20 runs).

"Current" is side A of the same run (the prompt on disk). Adopted only if **all** hold:

1. **Judge**, on each set: candidate wins ≥ current wins, and candidate mean not more than 0.2
   below current.
2. **Cited sentences** ≥ 90% on the typed set (`measures.candidate.citedSentences / sentences`).
3. **Stock phrases per 1,000 words** not above current on either set, on the text the student is
   offered, after code (`style-measure.ts --processed --file <run>`).
4. **`run6Figures`** not above current on either set; `run6` and `run6Names` reported on both
   sides.
5. **Hallucinated cites**: 0 for the candidate on both sets.
6. **Offered-nothing and failed calls** not above current on either set.

### 3. Track B: Draft `eval/candidates/draft-academic5.md`

Round 4's `draft-academic3.md` exactly, plus the owner's three lines (1)–(3) above, word for word.
Run on the production models (`gpt-5-mini` strong and judge), judged blind in both orders:
`run.ts draft --candidate draft-academic5 --samples 2` (5 topics, 10 runs). Adopted only if **all**
hold (round 4's track B criterion with `run6Figures` for `run6Names`):

1. **Judge:** candidate wins ≥ current wins, and candidate mean not more than 0.2 below current.
2. **Cited sentences** not lower than current, as a share of sentences.
3. **`run6Figures`** not above current + 1; `run6` and `run6Names` reported.
4. **Not up:** hallucinated cites, failed calls.
5. **Chapter-build compatibility:** the output schema is unchanged by the prompt, and the existing
   tests of the draft and chapter-build paths (`test/checks.spec.ts`, `test/academic-style.spec.ts`,
   `test/prompts.spec.ts`, and the API's draft and chapter-build specs) pass with the candidate in
   `prompts/draft.md`.

### 4. Rules of the round

Budget ≤ ₹50 for both tracks; a quota refusal stops the round and is reported. A track that misses
**narrowly** (exactly one item fails, by one output or one win, by ≤ 2 percentage points of cited
sentences, or by ≤ 0.1 of mean score) may try **one** more variant, against this same criterion,
with its change recorded here before its run. A passing prompt goes into `prompts/assist.md` or
`prompts/draft.md` as a departure from Appendix A under ADR-0059, with the tests pinning prompt
text updated.
