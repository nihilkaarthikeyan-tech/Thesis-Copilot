# 0113 — Word import says why its citations were not linked

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R34; inventory §12 flow B)

## Context

After a Word import, Jenni's right panel says at once: "No citations found — your document must
include a references section (e.g. 'References' or 'Bibliography') for citations to be matched."
It tells the student why, not just that. Ours counted the citations typed as text and said they
"were kept as text — link them to your library when you are ready", which says what happened but
not why, and was the same sentence whether the file had a reference list or not.

Two more things were wrong on the way:

- **Ours never links a typed citation**, with or without a references section: a citation in the
  thesis points at a paper in the library, and an import adds no papers (`docx-chapters.ts`:
  "nothing here guesses which source one means"). Copying Jenni's wording would have told a
  student that adding a references section fixes it, which here it does not.
- **A reference list inflated the citation count.** An IEEE list starts each entry with "[1]",
  "[2]", so a 30-entry list counted as 30 more citations typed as text.

## Decision

- **The import finds references sections** (`findReferences`, `docx-chapters.ts`): a Heading 1
  chapter, a Heading 2 or 3, or a paragraph that is only the words, named "References",
  "Bibliography", "Works cited", "Literature cited", "Reference list", "List of references",
  "References cited", "Sources cited", "Select(ed) bibliography" or "Cited works/literature", in
  any case, after an optional number ("7.", "Chapter 7:", "VII."). Its entries are the paragraphs
  and list items under it, up to the next heading of the same or a higher level (to the end of
  the chapter for a Heading 1 chapter, to the next heading of any level for a plain paragraph).
  Each comes back as `{ heading, chapter, entries }` in the preview and the result, as `references`.
- **Entries are not citations.** The citation count reads the text outside a references section.
  The list itself still comes across as the student's text, unchanged.
- **A notice in the dialog**, in the preview (before anything is written) and in the summary
  after, replacing the old one-line bullet (`lib/word-import-notice.ts`, `CitationNotice`):
  - **No references section, citations found:** "N citations not linked. The file has no
    references section — a heading such as “References” or “Bibliography” — so nothing in it says
    which paper each citation means. They stay as text." Then: add the papers to the library
    (Citations tab → Paste a reference takes a whole list) and cite each one.
  - **No references section, no citations:** "No citations found", with the same reason, as Jenni
    says it.
  - **A references section and citations:** the real reason here — a citation points at a library
    paper and an import adds none — then where the list came in ("the chapter “References” (24
    entries)", or "“Bibliography” in “Conclusion”", or "2 reference lists (15 entries), the first
    …"), to paste into Paste a reference; and that the thesis builds its own reference list from
    what is cited, so the typed one can go once the citations are linked (the export writes its
    own "References" from the cited sources).
  - **A references section, no citations in the text:** says so, and the same Paste a reference.
- Amber when citations were left unlinked, neutral when there were none.

No new prompt, no new allowance, no change to what is imported: the notice reads counts the
conversion already makes. Linking typed citations to library papers on import stays unbuilt: it
would need the import to add papers (Crossref lookups, an allowance) and to guess which entry
"(Kumar, 2021)" means, which the conversion deliberately never does.

## Evidence

`apps/api/test/docx-chapters.spec.ts` (+4): a "References" chapter with its entries, and none in a
file without one; a Heading 2 and a plain bold paragraph inside a chapter, each ending at the next
heading, with the IEEE entries' "[1]" "[2]" left out of the citation count; numbered and
upper-case headings, and a sentence that only mentions references is not one; a title the import
made up (the file's name) is not taken for a heading. `apps/api/test/word-import.spec.ts` (+1, and
the existing preview test now expects `references: []`): the preview and the import both carry
`references` for a real `.docx`, the citation count leaves the list out, and the list comes across
as text.
`apps/web/test/word-import-notice.spec.ts` (6): every case's words, one and many.
`apps/web/e2e/word-import.spec.ts` (written, run by the main session): the existing import now
expects the no-references notice in the preview and the summary; a new test imports a file with a
"References" chapter at 1440, 1024, 768 and 390 px with the layout measured.
