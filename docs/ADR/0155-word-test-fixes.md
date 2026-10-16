# 0155 — The Word test's nine faults

Date: 2026-10-16
Status: accepted (the owner listed the nine and their order; the agent took the decisions below).
Builds on ADR-0037, ADR-0070, ADR-0078, ADR-0087, ADR-0128, ADR-0145, ADR-0150 and ADR-0151,
which still hold unless this record says otherwise.

## Context

The owner wrote the same thesis ("Barriers to rooftop solar adoption among rural households in
Karnataka", APA 7) in Thesis Copilot and in Jenni and exported both to Word
(`docs/research/final-sbs/T1-side-by-side-2026-10-16.md`, kept off GitHub). Ours was the more
specific and evidence-led, and the only one with a reference list, but the Word file showed nine
faults. No prompt file changed, no metered action was added, and no trial cap changed.

## Decision

1. **A new thesis's first paper search always runs.** The search made when a thesis is created or
   named (ADR-0087/0145) is counted against the month but never refused for it: the API
   (`firstSearchOfThesis`) and the worker (`isFirstSearchOfThesis`) both let it through when the
   thesis has no earlier first search (`SOURCES_FOUND` with `detail.initial`), and a degraded
   retry of it (ADR-0149) is the same search. Later searches are limited as before. A refusal is
   no longer silent: `startSearch` returns `limit`, which is kept for the thesis for a day
   (`sources:refused:<id>`), reported by `GET /documents/:id/sources/progress` as
   `limitReached`, by a suggestion's done event as `searchLimit`, and by the setup card's
   `PUT …/setup` as `searchLimit`. The editor's progress line, its notice and the setup card say
   "Automatic paper search is used up for this month — use Find papers", with the button. The
   card says "A cited first sentence is waiting" only when the sentence on screen cites a paper.
   Bound: one free search per thesis (two at most if a rename races the first); a thesis is the
   unit a student makes, and the site budget and ₹100 ceiling still apply to each search.
2. **Drafts place citations like suggestions.** `postProcessDraft` (Draft a section, chapter
   build, the literature review) runs ADR-0150's placement paragraph by paragraph
   (`placeDraftCitations`), without Assist's one-paper-once rule, which a draft does not have. A
   stop already after the marker is not doubled. Edit commands already placed them
   (`citationsBeforeStop`). Measured on every stored draft in `packages/ai/eval/results`: most
   markers followed the full stop before; none do after. Because a marker now sits inside the
   stop, chapter build compares the examiner's sentence and the section on both sides without
   markers (`stripCites`, which now reads "recorded." rather than "recorded ."); without that,
   every examiner issue in a fixed section would have been marked fixed.
3. **"The study by Bagla 2026" is rewritten in code.** A closed pattern: a passage's first-author
   surname (from its tag), an optional "et al.", that passage's own year, bare. Only when that
   paper's marker is in the same text, it becomes "One study"/"This study" ("this" when the paper
   was cited before it or is named before the cursor), keeping the lead-in's noun ("One review").
   Nothing else changes; no marker is added, removed or moved; a name whose paper is not cited in
   the text is left alone, since rewriting it would lose the only attribution. Suggestions and
   drafts. Rejected: a narrative APA form ("Bagla (2026)") in plain text, because it would not
   follow the thesis's citation style or reach the reference list.
4. **A family name's stray full stop goes.** "Mohammed." loses its stop where names arrive
   (`cleanAuthors`) and where every stored record is rendered (`peopleFirst`), when what is left
   ends in three or more letters (an initial or "St." keeps it). Records already stored print right
   with no data migration; a name the student edited is printed as typed (ADR-0102).
5. **A citation always follows a space.** New text: suggestions, drafts and edit commands put a
   space before a marker straight after a word (`spaceBeforeMarkers`). Text already stored: the
   chapter and thesis `.docx` and the HTML export print the space before a bracketed label that
   follows a word (`spaceBeforeCitation`). Never after a space, an opening bracket or quote, a
   dash or a slash; never for a superscript number.
6. **A leaned-on paper steps back further.** Why ADR-0087's rule did not hold: the step-back per
   citation stopped at 0.15, less than a Karnataka-specific paper's lead over six other on-topic
   papers, and every request could still take two of its passages. Now a paper the chapter cites
   three times or more (`DOMINANT_CITATIONS`) offers one passage to a suggestion or a draft while
   other papers have candidates, a spare slot goes to another paper's next passage first, and the
   step-back ceiling is 0.20 (`SPREAD_FLOOR` 0.85 → 0.80). A library of one paper still fills the
   request.
7. **The title box keeps the keyboard.** The cause was not a late fill: a new chapter's editor
   took the keyboard a moment after the card showed (the "ready to type" focus of 2026-10-04), so
   a title typed at once went half into the chapter. While the card asks for the title the editor
   leaves the keyboard alone. A title typed before the thesis was made is in the box from its
   first paint (now tested).
8. **"Draft a section" asks first.** The key bar's button and Ctrl+Shift+D open a confirm in the
   setup card's look: the section's name, its note (editable under a planned chapter; saved as the
   section's note through the existing `PUT …/outline/section-note` before the draft), Cancel and
   Draft. Ctrl+Enter or Ctrl+Shift+D again drafts; Esc closes. The Sections panel and the section
   guide, which have just shown the note, still draft at once (`detail.confirmed`). English and
   Hindi.
9. **The suggestion bar covers no text.** The block a suggestion is in makes room for the bar
   (a `.ghost-host` node decoration; its bottom padding is the bar's measured height), and the bar
   sits under the whole block, not under the suggestion's last line. With no room below in the
   window, that room is scrolled into view once instead of the bar going over the lines above.

## Consequences

- Each fix is its own commit with a test; `docs/research/final-sbs/fix-progress.md` lists them.
- Item 1 adds no new allowance: the first search was always meant to run (ADR-0087), and it is
  still counted. Item 6 changes what the model is sent, so the next real-model run should check
  that citations spread without the leaned-on paper's best passage going missing where it is the
  only one on the point.
- Not done here: the editor's own citation node still sits against the word for text stored
  before item 5 (the exports print the space); a notice toast can still sit over text on a phone.
