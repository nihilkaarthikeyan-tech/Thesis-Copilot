# ADR-0148: An AI use statement written from the record, not by a model

**Date:** 2026-10-10 · **Status:** accepted · **Asked by:** the owner

## Context

Universities increasingly ask a student to declare how AI tools were used in a thesis. The
product already records the answer: every run of text carries a provenance mark (Appendix B.4,
`Chapter.wordCounts` on save), every model call is in `AiCallLog` with its document, every
suggestion and draft and its outcome in `SuggestionEvent`, every build in `ChapterBuild`, and the
library knows which papers the product added on its own (ADR-0037). The "/" menu's AI declaration
(2026-10-04) was a fixed text that claimed only what the product does in general; it could not
say what *this* student did. The FR-8.6 usage log is a table of numbers, not a statement.

## Decision

1. **Generated in code from stored rows; no model call, no allowance.**
   `GET /documents/:id/ai-statement` (`AiStatementService.facts`) counts: suggestions shown and
   kept (ASSIST events; kept = ACCEPTED, PARTIAL, EDITED), drafts delivered and accepted (DRAFT
   events), edit commands, proofreading runs, citation suggestions, chat, deep research,
   literature searches, planning (OUTLINE + PROPOSAL), checks (COHERENCE + CROSS_PAPER), chapter
   and literature-review builds (`ChapterBuild` DONE), examiner reviews and viva — each from its
   own rows for this document, `ok` calls only — plus the words by provenance per chapter, the
   library (total, auto-added, cited) and the first and last recorded action. A feature whose
   count is zero is not mentioned in the statement.
2. **The sentences are catalogue entries** (`aiStatement.*` in `en.ts` and `hi.ts`), first person,
   assembled by `apps/web/src/lib/ai-statement.ts` in the interface language. Every number in a
   sentence is a stored count. Where the record cannot tell, the statement says so: pasted text is
   marked as the student's own; an edit inside accepted AI text is counted only where the text was
   touched, so "edited" is a floor; the proofreading runs made before this ADR left no mark and
   count under edit commands. The statement is a record of use, and says so; it never speaks of
   AI detection (PRD §12.3), and the unit test refuses the words.
3. **Editable before use.** The dialog (⋯ → AI use statement) shows the text in a textarea; Copy
   puts it on the clipboard; "Insert as an appendix" sends the *edited* text to
   `POST /documents/:id/ai-statement/appendix`, which makes it an ordinary chapter at the end of
   the outline (the claims-document pattern, ADR-0123) — editable, deletable, nothing special. The
   optional per-chapter table becomes a real editor table. A chapter carrying the statement's
   scope note is left out of the word counts, so a regenerated statement does not count its own
   earlier copy as the student's writing.
4. **Export.** The export dialog's "Add my AI use statement as an appendix" (whole thesis, off by
   default) builds the statement from the record at export time and sends it as `aiStatement`;
   `thesisExportBody` accepts it and `exportThesis` passes it through the existing `appendices`
   input, after the bibliography (D.3.1), in `.docx`, PDF, LaTeX and HTML alike. The table goes in
   as one line per chapter, because the appendix input takes paragraphs.
5. **Proofreading gets a mark.** It shares the COMMAND allowance and log (§11.5), so a run now
   writes an `AuditEvent` of kind `PROOFREAD_RUN` with the calls it made; the statement counts
   the runs and takes their calls out of the edit count. The write never fails the run.

## Consequences

- No new metered action and nothing a cap has to cover.
- The statement reflects only what happened inside Thesis Copilot; what the student did elsewhere
  is theirs to add, and the dialog says so.
- `UsageLedger` is per user and month, not per thesis, so it is not read here; the per-document
  rows above are the record.
- The Hindi text is beta, like the rest of the catalogue (ADR-0061).
