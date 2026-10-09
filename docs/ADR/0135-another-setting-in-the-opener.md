# 0135 — A passage from another setting, written as the thesis's own

Date: 2026-10-09
Status: accepted — retrieval change adopted; A.1 unchanged (the candidate failed the criterion
fixed before the round)
Follows: ADR-0038 (prompts change only by evaluation), ADR-0075 (the copying round and its set),
ADR-0079 (a round that found nothing to change), ADR-0092 (the first sentence of a new chapter).

## Context

Seen live on the real models, 2026-10-09. Thesis "Barriers to rooftop solar adoption among rural
households in Karnataka", Start writing now; the opener under the empty chapter offered:

> More than 70% of the Indian population resides in villages … (Pradeep 2017). In Kerala,
> abundant solar potential combined with initiatives like the SOURA subsidy program positions the
> state as a leader in rooftop solar photovoltaic adoption, yet barriers such as financial,
> informational, technical … continue to hinder widespread implementation among households
> (Mathew 2024).

The thesis is about Karnataka. The suggestion frames it with a neighbouring state's programme,
and nothing in the sentence says that Kerala is somewhere else.

## Diagnosis

**Both the passages and the prompt.**

1. **Retrieval is blind to the thesis on this path.** §10.4's query is the last sentence before
   the cursor plus the chapter's scope note (`buildQueryText`). On Start writing now the cursor
   sits under the heading "Chapter 1", and the chapter has no scope note until the plan lands, so
   the query embedded is the two words "Chapter 1". Which six of the fifteen found abstracts reach
   the prompt is close to arbitrary. On the fresh Karnataka library fetched for this round
   (`eval/papers/fresh-karnataka-solar.json`, OpenAlex, ranked as production ranks), the query
   "Chapter 1" sends papers set in Uganda, Vietnam and Uttar Pradesh and leaves the one Karnataka
   paper (Bagla 2026) eighth; with the working title in the query it is first.
2. **A.1 has only a half-rule.** "Do not … apply a finding about one material, population or
   country to another without saying so." The live sentence names Kerala, so it obeys the letter;
   nothing says a passage from another place may be used only as comparison or wider context, and
   nothing says how an empty section should open. The memory block does carry the working title,
   so the model could have known.

## Changes

1. **Code, no prompt (retrieval).** For an Assist request on a chapter with no scope note, when
   the text before the cursor ends in a heading that names no topic ("Chapter 1",
   `isGenericSectionTitle`) or in nothing, `retrievePassages` uses the thesis's working title
   (`DocumentMemory.scope.workingTitle`) in place of the missing scope note (`queryScope`). A
   chapter with a scope note, a typed sentence, chat, cite and the edit commands are searched as
   before, so the relevance floor (`isOffTopic`) never reads the title instead of the student's
   own words. Tested in `packages/retrieval/test/untitled-chapter-query.spec.ts`.
2. **A measure in code** (`packages/ai/src/builder/setting.ts`, `unmarkedOtherSettings`): a
   sentence naming an Indian state or a country that the thesis's scope does not name (a state
   thesis owns its country; a country thesis owns its states), with no comparison wording
   ("unlike", "in neighbouring …", "elsewhere", "compared with" …) and no wording of a study
   reporting its own setting ("a survey of households in Kerala found …"). The live sentence
   counts; "A survey of 400 households in Kerala found …" does not. Tested in
   `packages/ai/test/setting.spec.ts`.
3. **A prompt candidate** (`eval/candidates/assist-setting.md`): one bullet after "Stays within",
   *Keeps to the thesis's own setting*: a passage about a different state, country or population
   is evidence from there, to be named as such and used as comparison or wider context, never as
   if it described the thesis's own setting; an empty section opens with the thesis's own subject
   in its own setting (or its country), not with another place.

## The round

Real models (Assist `AI_FAST_MODEL`, judge `AI_STRONG_MODEL`), production's own post-processing,
the round-1 judge unchanged and not told about settings, each pair judged twice with the order
swapped (a preference counts only when both orders agree).

- **`--set opener`** (new, the product's commonest real path): five theses that name a place —
  Karnataka rooftop solar, Kerala solar fish drying, Tamil Nadu microfinance SHGs, Punjab crop
  residue burning, Kenya mobile money — each with a fresh 15-paper library (`eval/fetch-fresh.ts`:
  two OpenAlex searches, the title's words and the subject without the place; 2021 on; the 15
  abstracts nearest the title by the configured embedding model). The cursor under the empty
  "Chapter 1", no scope note, the memory holding only the title. Two retrieval conditions per
  thesis: `chapter1` (today's query) and `titled` (change 1). 10 cases × 2 samples = 20 runs.
- **`--set copying`** (ADR-0075's 24 assist cases: the existing typed-sentence cases, the
  Karnataka production case, and one empty section per thesis). 1 sample = 24 runs.

### Pass criterion (fixed before running)

The candidate replaces A.1 only if **all** hold:

1. **Setting.** On `opener`, fewer mismatched sentences than the current prompt (strictly), and
   on `copying` no more than the current prompt.
2. **Judge, wins or ties.** On each set, candidate wins ≥ current wins; and the mean score is not
   lower than the current prompt's by more than 0.2 on either set.
3. **No regression in code measures,** on each set: offered-nothing up by at most 1;
   answered-with-a-citation down by at most 1; outputs with a 6+-word run shared with a passage
   up by at most 1; hallucinated citations not up; intensifiers up by at most 1; failed calls
   not up.

If the current prompt produces no mismatched sentence on `opener`, the prompt is not the cause on
this evidence and stays, as in ADR-0079; the retrieval change stands on its own evidence.

Spend limit for the round: ₹25.

## Result

Real models: Assist `gpt-4.1-mini`, judge `gpt-5-mini`. Result files in `eval/results/`:
`assist-setting-opener-2026-10-09-11-09.json` and
`assist-setting-opener-kerala-measured-2026-10-09-11-11.json`.

**`--set opener`, 20 runs per side** (10 cases × 2 samples):

| | current | candidate |
|---|---|---|
| mismatched sentences (measure as committed in `fb80db4`) | 2 | 2 |
| mismatched sentences (measure after `8c64ed2`, see below) | 0 | 1 |
| first sentence set in the thesis's own place or its country | 9 / 20 | 11 / 20 |
| answered with a citation / offered nothing | 20 / 0 | 20 / 0 |
| outputs with a 6+-word run / 8+ | 10 / 5 | 9 / 7 |
| citations / cited sentences | 39 / 25 | 33 / 22 |
| intensifiers | 8 | 5 |
| hallucinated citations / failed calls | 0 / 0 | 0 / 0 |

The as-committed measure counted two of the current prompt's Kenya sentences that were honest
("For instance, adoption of mobile money in northern Ghana led to …", "… as evidenced by … in
northern Ghana"); `8c64ed2` adds "for example", "for instance" and "as evidenced" to the
marking wording, with a test. Recounted from the stored rows, without a new call, the current
prompt has 0 and the candidate 1 ("In rural Ghana, adoption of mobile money … positively
influences …").

**Criterion 1 fails either way** (2 against 2, or 0 against 1: not strictly fewer), so the
candidate cannot pass and A.1 stays as it is. The judge did not score this run: its task text
built the proposal case's paper list eagerly, which fails on a fresh topic's file (fixed in
`8c64ed2`), and with criterion 1 already failed the judged opener run and the `copying` run were
not spent on. The candidate stays in `eval/candidates/` as one that did not win.

**Diagnostic, outside the criterion: the Kerala paper in the request** (`--set opener-kerala`,
the Karnataka thesis with the pool's Kerala paper put second, as Mathew 2024 was in the live
request; 2 conditions × 3 samples, no judge): 0 mismatched sentences from either prompt in 12
outputs. Under the "Chapter 1" query neither opened in Karnataka (0/3 each; both opened on solar
energy in general, from Shakeel et al. 2023); under the titled query every output opened in
Karnataka from Bagla 2026 (3/3 each).

**What the evidence says.** In 26 real outputs the current prompt never framed the thesis with
another place, with or without a Kerala passage in the request. The live fault is rare, and its
precondition is the passages: with the query "Chapter 1" the Karnataka paper does not reach the
request, so the model opens from whatever does. The retrieval change puts the thesis's own
paper first: Karnataka openers set in Karnataka went from 0 of 5 to 5 of 5 across both sets,
for both prompts. In the other four theses the change mattered less: their pools already lead
with own-setting papers (Punjab, Tamil Nadu), or have none from the named place (the Kerala
pool has no Kerala paper; in Kenya several outputs name Kenya only in the second sentence).

Limits: the fixture pools are 2021 onwards and built by two OpenAlex searches, not the product's
model-written queries; the live library held an older paper (Pradeep 2017). The measure lists
states and countries only.

**Cost:** ₹6.81 on the models (₹5.28 the opener round, ₹1.53 the diagnostic), plus about ₹0.40
of Voyage embeddings for the fixtures. Limit ₹25.

## Decision

1. Retrieval change adopted (change 1).
2. A.1 unchanged; `assist-setting` not adopted.
3. The setting measure is reported for every assist run of the harness; it is not a production
   filter. A sentence like "In Kerala, …" is a fault only in framing, and in 26 outputs the
   current prompt wrote none, so a filter would mostly remove honest comparisons.
4. The next assist round includes `--set opener` alongside `copying`.
