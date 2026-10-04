# Build plan from the Jenni study (started 2026-10-04)

Source of every item: `docs/JENNI-FIX-LIST.md` (numbers below refer to its section A) and
`docs/research/coverage-map.md`. Order: faults first, then Jenni's core flow, then the larger
features. Each item is built, tested (unit + typecheck + lint; a browser check for anything a student
sees), committed locally. Nothing is pushed or released until the owner says so.

Items that change cost or need a decision only the owner can take are listed at the end and are
**not** built until answered.

## Batch 1 — faults (no new features)

| # | Item | Status |
|---|---|---|
| 1 | Suggest / Ctrl+/ with nothing to cite: say why, offer Find papers || Done 2026-10-04 |
| 2 | Proposal related-work search: key words, not the whole conversation; retry broader; a failed search is shown as failed, not "0 found" || Done 2026-10-04 |
| 3 | When nothing was found, the model is told so in plain words (no "related work found…") || Done 2026-10-04 |
| 4 | Topic path: no "sources found in your paper" || Done 2026-10-04 |
| 14 | Proposal options as buttons the student can tap || Done 2026-10-04 |
| 5 | Breadcrumb: long title truncated, never empty || Done 2026-10-04 |
| 6 | Toolbar: Chart / Diagram labels overlap || Done 2026-10-04 |
| 7 | Editor banner: accurate (suggestions on a pause), no keyboard talk on a phone || Done 2026-10-04 |
| 8 | Sources panel refreshes when automatic sources add papers || Done 2026-10-04 |
| 9, 40 | No internal words ("Strong call", "Fast call") on student pages || Done 2026-10-04 |
| 10 | Discover shows stages and an estimate while it runs || Done 2026-10-04 |
| 11 | A friendly message, not "Failed to fetch", when the server cannot be reached || Done 2026-10-04 |
| 12 | Phone: banners collapse to one line; the text comes first || Done 2026-10-04 |
| 13 | Screen readers hear the suggestion and how to accept it || Done 2026-10-04 |
| 31 | Build: chapter label "2. Chapter 1 — …" || Done 2026-10-04 |
| 32 | Build: discipline suggestion from the field; no internal check codes; one language list || Done 2026-10-04 |
| 33 | Submit: human field names, not "studentName" || Done 2026-10-04 |
| 34 | Journals: no "No subject overlap" on every match; "you cite" only when cited || Done 2026-10-04 |
| 35 | Usage: plain names for VIVA / CHAPTER_BUILD; hide allowances that are 0 || Done 2026-10-04 |
| 36 | Settings copy matches the real default || Done 2026-10-04 |

## Batch 2 — Jenni's core flow

| Item | Status |
|---|---|
| A returning student lands back in the last chapter they wrote | Done 2026-10-04 |
| The thesis lands with an outline (all chapters) after the proposal, cursor in the first | Done 2026-10-04 |
| Suggestion bar: Accept / Refine / thumbs on screen (works on a phone) | Done 2026-10-04 |
| Evidence card on a suggested citation before accepting | Done 2026-10-04 |
| Refine presets (validate evidence, cite from my library, simplify, stay on topic, complete paragraph) | Done 2026-10-04 |
| Find papers as a panel beside the text with Cite on each result | Done 2026-10-04 |
| "/" insert menu: table, equation, chart, diagram, table of contents, AI declaration, placeholder citation | Done 2026-10-04 (no table of contents: the export builds a real one) |
| Equations: examples, a cheat sheet, describe-in-words | Done 2026-10-04 — examples, live preview, cheat sheet; describe-in-words waits for the owner (new prompt) |
| Selection edits as a preview with "what changed and why", Replace / Insert below / Try again / Discard | Done 2026-10-04 — Replace / Insert below / Try again / Discard on the existing diff; "why" waits for the owner (new prompt) |
| One Review panel listing every check with one button each | Done 2026-10-04 — "Every check, in one list" on the flags tab |
| A student can comment on their own text | Done 2026-10-04 |
| Word export: citations as Word citation fields (optional hyperlinks) | Done 2026-10-04 — ADR-0055; opening in real Word is in PENDING |

## Batch 3 — larger features

| Item | Status |
|---|---|
| One-button peer review of any text: scores, weaknesses, strengths, questions, anchored comments | Done 2026-10-04 — Examiner review of a chapter, flags on each sentence (ADR-0056; the chapter build's examiner, no new prompt) |
| Gap analysis by claim (supported / contested / under-explored) on top of the theme map | |
| Chat that can search beyond the library (asks first), shows its steps | |
| More selection actions (counter-argument, hedge/strengthen a claim, tense, to table, translate) | |
| Library: duplicate detection, missing-PDF view | Done 2026-10-04 — possible duplicates with Merge (snapshots first), "Without full text" with Add the PDF |
| Interface language (Hindi, Tamil…) | |

## Beyond the batches (fix list items, 2026-10-04)

| Item | Status |
|---|---|
| Earlier suggestions kept: ‹ › on the suggestion bar steps back to one before Refine replaced it | Done 2026-10-04 |
| Assist reads the note of the sub-section under the cursor, not only the chapter's (A21) | Done 2026-10-04 |
| Ask chat about a selected passage | Done 2026-10-04 |
| Start flow: topic meter with examples, citation style at creation, signed-in home header, list first | Done 2026-10-04 |
| Cited-by, open-access and journal-citedness badges (library, hover card, evidence card); Copy on a chat answer | Done 2026-10-04 |
| Sharing: roles (guide / co-author / reader), a read-only link, make a copy | Done 2026-10-04 (ADR-0057) |
| Import from Word: a `.docx` becomes chapters at each Heading 1 (append, or replace an empty thesis) | Done 2026-10-04 |

## Also fixed on the way (found while building)

- One label per paper where its passages are cited side by side ("(Jimenez 2021)" ×3), in
  suggestions, chat and drafts.
- Chapter lists printed "1. Chapter 1 — Introduction".
- Journals: OpenAlex no longer returns `x_concepts` for journals, so every topic fit was zero;
  topics are read instead.
- A new thesis's only chapter becomes the outline's first instead of a detached copy.

## Owner decisions (not built until answered)

- Count only **kept** suggestions against the allowance (Jenni does); today every shown suggestion
  counts. Raises AI spend per student; needs the cost model re-run against the ₹100 ceiling.
- Refine presets shipped without a new prompt (they ride the existing guided instruction).
- New prompts (peer review, new edit actions, describe-an-equation, "what changed and why") are not from
  Appendix A; each needs an ADR and an eval round like ADR-0010.
- Springer Nature Open Access API key (`docs/PENDING.md`).
