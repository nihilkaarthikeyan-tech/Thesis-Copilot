# 0094 — The block handle beside each paragraph

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R7; inventory §13.3, "the single most visible
difference in the writing area")

## Context

Jenni shows a "+" and a grip beside the paragraph under the mouse. The grip drags the block and
opens a menu: Turn into, Cite, Highlight, AI Chat, AI Edit, Review ▸, Duplicate, Delete. We had a
keyboard move (`move-block.ts`) and nothing on the page.

## Decision

- `BlockHandle` (`packages/ui/src/editor/block-handle.ts`), in `thesisExtensions`:
  - the handle, placed beside the top-level block under the mouse; never on the chapter title;
    not on a touch screen, where the "/" menu and the selection toolbar do the same;
  - "+" puts an empty line below and opens the "/" menu there (the menu removes the slash);
  - the grip drags the block with ProseMirror's own move (`view.dragging`), and opens the menu
    through `editor.storage.blockHandle.onMenu`, read when pressed (CLAUDE.md: options are fixed
    when the editor is built);
  - commands `duplicateBlock`, `deleteBlock` (never leaves a bare title), `turnBlockInto`
    (text, heading, subheading, bulleted, numbered, quote, code — H1 stays the chapter title, and
    the schema has no H4), `setBlockHighlight`, `selectBlock`, `insertBlockBelow`,
    `setActiveBlock` (a faint background on the block the menu is open on);
  - a `highlight` attribute (amber, green, blue) on paragraphs, headings, quotes and lists: a
    reading aid kept with the chapter and not exported.
- `BlockMenu` (web) reuses what exists, so nothing new is metered:
  - **Edit with AI** selects the block, and the selection toolbar's edits apply (ADR-0066);
  - **Ask in chat** and **Review ▸ Find a source for it** are the toolbar's own actions;
  - **Review ▸ As an examiner** is the examiner review of a selection (ADR-0067); the other
    checks on one block are R26;
  - **Cite from your library** puts "@" before the paragraph's closing full stop, which opens the
    free library picker — it cannot cite anything the student has not added;
  - Move up/down, Duplicate and Delete call no model.
  The toolbar's three handlers became named functions in `ThesisEditor` that both call.

The menu's words are English for now, like the other screens added this week; the Hindi beta
(ADR-0061) catches up with them together.

## Evidence

`packages/ui/test/block-handle.spec.ts` (11): the block around a position, duplicate and delete,
the title untouched and never left bare, every Turn into and back, a whole list to paragraphs,
highlight kept through save and reload, the block selected for the toolbar, a line below with the
caret, the citation slot before a full stop, the active block followed through edits, the grip
reading its handler at press time.

Browser (real stack): every menu item on a written paragraph — highlight and clear, duplicate,
quote, subheading, move up, delete, Edit (toolbar shown), Ask in chat (box filled), Cite (picker
open, citation placed before the full stop), Find a source (Papers tab searching the paragraph),
As an examiner (2 flags written, ₹0.21), "+" (the "/" menu, Esc leaves an empty line), a drag
(the paragraph moved, not copied). Then undone.

Found on the way: TipTap's React view moves the editor into its own element after a plugin view
starts, so the handle's container is found again on every show; and inside a command, TipTap's
`state.selection` follows a new selection only after `state.tr` is read again — without that, a
list's second item stayed a list.
