# 0119 — A contents block, text colour, highlight and a horizontal rule

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R28; inventory §10, §13.3, §13.8)
Changes: the format toolbar's "no colours" rule (FormatToolbar.tsx, PRD §6.2 note) for colour only.

## Context

Jenni's "/" menu has a Table of Contents block (a live list of the title and every heading,
indented by level) and a horizontal rule; its toolbar has text colour and highlight. Ours had
none of the four as something a student could insert. The schema already held a horizontal rule
(StarterKit), reachable only by typing `---`, and no export printed it: the chapter `.docx`, the
thesis `.docx`, HTML and LaTeX all dropped it without a trace. Jenni's own Word export drops its
paragraph highlight (inventory §13.8). The plan's test is "each inserts and survives export".

## Decision

- **Colours by palette name, never a CSS colour.** Two marks in `@tc/ui` (`editor/colors.ts`):
  `textColor` (grey, red, orange, green, blue, purple) and `highlight` (yellow, green, blue,
  pink), with the palette in `@tc/types` (`text-colors.ts`). TipTap's Color and Highlight
  extensions write `style="color: …"` inline, which cannot follow the theme (a red that reads on
  paper is too dark on the dark ground) and which a pasted web page fills with its own colours.
  Here the editor's CSS (`--ink-*`, `--hl-*` in `globals.css`, for light, dark and both high
  contrasts) draws each name in the theme's shade, and only our names parse: a paste brings no
  colours in. A plain `<mark>` is yellow. Ctrl+Shift+H highlights in yellow.
- **The toolbar** has a text colour and a highlight button after strike-through, each opening a
  small swatch panel (with "Default colour" / "No highlight" and a line saying it prints). The
  panel is drawn in `document.body` at the button and clamped to the window: the toolbar's
  `backdrop-blur` makes it the containing block of anything `fixed`, and an `absolute` panel at
  the bar's right edge would run off a phone. Every control prevents the mousedown, so the
  selection stays.
- **One colour on paper per name.** The exports print each name in one colour chosen for white
  paper, whatever theme the student writes in. In the `.docx` (and so the PDF, which LibreOffice
  draws from it) a highlight is Word's own highlight of that hue — yellow, green, cyan, magenta —
  so Word's Text Highlight Colour button takes it off again; a text colour is the exact hex. The
  HTML and LaTeX use the editor's light tints. LaTeX highlights with `\tchl`, built on `ulem`
  (already loaded): `ulem` draws its mark before the word, so a thick coloured rule sits behind
  the text and breaks across lines. It wraps every other mark, so a strike-through shows on top.
- **The contents block** (`editor/table-of-contents.ts`) is an atom that stores nothing: it lists
  the chapter title and every heading, indented by level, re-read on every change, so it cannot
  disagree with the headings. A heading inside an AI draft the student has not accepted is not
  listed (flag, don't fix; the export leaves it out too). A click on an entry goes to it. Its words
  follow the interface language (`setTableOfContentsLabels`).
- **In export** the block becomes a real contents list, mapped onto the TOC the thesis export
  already writes (docx `TableOfContents`, CLAUDE.md's `fieldParagraph` rule):
  - the chapter `.docx`: Word's TOC field at the block's place, filled with the chapter's headings
    as the file numbers them, so it reads before an update; Word asks to update it on opening,
    and the chapter PDF now asks Gotenberg for `updateIndexes`, as the thesis PDF does, so its page
    numbers are filled in. Every heading carries its outline level, which a TOC field collects by.
  - the whole thesis (`.docx`, HTML, LaTeX): the contents page at the front, where the template
    puts it, not a second list mid-chapter. A template with no contents page gets one when any
    chapter has the block (`frontMatterOf`), before the lists of figures and tables.
- **The horizontal rule** is in the "/" menu ("Horizontal rule", also found by "divider"). In the
  `.docx` it is a bottom border on an empty paragraph (`thematicBreak`), in HTML `<hr>`, in LaTeX
  `\noindent\rule{\linewidth}{0.4pt}`.
- The block menu's paragraph highlight (ADR-0094) stays a reading aid on screen; its menu now says
  so and points to the toolbar's highlight, which prints.

No model, no allowance, no migration: chapter content is JSON.

## Found on the way

- **The chapter `.docx` printed the chapter title twice**: the title line, then the same words
  again as the first heading. It now prints the student's own level-1 heading once (the thesis
  export's rule).
- **The thesis `.docx` dropped strike-through**; the chapter `.docx` kept it.
- **The LaTeX project failed to compile on an underlined or struck-through `CO₂`**: `escapeLatex`
  writes it as `CO\textsubscript{2}`, and `ulem` stops at `\textsubscript` inside its argument.
  `ulemSafe` boxes sub- and superscripts in `\mbox` for `\uline`, `\sout` and `\tchl`.
- Two JSON position walkers (`@tc/citations` checks, `@tc/ai` examiner review) learnt that the
  block is an atom, so a citation after it keeps its position.

## Evidence

`packages/ui/test/colors-and-contents.spec.ts` (13): each mark stores a name and draws it, a
pasted inline style or unknown name parses to nothing (a plain `<mark>` to yellow), Ctrl+Shift+H
toggles, one highlight replaces another; the block lists headings by level without a pending
draft's, inserts with a line after it, round-trips as JSON and HTML, draws and follows edits, goes
to a heading on a click, takes the interface language, says so when empty; the rule round-trips;
the "/" items are found by name and keyword, and "/tab" still offers the table first.

`packages/export/test/blocks-and-colors.spec.ts` (10): the chapter `.docx` runs carry
`w:highlight` and `w:color`, the rule a bottom border, the block a TOC field filled with "3.1
Study area" and not the draft's heading, the title once; the thesis `.docx` has one contents
field, and adds one for a template without; HTML classes and their CSS; the LaTeX palette,
`\tchl` and the nesting order; `ulemSafe`.

pdfLaTeX (TeX Live 2026, the local `texlive/texlive:latest-small` image, no network) on the
highlighter and the `ulemSafe` cases, read back as a PDF: highlights behind the text across a line
break, with bold, italic, underline, strike-through, a link and a text colour; the old
`\uline{CO\textsubscript{2}}` stops the compile, the boxed one does not.

`apps/web/e2e/blocks-and-colors.spec.ts` (written, not run here): both pickers inside the window
at 1440, 1280, 1024, 768 and 390 px with no layout fault, a word coloured and one highlighted,
"/toc" and "/divider" inserted, an entry clicked, and the chapter `.docx` carrying all four.
