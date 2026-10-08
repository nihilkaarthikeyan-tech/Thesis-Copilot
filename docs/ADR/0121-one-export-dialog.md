# 0121 — One export dialog, with layout presets and a live preview

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R27; inventory §10, §13.8, §13.9)
Builds on: the submission bundle (Appendix D.3), ADR-0021 (LaTeX and HTML), ADR-0044 (fingerprints),
ADR-0055 (citation modes), ADR-0119 (contents block), ADR-0120 (font style).

## Context

Jenni exports from one dialog: Word or LaTeX, how citations are written, layout presets (Jenni
default, Double-spaced manuscript, Two-column paper, Thesis or report), advanced options (paper,
columns, font, size, line spacing, margins, title page, contents, page numbers, comments) and an
approximate preview of page one. Ours exported from two places that did not know each other: the
editor's "Export .docx" (one chapter, plain, no choices) and the submission page (the thesis in the
university template, four formats, citation modes, the ten checks), with no layout choice and no
preview. Jenni also locks the reference list behind its paid plan; ours never has.

## Decision

- **One dialog, `ExportDialog`**, opened from the editor's header ("Export": this chapter or the
  whole thesis) and from the submission page ("Export…": the whole thesis). It holds what to export,
  the format (Word, PDF; LaTeX and the web page for the whole thesis), the citations in the `.docx`
  (ADR-0055), the layout, the advanced options, the build, and the files built with their
  fingerprints (ADR-0044). The submission page keeps the details, the template and the checks; its
  four buttons and the citation radios moved into the dialog.
- **Presets** (`@tc/types` `export-layout.ts`):
  - **Thesis** — the institution template exactly, title page and contents as it asks. The default
    for the whole thesis.
  - **Plain** — the template's paper, 1-inch margins, 11 pt in the student's font style (Calibri,
    or Times New Roman / Arial for serif / sans-serif, ADR-0120), 1.15 lines, no title page. The
    default for a chapter.
  - **Double-spaced** — 12 pt Times New Roman, double spaced, 1-inch margins.
  - **Two-column** — 10 pt Times New Roman, single spaced, narrow margins, two columns.
  The manuscript presets keep only the abstract (and the title page and contents when turned on):
  a manuscript or a paper has no certificate.
- **Advanced options** override the preset: paper (A4, Letter), font (Times New Roman, Arial,
  Calibri — every Word has them and LibreOffice has metric twins, so the PDF matches), size (10–12
  pt), line spacing (single, 1.15, 1.5, double), margins (0.75, 1, 1.5 in), title page, contents,
  page numbers, and the guide's open comments. A contents block in a chapter (ADR-0119) forces
  the contents on. Changing the preset starts its options afresh.
- **The preview and the file are built from the same numbers.** `resolveLayout(template, choice,
  {fontStyle, contentsBlock})` runs in the dialog and in the API; `applyLayout` writes them into the
  template spec every exporter already reads. The preview (`LayoutPreview`) draws the pages in HTML
  at the paper's proportions — margins, font, size, spacing, columns, page numbers, the title page
  and the contents page, then the first page of text — and changes as an option changes. It is
  called an approximate preview: Word lays out the real pages.
- **The checks are kept, and honest about a layout.** They still run against the university
  template; PAGE_SETUP now reads the layout the file is actually built with, so a layout that is
  not the template is a finding. The `.docx` is never blocked; the PDF waits, and the dialog says
  so before the student presses anything and asks for the reason, which the audit log keeps
  (D.3.3, unchanged).
- **Comments** become Word comments over the paragraph or heading holding the words each quotes
  (comments are anchored by their quoted text, ADR-0017), with the replies (ADR-0109) under them; a
  comment whose words are gone is put on the chapter title. Open comments only.
- **Two columns and page numbers** reach the thesis `.docx` (the body section; the front matter
  stays one column), the chapter `.docx` and the LaTeX project (`twocolumn`, `\pagenumbering
  {gobble}`). A layout with no front matter at all starts the file on the body.
- **The reference list is always in the file**, in every plan, as before.

No model, no allowance, no migration.

## Rejected

- **A server-rendered PDF preview.** A Gotenberg round trip per click is seconds and load on the
  shared converter; the HTML preview is instant and offline and drawn from the same numbers.
- **More fonts (Palatino, Georgia).** Not on every machine or in the PDF converter; a preview that
  shows a font the PDF does not have would be a promise the file breaks.

## Evidence

`packages/types/test/export-layout.spec.ts` (7): each preset's numbers; Thesis alone matches the
template; options override; a contents block forces contents; sizes and spacings outside the dialog
refused; `applyLayout`'s front matter.

`packages/export/test/layout.spec.ts` (8): the thesis `.docx` in each preset (Times 12 double with
1-inch margins and no title page; two columns at 10 pt; the template's own `pageSetupOf`), no footer
with page numbers off, Word comments on the quoted paragraph and the title with replies, none
without the option; the chapter `.docx`'s Letter page, Arial and two columns; LaTeX `twocolumn` and
`gobble`.

`apps/api/test/export-layout.spec.ts` (4, real HTTP and storage): a double-spaced thesis export
carries the layout and fails PAGE_SETUP with the spacing named; the Thesis preset passes it; a
chapter in two columns; an unoffered size refused with 400.

`apps/web/test/layout-preview.spec.ts` (2): what the preview reads of a chapter.

`apps/web/e2e/export-dialog.spec.ts` (written, not run here): the dialog inside the window with no
layout fault at 1440, 1280, 1024, 768 and 390 px; a preset and the paper change the preview; the
file matches (two columns, Letter); the thesis scope's warning and three-page preview; the
submission page opens the same dialog. `onboarding.spec.ts` and `other-exports.spec.ts` now export
through the dialog.
