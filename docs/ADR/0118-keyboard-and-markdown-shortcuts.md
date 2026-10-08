# 0118 — Keyboard and Markdown shortcuts, listed

Date: 2026-10-08
Status: accepted (Jenni build plan Tier 4, R35; inventory §7)

## Context

Jenni has a shortcuts window with tabs: the keys, the Markdown its editor understands (`#`
headings, `-` lists, `1.` lists, `` ` `` code, ```` ``` ```` code blocks, `$$equation$$` …) and a
KaTeX sheet. Ours had TipTap's Markdown input rules working but listed nowhere, and the keys
only in the footer (three, then "More keys") and in "How suggestions work". There was no window
of them at all.

## Decision

- **One list, in `@tc/ui`** (`editor/shortcuts.ts`): `KEY_SHORTCUTS` in three groups
  (Suggestions, Writing, The chapter) and `MARKDOWN_SHORTCUTS`. Every key was checked in the
  extension that binds it — `@tiptap/extension-*` 2.27.3 and our `ghost-text.ts`,
  `move-block.ts`, `nodes.ts` — and a Mac shows `⌘`/`⌥` (`macKeys`).
- **A "Keyboard shortcuts" window** (`KeyboardShortcuts.tsx`), opened from a button in the
  editor's footer, beside "More keys", at every width (the Markdown works from a phone's
  keyboard too). Two tabs, Keys and Markdown; Esc closes it. On a 390 px phone it is the full
  width less a 16 px gutter, and long descriptions wrap rather than widen it. The KaTeX sheet
  stays where it is, in the equation box (ADR-0045 / JENNI-FIX-LIST 22).
- **The Markdown rules that work** (all TipTap's own unless said): `## ` and `### ` (our
  `ThesisHeading`: a section and a subheading — the chapter title is the chapter's own first
  heading, so `# ` is deliberately not a rule), `- ` `* ` `+ ` bullets, `1. ` numbers, `> `
  quotation, ```` ``` ```` and `~~~` code block, `---` line, `**bold**` / `__bold__`,
  `*italic*` / `_italic_`, `~~strike~~`, `` `code` ``.
- **One rule added: `$$…$$` makes an equation.** Inline in a sentence; a displayed equation when
  it is all the paragraph holds. Only LaTeX that KaTeX can draw is converted — anything else stays
  the text typed, as the equation box refuses it (ADR-0045). Undo gives the dollars back. A single
  `$…$` is **not** a rule: "$5 and $10" is money far more often than mathematics.
- **Rules considered and not added**, as not safe in a thesis: TipTap's Typography extension
  (`--` becomes an em dash, wrong for a page range "3--5", and quotes change under the student's
  fingers); `==highlight==` (no highlight mark yet — R28); `^sup^` / `~sub~` (not standard, and
  `~` clashes with `~~strike~~`); `# ` (see above).
- **"Listed and working" is a test**: `packages/ui/test/markdown-shortcuts.spec.ts` types every
  entry of `MARKDOWN_SHORTCUTS` into a real editor one character at a time, through the same
  input-rule hook a keypress uses, and checks the node or mark it promises. Adding a line to the
  list without the rule fails it.

No new prompt, no allowance, no migration.

## Evidence

- `packages/ui/test/markdown-shortcuts.spec.ts` (15): each listed shortcut; `$$…$$` alone as a
  displayed equation; LaTeX KaTeX cannot draw left as text; "$5 and $10" left alone.
- `apps/web/e2e/keyboard-shortcuts.spec.ts`, written, **not yet run**: the window at 1280 and
  390 px (inside the viewport, no sideways scroll, Esc closes), and `## `, `**…**`, `- ` typed in
  the browser.
