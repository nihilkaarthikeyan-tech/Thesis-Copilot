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
| 1 | Suggest / Ctrl+/ with nothing to cite: say why, offer Find papers | |
| 2 | Proposal related-work search: key words, not the whole conversation; retry broader; a failed search is shown as failed, not "0 found" | |
| 3 | When nothing was found, the model is told so in plain words (no "related work found…") | |
| 4 | Topic path: no "sources found in your paper" | |
| 14 | Proposal options as buttons the student can tap | |
| 5 | Breadcrumb: long title truncated, never empty | |
| 6 | Toolbar: Chart / Diagram labels overlap | |
| 7 | Editor banner: accurate (suggestions on a pause), no keyboard talk on a phone | |
| 8 | Sources panel refreshes when automatic sources add papers | |
| 9, 40 | No internal words ("Strong call", "Fast call") on student pages | |
| 10 | Discover shows stages and an estimate while it runs | |
| 11 | A friendly message, not "Failed to fetch", when the server cannot be reached | |
| 12 | Phone: banners collapse to one line; the text comes first | |
| 13 | Screen readers hear the suggestion and how to accept it | |
| 31 | Build: chapter label "2. Chapter 1 — …" | |
| 32 | Build: discipline suggestion from the field; no internal check codes; one language list | |
| 33 | Submit: human field names, not "studentName" | |
| 34 | Journals: no "No subject overlap" on every match; "you cite" only when cited | |
| 35 | Usage: plain names for VIVA / CHAPTER_BUILD; hide allowances that are 0 | |
| 36 | Settings copy matches the real default | |

## Batch 2 — Jenni's core flow

| Item | Status |
|---|---|
| A returning student lands back in the last chapter they wrote | |
| The thesis lands with an outline (all chapters) after the proposal, cursor in the first | |
| Suggestion bar: Accept / Refine / thumbs on screen (works on a phone) | |
| Evidence card on a suggested citation before accepting | |
| Refine presets (validate evidence, cite from my library, simplify, stay on topic, complete paragraph) | |
| Find papers as a panel beside the text with Cite on each result | |
| "/" insert menu: table, equation, chart, diagram, table of contents, AI declaration, placeholder citation | |
| Equations: examples, a cheat sheet, describe-in-words | |
| Selection edits as a preview with "what changed and why", Replace / Insert below / Try again / Discard | |
| One Review panel listing every check with one button each | |
| A student can comment on their own text | |
| Word export: citations as Word citation fields (optional hyperlinks) | |

## Batch 3 — larger features

| Item | Status |
|---|---|
| One-button peer review of any text: scores, weaknesses, strengths, questions, anchored comments | |
| Gap analysis by claim (supported / contested / under-explored) on top of the theme map | |
| Chat that can search beyond the library (asks first), shows its steps | |
| More selection actions (counter-argument, hedge/strengthen a claim, tense, to table, translate) | |
| Library: duplicate detection, missing-PDF view | |
| Interface language (Hindi, Tamil…) | |

## Owner decisions (not built until answered)

- Count only **kept** suggestions against the allowance (Jenni does); today every shown suggestion
  counts. Raises AI spend per student; needs the cost model re-run against the ₹100 ceiling.
- New prompts (refine presets, peer review, new edit actions, describe-an-equation) are not from
  Appendix A; each needs an ADR and an eval round like ADR-0010.
- Springer Nature Open Access API key (`docs/PENDING.md`).
