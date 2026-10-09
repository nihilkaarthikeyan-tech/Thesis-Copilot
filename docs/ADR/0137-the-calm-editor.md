# ADR-0137 — The calm editor: a chat-first panel, one status line, one toolbar row

**Status:** accepted · **Date:** 2026-10-09 · **Changes:** the editor screen's layout only. No
feature, prompt, allowance or AI behaviour changes. **Approved by:** the owner, 2026-10-09
(`docs/design/calm-editor/after.png`, `calm-editor-review.pdf`).

## Context

The editor had grown a control for everything: three boxes above the first word (what the chapter
is for, the four-step first-session guide, the library-filling line), a two-row toolbar of 25
icons, and a header with nine controls. The panel opened on Sources, and its six tools were a
three-by-two grid of words. Next to Jenni's editor it read as busy, and the owner approved a calmer
arrangement of the same things.

## Decision

A rearrangement. Every control still exists, and every `data-testid` moved with its control.

1. **The tool panel opens on Chat.** The six tools (Chat, Sources, Papers, Citations, Check,
   Comments) are one `role="tablist"` of `role="tab"` buttons, each with the tool's name as its
   accessible name. From `lg` they are a rail of lucide icons on the panel's right edge, the name
   under each icon; in the phone/tablet drawer the same buttons are the old three-by-two grid. The
   panel header shows the open tool's name. The last tool chosen is remembered per thesis in this
   browser (`localStorage tc.tool.<documentId>`); the first open is Chat. From `lg` the header and
   the panel are sticky and the panel is the window's height, so the chat box sits at its foot.
2. **One status line above the text** — e.g. "15 papers found · 9 ready to cite · chapters
   planned" — with **Show**. Show opens the section guide, the first-session guide, the proposal
   prompt, the first-run hint and the library line: the same components as before. They stay
   mounted while folded, because two of them act on their own (the library line asks again for a
   suggestion that waited on papers; the section guide lays planned headings into a blank
   chapter). The guide's steps stay reachable after Hide through ⋯ → **First steps**.
3. **One toolbar row.** Undo/redo, text style, bold/italic/underline, link, **Cite** (new: types
   `@` at the caret, which opens the existing free library picker), lists, table and equation stay
   on the bar. Strikethrough, text colour, highlight, super/subscript, inline code, code block,
   block quote, display equation, footnote, figure, chart, diagram, cross-reference, caption and
   the table tools are under **More ▾**, each named, in a menu drawn in `document.body` and clamped
   to the window. Below `sm` undo/redo, lists, table and equation join More too.
4. **Header:** breadcrumb, Saved, Share, **Export** (now the primary button) and **⋯**, holding
   Usage (the Assist/Draft counter, which still opens the bars), History, How suggestions work,
   First steps, Keyboard shortcuts, Help, Feedback and the theme. There was no separate present
   mode: the monitor icon in the old header was the theme toggle's "System" face.
5. **Chat** — the scope chips above the question box — is done in parallel by another agent in
   `ChatPanel.tsx`. The panel header has an empty `#tool-panel-actions` slot for its "+ New chat".
6. **Wording:** the long sentences that sat permanently above the text are now behind Show; the
   status line is the short form.

## Consequences

- Specs updated for selectors that moved: a press on More or ⋯ first (`e2e/_editor.ts`), Sources
  pressed where a spec relied on it being the default, Show pressed where a spec read the guide.
- The phone keeps the bottom bar and drawers, with Chat first on the bar.
- `apps/web/e2e/calm-editor.spec.ts` checks the arrangement and that there are no layout faults
  at 1280 and 390.
