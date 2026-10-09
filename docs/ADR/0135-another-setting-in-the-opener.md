# 0135 — A passage from another setting, written as the thesis's own

Date: 2026-10-09
Status: proposed (criterion fixed before the round; the result is recorded below it)
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

1. **Code, no prompt (retrieval).** When the chapter has no scope note, `retrievePassages` uses
   the thesis's working title (`DocumentMemory.scope.workingTitle`) in its place. A chapter with a
   scope note is unchanged. Tested in `packages/retrieval/test/untitled-chapter-query.spec.ts`.
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

(Recorded after the run.)
