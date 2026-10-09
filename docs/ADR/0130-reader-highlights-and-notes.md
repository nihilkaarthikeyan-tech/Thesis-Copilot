# 0130 — Highlights and notes on a paper in the reader

Date: 2026-10-09
Status: accepted (Jenni build plan "(a)" item 6; coverage map row 34, noted "not built" since
ADR-0068; the owner delegated the product calls in ADR-0059)
Follows: ADR-0068 (the reader), ADR-0100 (Explain selection).

## Context

Jenni's reader lets a student highlight a passage of a paper and keep a note on it; ours could
copy, cite or ask about a selection and forgot it the moment the page closed. Coverage map row 34
was MATCH with "highlights and notes are still not built" written under it since 2026-10-05.

## Decision

1. **A new table, `SourceHighlight` (migration `0051_source_highlights`)**: one row per highlight,
   on one source, belonging to one user. Colour is one of the editor's four highlight colours
   (`HIGHLIGHT_COLORS`: yellow, green, blue, pink), the note is optional and at most 2,000
   characters (an empty note is no note), the quote at most 4,000, and a paper holds at most 500
   highlights per student. Shared limits and zod bodies are in `@tc/types` (`reader-highlights.ts`).
2. **Owner-only, like the reader.** `GET/POST /sources/:id/highlights`, `PATCH/DELETE
   /highlights/:id`; every query is scoped by the thesis owner **and** the user; anything else is
   a 404. A guide or co-author does not open the reader today, so there is no one else to scope
   for; the `userId` column keeps the rows the student's own if that changes.
3. **Anchor: page or passage, offsets, and the words.** Offsets are into the reader's normalised
   searchable text (`SearchIndex`: lower case, whitespace collapsed) of one PDF page's text layer,
   or of one Text-view passage (the whole Text view when a selection crosses passages). The exact
   slice and 32 characters either side are stored with them. On redraw (a zoom, scrolling back to
   a page, reopening the paper) the offsets are tried first; if they no longer hold the same words
   the words are searched for and the occurrence whose surroundings agree best wins, the nearest
   to the old offset breaking a tie (`lib/reader-highlights.ts` `locate`). A PDF highlight is
   found in the Text view (and a Text highlight on its page of the PDF) by its words alone. A PDF
   highlight stays within one page: a selection across pages is refused with a sentence saying so.
4. **Drawn with the CSS Custom Highlight API**, as search already is (`::highlight(reader-hl-*)`),
   so pdf.js's text layer is never wrapped or altered and later selections are unaffected. Search
   matches are raised above highlights (`priority`). `PdfView` reports each page's text layer as
   it is drawn (`onPageText`), which is when that page's highlights are found again.
5. **"Highlights and notes"**: a side list beside the paper at 1024 px and wider, a sheet over the
   lower part of the screen on a phone (closed when an entry is chosen so the passage shows). Each
   entry jumps to its passage, changes colour, takes or edits a note, and is deleted. An entry
   whose words are not in the view on screen says "not found in this view" and still jumps to its
   page or passage.
6. **Flag, don't fix.** No model reads a highlight or a note, and nothing is metered. A note
   reaches the chat only by "Put in chat", which fills the chat box ("About this passage: … — my
   note: …") for the student to send or not; and the chapter only by "Put note in chapter", which
   opens the editor's existing cite bar and inserts the note with the paper's citation after the
   student clicks a place and presses "Put here".
7. **Nothing left behind.** Removing the paper cascades; `DocumentEraser.deleteRows` deletes them
   explicitly with the thesis's sources (so student, admin and account deletion of a thesis all
   take them); account erasure also deletes them by `userId`. A merge moves the duplicate's
   highlights to the kept paper (their passage id cleared, since the duplicate's passages go);
   "Make a copy" copies the student's highlights onto the copy's own papers.

## Consequences

- A paper that is re-read with different text may lose a highlight's place; it stays in the list,
  marked, with its quote and note intact.
- Highlights are not exported with the library or the thesis. Nothing asked for it; a later ADR can.
- The migration must be applied on the dev database and the VPS with the code: without the table
  the list stays empty and every Highlight press answers with an error.
