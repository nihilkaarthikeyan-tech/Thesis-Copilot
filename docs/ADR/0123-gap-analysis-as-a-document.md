# 0123 — The gap analysis as a document: the claims map opened as a chapter of drafts

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R38; inventory §6, §13.11)
Follows: ADR-0086 (the claims map), ADR-0039 (chapter build: sections as pending drafts),
ADR-0097 (the outline row lock), the Word import's outline adoption (2026-10-04).

## Context

Jenni's research gap analysis ends as a document the student can edit: a summary line ("77 works
and 14 claims: 1 under-explored, 1 contested, and 12 well-supported"), a table of claims (Claim ·
Status · Evidence · Direction), then Under-explored, Contested, Well-supported, Directions and
Limits of this retrieval. Ours had the same analysis since ADR-0086, as a read-only panel on the
Sources page's Discover tab: nothing in it could be edited, moved into a chapter, or cited from.

## Decision

- **"Open as a document"** on the claims map, beside "Map the claims again"
  (`POST /documents/:id/claims/document`). It builds the stored map into a new chapter and opens
  it. Once a map has been opened the button reads "Open the document" and returns to that chapter
  (`Document.meta.claimsDocument`, and `GET …/claims` names it while it exists). Mapping again
  makes a new map, which opens as a new chapter; the old one stays the student's.
- **No model call, no allowance, no migration.** The analysis was paid for when it was mapped
  (`CROSS_PAPER`, once an hour). Everything in the chapter is the map's own words (claim,
  direction, limit) or a plain sentence written in code from what the map recorded: how many
  papers were read, on which day, from what, how many claims of each status, and what was left
  out. No prompt was needed; none was written.

### Where it lives: a chapter of the thesis, not a separate document

- **A citation can only point at this thesis's library.** `Source` rows belong to one document. A
  separate document would need its own copy of every cited paper (the "Make a copy" machinery,
  ADR-0057), its citations would point at the copies, and a sentence moved from it into the
  literature review would arrive with citations to another thesis's papers, drawn red as removed
  sources. In a chapter, the analysis's sentences move into Chapter 2 with their citations intact.
- **Everything a chapter has comes free:** the editor, the thesis's citation style and
  bibliography, version history, comments, the guide's view, export, the Sections panel.
- **At the end of the outline**, titled "Research gap analysis" ("(2)" when the title is taken),
  with a scope note saying what it is. Not an orphaned chapter: the Outline screen shows those
  under a warning as "no longer in the outline". The student can move it, or delete it on the
  Outline screen. A thesis with no outline yet adopts its chapters into one first, as a Word
  import does, so the analysis really comes after them. Refused while a plan is being written
  (it would replace the outline this adds to).
- **One chapter per map.** The outline row is locked for the read and the write (the lock the
  Sections panel's note takes), so two presses wait for each other instead of making two chapters.

### Flag, don't fix

- **Six pending draft blocks**, one per section: Claims in the library (summary and table),
  Under-explored, Contested, Well supported, Directions, Limits of this mapping. Every word has
  `DRAFT` provenance on its section's own `SuggestionEvent` (action `CROSS_PAPER`, outcome
  `SHOWN`), so the word counts and the AI-usage report are truthful. Accept and Discard on each
  block record on that row (`/draft/:id/accept` now takes `CROSS_PAPER` as it took
  `CHAPTER_BUILD`), the thumbs work, and the export leaves pending blocks out, as it always has.
  Nothing is thesis text until the student accepts it, section by section, as with a chapter
  build.
- The summary says what the claims are: "an AI's summary of each paper's abstract or opening
  passage, not quotations; check each against its papers before you rely on it."

### Grounding

- **Every claim is cited, only from papers it was read from.** A claim sentence, and its row's
  Evidence cell, cite the papers the map named for it, supporting and contrasting, as real
  citation nodes with their `Citation` rows; and only those still in this thesis's library.
- **At the passage that was read.** The map now records the passage each paper was read from
  (`papers[].chunkId`, from the same first-chunk query). A citation points at it when it still
  exists for that paper (a re-index replaces passages). A map made before this has none, and its
  citations name the paper alone: true, though the hover card then shows no passage. Mapping again
  records them.
- **A claim with none of its papers left is not shown**, never shown uncited; the Limits section
  says how many were left out, and how many named papers are no longer in the library. With
  nothing left to cite the button refuses and says to map again.
- **Directions and limits carry no citation.** They are the mapping's suggestions about the
  thesis and its reading of the evidence's gaps, not something the papers say; the Directions
  section says so.
- The Limits section states the reading's real limits in code: abstract or opening passage only,
  at most 900 characters each (`CLAIMS_MAP.paperChars`), one AI reading on a named day, only the
  papers in the library then.

### On a phone

- A table in the editor scrolls sideways inside its own box (`.tableWrapper`, which TipTap wraps
  every table in when columns are resizable); the page never does. Four columns of claims do not
  fit 390 px, and a citation label does not wrap.
- The citation card would be cut off by that box, so inside it the card is placed against the
  window, kept on screen, and closed by a scroll (`citation.ts`; elsewhere it is placed as before).
- A draft block's header (label, Accept, Discard, Regenerate, thumbs) wraps instead of running out
  of the block. This was true of every draft and chapter build on a phone; six of them on one
  screen made it obvious.

## Not done

- Jenni's References list at the end: ours is the thesis's bibliography, built from the citations
  wherever they are, free in every plan.
- The scaffolding sentences are English whatever the thesis's language; the claims are in the
  language the map gave them.
- Two citations side by side still render "(A, 2024)(B, 2025)" until R40 merges them.

## Evidence

`apps/api/test/claims-document.spec.ts` (10): six pending blocks in order, valid in the editor's
schema; every word `DRAFT` on its section's action, with `shownChars` matching; every citation a
paper still in the library at its recorded passage, keys unique; a claim with no papers left out
and said so, the missing paper counted; the table's header, order (under-explored first), evidence
and empty direction; no citation in Directions or Limits; empty statuses said; nothing to build
when every paper is gone; `shortClaim`.
`apps/api/test/claims-document-api.spec.ts` (9): refused before mapping; the map keeps each
paper's passage; the chapter at the end of the outline with six pending drafts, six `CROSS_PAPER`
events, one `Citation` row per node at the read passage, no model call, no unit; `GET …/claims`
names it; the same map opens the same chapter; a section accepts; deleted, the map opens as a new
chapter; a thesis with no outline keeps its first chapter first, and an old map cites the paper
with no passage; refused while planning, with every paper gone, and for another student's thesis.
`packages/ui/test/citation-popover-table.spec.ts` (2): the card inside a scrolling table is fixed,
on screen, and closes on a scroll; elsewhere unchanged.
`apps/web/e2e/claims-document.spec.ts` (written, not yet run): Discover → Open as a document → six
pending sections, the table and its citations, the layout at 1280, 1024 and 390 px, Accept in
place, Open the document returns to the same chapter.
