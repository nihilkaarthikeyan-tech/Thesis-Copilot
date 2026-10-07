# 0096 — Paste with a choice

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R9; inventory §13.2, §13.3)

## Context

In Jenni, text copied from its reader arrives in the document with a real citation and stays
selected, and a paste menu offers Improve writing / Paraphrase / Proofread / Custom prompt. Ours:
the reader's "Copy with citation" (ADR-0068) put plain text on the clipboard — the quotation and
the label as words — so the label arrived as text, not as a citation; and nothing happened on paste.

## Decision

- **The copy carries a real citation.** "Copy with citation" writes HTML beside the plain text
  (`quoteWithCitationHtml`): the quotation, then the editor's own `span[data-citation]` with the
  source, the passage (`chunkId`), the page as locator, and the label (`data-label`). Outside the
  app it reads like the plain text; in the chapter it is a citation node.
- **A paste keeps it right** (`citation.ts`): the label in `data-label` is shown at once instead of
  the placeholder; a citation whose key is already in the chapter, or pasted twice, gets a key of
  its own (keys are per node, ADR-0045).
- **The menu** (`PasteMenu` in `@tc/ui` notices a paste of four words or more, its range and
  whether a citation came with it; `PasteMenu.tsx` draws it beside the paste; typing, a click
  elsewhere or Esc closes it):
  - **with a citation** — a quotation of a source: **Put it in my words, cited** (the edit panel's
    own-instruction path with a fixed instruction: keep the meaning and the citation, remove the
    quotation marks, add nothing; the panel's checks warn if the citation does not survive) and
    **Keep the quotation**;
  - **without one** — **Edit with AI** (the panel on that text), **Find a source for it**, **Cite
    it** (the free `@` picker before its full stop), **Keep as it is**.
- **No uncited paraphrase.** Jenni's Paraphrase rewords anything pasted. Putting a source in one's
  own words *with its citation* is ordinary academic practice; rewording it so its origin
  disappears is what §12.3 forbids. So the rewording is offered only where the citation came with
  the text and is checked to stay.
- **No Proofread on the menu.** Proofreading (ADR-0026) runs over a chapter with its own guard
  against changed words; a pasted passage is in the chapter it runs over.

## Evidence

`packages/ui/test/paste-menu.spec.ts` (5): the reader's HTML pasted through ProseMirror's own paste
path arrives as text and a citation with source and page, its label shown, the menu told it is
cited; pasted twice, two keys and both labels; plain text of four words or more is an uncited
paste; a short paste and typing are not. `apps/web/test/reader.spec.ts`: the HTML is exactly the
editor's citation, escaped.

Browser, real stack: the quote label from the API, `(Gadekar et al., 2026, p. 3)`, pasted into the
chapter as a citation node with page 3 and that label at once; the menu offered the cited pair;
"Put it in my words, cited" ran one edit — quotation marks gone, wording the student's, the
citation and page kept, no warning, with its reasons. A plain paste offered the four; Cite it put
"@" before the full stop and the picker opened. Not driven in the browser: the reader's own Copy
button, whose selection menu waits for an animation frame that a hidden browser pane never draws
(its HTML is the unit-tested function above).
