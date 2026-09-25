# ADR-0029 — Footnotes, and the citation styles that need them

**Date:** 2026-09-25
**Status:** Accepted
**Amends:** ADR-0018, which listed the 720 footnote ("note") styles but would not let them be
chosen because the editor had no footnotes.

## What prompted it

The owner's list after the competitor gap list: footnotes, "which also unlock about 700 citation
styles". Humanities, history and law theses cite in footnotes — Chicago notes-bibliography, OSCOLA
— and a student in one of those departments could not use the product's citations at all.

## The decision

- **A footnote node.** An inline atom holding plain text, inserted and edited from the toolbar.
  The editor numbers notes with a CSS counter in document order, so inserting one renumbers the
  rest with no code. Every export numbers them through the whole thesis: a real Word footnote in
  the `.docx` and PDF, `\footnote` in LaTeX (chapter reset off), and a note list per chapter in
  the web page.
- **Note styles are selectable.** A style is a note style when its CSL says `class="note"`
  (`isNoteStyle`). Then:
  - each citation is rendered as a note, with its **footnote number** passed to citeproc
    (`noteIndex`), counted through the thesis *together with the student's own footnotes*. That
    is what makes "Ibid." and the short form correct — and not "Ibid." across an unrelated note
    of the student's in between;
  - the editor shows each citation as a footnote number in the same sequence as the student's
    notes, with the note citeproc wrote on hover;
  - every exporter writes the citation as a footnote holding that note; LaTeX uses biblatex's
    `verbose-ibid` with `\footcite`.
- **Footnotes are plain text.** A citation *inside* a student's footnote would need the citation
  machinery inside an attribute. Note styles cover the common need — references in footnotes —
  without it.

## Consequences

- The whole-thesis export still renders in the university template's style (D.3), so a thesis
  on an author–date template exports author–date whatever the editor shows. The chapter export
  keeps the thesis's own style.
- Tests: `packages/citations/test/note-styles.spec.ts` (full, short and "Ibid." forms; no
  "Ibid." across the student's own note), `packages/export/test/footnotes.spec.ts`,
  `apps/web/e2e/footnotes.spec.ts`, and `apps/web/e2e/citation-styles.spec.ts`, which now picks a
  real Chicago notes style fetched from the CSL repository and reads the Word footnotes.
- The two catalogue tests that pinned ADR-0018's refusal were changed to pin this decision.
