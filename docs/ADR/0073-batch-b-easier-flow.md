# 0073 — An easier flow: back to the last chapter, one card, one Check panel

Date: 2026-10-05
Status: accepted
Follows: the side-by-side study (`docs/research/side-by-side-2026-10-05.md`), batch B.
Batch B's largest item, structure at creation, is ADR-0072.

## Context

Against Jenni, on production:
- **Coming back:** Jenni reopens the last document; we showed a list.
- **The editor:** three cards stacked above the page (the proposal prompt, the 4-step guide, the
  first-run hint) and a bar of eight keyboard shortcuts.
- **Checking:** spread across a tab called "Flags", while a tab called "Review" held the
  supervisor's comments.
- **Library chat:** said nothing while it worked.
- **"Read" from Find papers:** opened a new browser tab.

## Decision

1. **Back to the last chapter.**
   - The first visit to the thesis list in a browser session goes to the chapter last open, when
     that thesis still exists. Every later visit shows the list: the "Theses" crumb, links, `?new`.
   - The session mark is set by opening any chapter, so a student who has been writing this
     session always gets the list.
   - A spinner shows while this is decided.
2. **One card above the page.**
   - While the next-step guide shows, the proposal prompt and the first-run hint wait.
   - The guide's last step is planning (the proposal), and its suggestion step links the 90-second
     walkthrough.
   - "Hide" on the guide brings them back.
3. **A shorter key bar.**
   - Suggest, a new **Draft a section** button, and three keys (Ctrl+/, Tab, Esc).
   - The rest of the keys behind "More keys".
   - Draft mode now also answers a window event (`tc:draft-section`), so any button can ask for
     it.
4. **Plain names.** The "Flags" tab is **Check**, and "Review" is **Comments**. The citation
   report's pointer says "the Check panel".
5. **Library chat shows its steps**, as the beyond-the-library path already did: "Searching your
   library…", "Reading N passages from M sources", "Writing the answer".
6. **"Read" in Find papers opens the paper beside the chapter** when the screen has room; a new
   tab only when it does not (as "Read PDF" in the Sources tab already did).
7. The form's "Start from" question is labelled for what it is: "If you plan it with a proposal,
   start from". "Start writing now" does not use it.

**Moved to the prompt round with C5:** an opening sentence on an empty section. It is a change to
A.1's behaviour, so it needs its own ADR and an evaluation on the real models.

## Tests

- Onboarding and Start-writing-now specs now walk the guide: walkthrough from the guide; "Hide"
  brings back the hint and the proposal prompt.
- Tab names in eleven specs follow the rename.
- 40 related specs pass. `journey` passes alone (3 of 3) and is flaky only under three parallel
  workers, as its own comments record.
