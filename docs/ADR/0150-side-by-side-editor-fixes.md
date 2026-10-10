# ADR-0150: The side-by-side's editor faults, fixed (2026-10-10)

**Date:** 2026-10-10 · **Status:** built, proved in a browser on the mock stack · **Asked by:** the
owner, from `docs/research/SIDE-BY-SIDE-2026-10-10.md`

## Context

The full side-by-side with Jenni (2026-10-10) found eight faults in our editor that a student meets
in the first ten minutes. None needs a prompt change; each is a screen or a post-processing fault.

## Decisions

1. **The suggestion bar sits under its suggestion** (`ours-1g`). It was fixed to the foot of the
   window and covered the paragraph. It is now measured from the ghost span on every scroll,
   resize and transaction: under the last line, above the first when there is no room, the old
   place only when the suggestion is off screen. Its menu and card open toward the larger room and
   are held to that room (they scroll inside), so neither runs off the window.
2. **One floating layer at a time** (`ours-2e`, `ours-2f`). Refine closes the evidence card, the
   card closes the menu, and a refined suggestion (a new `currentId`) closes the old card.
3. **The selection edit panel closes on Discard and Escape** (`ours-5c`). Closing collapses the
   selection to its end, since the panel follows the selection. Escape in the editor is not gated
   on `defaultPrevented`: ProseMirror marks every Escape handled before a DOM listener on the
   editor runs, which the browser run showed.
4. **A suggestion's citation is drawn in the thesis's style from the first moment** (finding 4).
   The grey text said "(Mutumbi 2024)" and the kept node "(Mutumbi et al., 2024)". The API
   renders each cited source with citeproc, appended after the thesis's own citations
   (`CitationsService.suggestionLabels`, like ADR-0068's `quoteLabel`), so author-date
   disambiguation and numeric numbering are the thesis's. A note style gives nothing and the short
   reference stays (its label is a whole footnote). The editor seeds the node with the same label
   on accept, so nothing changes when the suggestion is kept.
5. **The export preview draws each citation** (`ours-7a`, "…communities ."). `previewBlocks`
   reads the label by node key from `/documents/:id/citations`, with the editor's own map on top
   for a citation placed since the last save; an unrendered one is "(Source)".
6. **The library header counts one way** (`ours-4e`). "No PDF" now excludes a paper read in full
   from an open-access text source, as "with full text" and the Full text chip already did.
7. **A citation goes inside its sentence's full stop, and one paper is cited once per
   suggestion** (`placeCitations`, `packages/ai/src/builder/citation-placement.ts`, its own
   tests). It runs after `academicPunctuation()` (ADR-0147), which is unchanged, as are the
   prompts.
8. **The scaffold survives the first click and the first undo** (`ours-2a`, `ours-2b`). The
   headings laid out when the plan lands are not an undo step (`addToHistory: false`), so Ctrl+Z
   undoes the student's last change and leaves the sections. A chapter opens with the caret in
   the first empty paragraph under a section heading, not in the title; and for 2.5 s after the
   layout a click that lands in a heading because the page moved is taken as meant for the line
   below.

Finding 9 (trial caps bite in minutes) is the owner's: it goes in `docs/PENDING.md` with the
usage-limit rebalance. No cap was changed.

## Consequences

- Assist does one more read per suggestion (chapters and sources of the document) and one
  citeproc pass. No provider call, no unit.
- Proof: `apps/web/e2e/_measure/adr-0150.spec.ts` (MEASURE=1) on the mock stack, at 1440 and
  360 wide; the layout audit at 360/430/768/1024/1440, 150 screens, 0 faults.
- Not proved in the browser: the undo after a real plan lands (the mock plan has no sections).
  The caret and the undo of typing under existing headings are proved.
