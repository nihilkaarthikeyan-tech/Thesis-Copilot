# 0078 — An opening sentence before typing, and drafts that keep to their heading

Date: 2026-10-05
Status: accepted (the owner asked for both: "yes go ahead build both")
Follows: the side-by-side study re-run on the new code (`docs/research/side-by-side-2026-10-05.md`),
whose two remaining "Jenni better" items were these.

## Context

1. **Jenni offers a first sentence under a heading before the student types anything.** Ours
   offered nothing until the student typed or pressed Ctrl+/. The copying round (ADR-0075) had
   already shown our A.1 prompt writes a good first sentence for an empty section; the editor
   just never asked.
2. **A section draft under a typed heading wandered.** "Financial constraints" came back as a
   survey of every barrier, framed by the Introduction ("Why uptake is low"), and called Bagla
   2026 "this study" ("the household-friction framework used in this study"), which an examiner
   reads as the student's own framework.

Building (1) found a larger fault: **automatic suggestions had never fired in the web app.**
The student's setting (`/settings`, ADR-0053; on in production) arrives after the editor is
built, and TipTap does not rebuild an extension's plugins when its options change, so
`options.autoSuggest` stayed at its first value, `false`. Every unit test built the editor with
the option already set, so none saw it. A browser run did: typing a whole sentence sent no
request.

## Decision

**Opening sentence (editor, `@tc/ui` `ghost-text.ts`).**

- When the cursor comes to rest in an empty paragraph straight under a heading, a suggestion is
  asked for after the usual idle pause, without a keystroke. This covers a new chapter, where
  the cursor starts under its title, and a section the student or the Sections panel has just
  added.
- It is asked once per heading. A renamed heading counts as new.
- It is retried once, after 4 s, if nothing came back. The server allows one suggestion at a
  time, and one the cursor has just left is still finishing on the server for a moment. In the
  real-model run the opener was refused "already in progress" every time until this retry.
- The setting is read live (`setAutoSuggest(editor, on)`; storage over options), so it works
  in the web app.
- **Automatic requests while typing now happen only at a sentence boundary** (after `. ! ? …`)
  or in an empty paragraph, not at every pause. Each automatic request spends one ASSIST unit
  (50 a month on the trial, 180 paid). Now that automatic suggestions really fire, asking at
  every 0.8 s pause mid-sentence would have spent a trial's month in one sitting on completions
  nobody asked for. Mid-sentence, Ctrl+/ still asks.

**Drafts that keep to their heading (worker, `draft-section.ts`).**

- A typed heading no longer borrows the chapter's scope note. If a planned section of that name
  exists anywhere in the outline, its scope note is used.
- Otherwise the section's scope is the heading itself: `headingOnlyScope` — "Financial
  constraints in "<thesis title>", and only that. Every other topic, however close, belongs to
  another section: leave it out."
- That scope goes into both the retrieval query and A.2's scope note. The prompt is unchanged;
  this is the section's data.

**"This study" (`@tc/ai` `builder/own-study.ts`) — in code, not in the prompt.**

- A passage's "this study / the present paper / our research…" about its own paper is rewritten
  to "the study by Bagla 2026" before it reaches the model, in Draft (A.2) and Assist (A.1).
- Grounding, the citation-support check and the copy check all still compare against the
  stored text.
- 12% of the Karnataka library's full-text chunks say it.

## The evaluation (real models, `gpt-5-mini`; `eval/run.ts draft --set own-study`)

The `copying` set never produced the fault: its passages are abstracts. A new set, `own-study`,
drafts "Financial constraints" and "Subsidy experience" from eight real full-text chunks
(`eval/papers/karnataka-own-study.json`; four say "this study"). `ownStudy` counts "this study"
anywhere and "the study" opening a sentence (`eval/copying.ts`).

| | drafts | "this study" sentences | 8-word copied run | mean longest run |
|---|---|---|---|---|
| current prompt (two runs) | 12 | 6 | 4 of 12 | 7.7–8.0 |
| prompt rule with examples (`draft-sources`) | 6 | 0 | 5 of 6 | 11.2 |
| prompt rule without examples (`draft-sources2`) | 6 | 1 | 4 of 6 | 9.2 |
| **current prompt, passages renamed (adopted)** | 10 | 1 | 4 of 10 | 7.3 |

- Both prompt rules cut the phrase but made the drafts copy more of the papers' wording,
  undoing ADR-0075. They stay in `eval/candidates/` as losing candidates.
- Renaming in code cut it as far without changing copying.
- The one remaining sentence opens "The study's qualitative design…" right after a sentence
  naming Bagla.
- The rounds cost ₹8.60.

## Proof in the browser (real models, local stack, `e2e/_measure/side-by-side.spec.ts`)

- A new chapter offered its first sentence 31 s after opening, with no keystroke.
- Under a typed "Financial constraints", a cited opening sentence appeared 3.6 s after the
  cursor got there.
- The draft (7.5 s) kept to financial constraints, drew on three sources, closed on where they
  disagree, and contained no "this study".

## Cost

- No change to the worst case: automatic requests spend ASSIST units inside the existing caps,
  and `docs/COSTING.md` already prices every unit of every cap.
- What changes is how fast a student's allowance goes, now that automatic suggestions really
  run. That belongs with the owner's open trial-limits decision (`docs/PENDING.md`).

## Addendum (2026-10-05, evening): the same-topic run

A second recorded journey, the same thesis title in both tools ("Mobile banking and the
financial inclusion of rural women in Tamil Nadu", `apps/web/e2e/_measure/same-topic.spec.ts`),
found three faults in ours, each fixed in code with tests:

- **A draft leaned on one paper**: 12 of 14 citations to one paper from a library of four
  full-text papers. `topK` for DRAFT now holds each paper to `PER_SOURCE_CAP` (4) of the 12
  passages while another paper has candidates; a library of one paper still fills the request
  (`packages/retrieval/src/rank.ts`). Assist and chat are unchanged.
- **Citation names were broken**: "(- 2026)", "(A 2026)", "(Sri Kaliswari College et al.,
  2025)". The indexes list the authors' college as first and last author, put "-" or an initial
  in the family field, or the whole name there. `cleanAuthors` (`@tc/retrieval`) repairs them as
  Crossref and OpenAlex records come in; `peopleFirst` (`@tc/citations`) and `shortReference`
  repair records stored before it. A name only moves between fields or is dropped; nothing is
  invented, and a list with no person in it is left as it came.
- **A cited sentence calling the paper "this study"** ("This study focuses on rural women in
  Virudhunagar district {{cite:…}}") is dropped by `filterSentences` (`isCitedOwnStudy`): the
  thesis's own study is never cited to a paper. Uncited, it may be the student's and is kept.

Still open from that run: suggestions that restate a paper's **aims** without the phrase
("The study focuses on…", "This research concentrates on…"), which the renaming and the filter
do not cover. That is a prompt change with its own evaluation round (ADR-0079).
