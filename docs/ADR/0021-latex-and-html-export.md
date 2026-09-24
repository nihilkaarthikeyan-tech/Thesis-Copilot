# ADR-0021 — LaTeX and HTML export

**Date:** 2026-09-24
**Status:** Accepted
**Extends:** FR-8.1 (export) and Appendix D.3.2 (the whole-thesis build), which specify `.docx` and
PDF.

## What prompted it

A competitor exports LaTeX and HTML; we exported `.docx` and PDF. A student whose department wants
LaTeX source, or who will finish in Overleaf, had no way out of the product but retyping, and a
student who wanted to send a chapter to someone without Word had to send a Word file.

## The decision

Two more formats on the whole-thesis export, both built from the same chapters, template and
citations as the `.docx`, and both **working formats**: like the `.docx`, never gated on the
compliance checks. Only the PDF, which is what is handed in, is.

**LaTeX — a project `.zip`** (`main.tex`, `references.bib`, `figures/`, `README.txt`):

- **Citations are `\parencite` / `\textcite` over `references.bib`**, not citeproc's labels.
  That is what LaTeX source is for: the style is one option to change. The price is that biblatex
  formats the list, in its nearest built-in style (`authoryear`, or `numeric` for a numeric CSL
  style); `main.tex` and `README.txt` both say so plainly. The `.bib` holds the cited sources
  only, keyed by `citationKeys` — the same function the library export uses, over the same list —
  and without the library file's "RETRACTED" / "Not identified" notes, which biblatex would print.
- **LaTeX numbers sections, figures and tables** (`\label` / `\ref`), with the chapter counter set
  to each chapter's stored number, so "Figure 3.2" is the same figure in every export.
- **Equations are typeset** — the student's own LaTeX, which the `.docx` can only print as source.
- **The template is followed where LaTeX can follow it:** paper, margins, font size, line and
  paragraph spacing, the chapter label and caps (`titlesec`), heading numbering patterns, caption
  positions, and the front matter in the template's order with the `.docx`'s wording.
- Compiles with pdfLaTeX (or XeLaTeX) and Biber. Proved on 2026-09-24 by building a generated
  project in a TeX Live container: no errors, no undefined citations or references, and the pages
  checked by eye (which found two faults, both fixed: the last front-matter page numbered 1, and
  every figure stretched to the line width).

**HTML — one self-contained page:**

- Figures inlined as data URIs, equations as MathML (KaTeX's `mathml` output, which current
  browsers draw with no script and no font download), citations exactly as the editor shows them,
  each linked to its entry in the reference list in the thesis's own style.
- No script at all. Links only to `http(s)` and `mailto`.

**Both** leave out an AI draft the student has not accepted, as the `.docx` now does
(`withoutPendingDrafts` — the `.docx` fix of the same day found while building these).

## Rejected

- **Pandoc** (`.docx` → LaTeX/HTML). A new binary on the server, and it would lose exactly what
  makes these worth having: real `\cite` keys, typeset equations, the template's front matter.
- **citeproc's labels as literal text in LaTeX.** An exact match to the editor, and a dead end: a
  LaTeX thesis whose citations cannot be restyled is a `.docx` with extra steps.
- **A multi-file HTML export.** One file is what can be sent, opened offline, or attached.

## Consequences

- `@tc/export` depends on `jszip` and `katex` directly, at the versions already in the tree
  (`docx` and the editor used them).
- A GIF figure is shipped in the LaTeX project but not included (pdfLaTeX cannot read GIF); the
  page shows a visible box saying to convert it.
- A thesis in a non-Latin script needs XeLaTeX and a font with its glyphs; the preamble supports
  XeLaTeX, but choosing the font is the student's.
