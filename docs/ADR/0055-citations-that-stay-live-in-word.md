# ADR-0055 — Citations that stay connected in the Word export

**Date:** 2026-10-04
**Status:** Accepted
**Touches:** FR-8.1 (export), ADR-0029 (note styles), ADR-0045 (export renders in the template's
style).

## What prompted it

Students finish their thesis in Microsoft Word. Our `.docx` wrote every citation as a run of
plain text, so in Word a citation was dead: nothing restyled it, nothing kept it in step with the
reference list, and nothing led from "(Kumar et al., 2021)" to Kumar's entry. Jenni's Word export
keeps "in-text cites and bibliography linked through References" (Word's own citation feature),
and offers hyperlinked citations for Google Docs.

## The candidates

**(a) Word's own bibliography.** The sources go into a `customXml` part in the bibliography
schema (`http://schemas.openxmlformats.org/officeDocument/2006/bibliography`), which Word reads as
the document's source list (References › Manage Sources). Each citation is a `CITATION <tag>`
field, the reference list a `BIBLIOGRAPHY` field. Word for Windows and for Mac then restyle and
update both from the References tab, and the student can add new citations to the same sources.
Word ships about a dozen styles (APA, Chicago, IEEE, MLA, Harvard and a few others) against our
~10,000 CSL styles, and none of them writes footnote citations.

**(b) Zotero fields.** `ADDIN ZOTERO_ITEM CSL_CITATION {json}` per citation and a `ZOTERO_BIBL`
field. Zotero refreshes them with the same CSL style repository we use, footnote styles included.
Without Zotero installed, which is most of our students, the fields do nothing at all: the file
is no more alive than the plain one. It also needs document preferences in custom properties and
a JSON shape that Zotero documents only by its own code.

**(c) Internal links.** Each citation is a hyperlink to a bookmark on its bibliography entry. Works
in Word on every platform, LibreOffice, Google Docs and the PDF; restyles nothing.

## The decision

Three choices for the `.docx`, picked on the Submit screen ("Citations in the .docx"):

- **Plain text** — the default, and byte-for-byte the old file (the finishing pass is a no-op).
- **Linked to the references** — (c). The visible text is unchanged and unstyled (the runs carry
  no Hyperlink style), so the page looks exactly as before; Ctrl+click goes to the entry.
- **Word citations** — (a). We build (a) rather than (b) because it works with Word alone, which is
  what the students in question have, and it is what the competitor offers.

The rules that keep (a) safe:

1. **Every field already shows our text.** A `CITATION` field's result is the label citeproc
   rendered; the `BIBLIOGRAPHY` field's result is our entries. Nothing is marked dirty, so Word
   does not re-render on open: the student sees the template's style until they choose a style in
   References or update the fields themselves. The page/locator, prefix and suffix go in as
   `\p`, `\f` and `\s`, so Word keeps them when it does re-render.
2. **A note style falls back to linked.** Word cannot write footnote citations, and refreshing a
   field inside a footnote would turn a full note into "(Smith, 2020)". In a note style (ADR-0029)
   "Word citations" writes the linked file: each footnote's note links to its entry.
3. **The PDF is always built from the plain file.** Measured through our Gotenberg on 2026-10-04:
   LibreOffice reads a Word `BIBLIOGRAPHY` field as its own bibliography index and fills it with
   its own entries — the references list came out as "Kumar, 2021: , (Kumar, 2021),", with or
   without `updateIndexes`. The `CITATION` results it showed correctly, and the plain and linked
   files converted with identical text. `citationModeFor` in the API makes the choice apply to the
   `.docx` download only.
4. **No `SelectedStyle`** on the source list. We do not know Word's style file names well enough
   to name them (agent rule 1: never invent an API); Word keeps whichever style the student last
   used.

Both the thesis export and the chapter export accept the choice (`citations` in the request body,
`citationModeSchema` in `@tc/types`); the Submit screen offers it for the thesis.

## How it is written

`packages/export/src/citation-links.ts`. The in-text parts use the `docx` package's real API:
`InternalHyperlink`, `Bookmark`, `SimpleField(instruction, cachedResult)`. Two things `docx` has no
API for are done after `Packer`, on the finished zip, rather than by faking the package's classes
(the lesson of the hand-rolled TOC field that printed its own codes):

- the `BIBLIOGRAPHY` field spans paragraphs, which `SimpleField` cannot; the entries are written
  between two marker runs, which are replaced by the `fldChar` begin/instruction/separate and end
  runs. A missing marker throws rather than shipping marker text;
- the `customXml/item1.xml` source list, its `itemProps1.xml`, the relationships and the content
  type.

It also corrects one fault in `docx` 9.7.1: `Bookmark` takes its id from a fresh counter per
instance, so every bookmark is `w:id="1"`. The finishing pass renumbers them, pairing by order.

CSL → Word source types: journal article → `JournalArticle`, book → `Book`, chapter →
`BookSection`, conference paper → `ConferenceProceedings`, report and thesis → `Report`, web page →
`InternetSite`, magazine/newspaper → `ArticleInAPeriodical`, anything else → `Misc`. A sole
organisational author is Word's `Corporate`. Tags are `citationKeys` from `@tc/citations`, the
keys the `.bib` export already uses.

## Consequences

- Not verified in Microsoft Word itself: no Word on the build machine. The XML is asserted part by
  part (`packages/export/test/citation-links.spec.ts`), and LibreOffice was used as the reader we
  can run. Opening a "Word citations" file in Word for Windows, Word for Mac and Word on the web,
  changing the style in References and updating the fields is a human check (`docs/PENDING.md`).
- A student who opens a "Word citations" file in LibreOffice or Google Docs sees LibreOffice's (or
  Google's) idea of the reference list. The Submit screen says "Microsoft Word only" and points
  them to "Linked" for anything else.
- When the student restyles in Word, the result is Word's style, not their university's. That is
  the student's explicit act; until then the file says what the editor says.
- A source added to the thesis after export is not in Word's list; the student exports again or
  adds it in Word.
