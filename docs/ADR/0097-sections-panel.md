# 0097 — The Sections panel on the left

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R10; inventory §10, §12 C3, §13.3)

## Context

Jenni's left panel lists every section of the document with its notes, editable in place, the
sources for it and Generate; a heading typed in the page appears there at once. Ours: the chapter
rail listed the open chapter's headings live (coverage-map row 73) and the Sections guide above the
page (ADR-0072) showed each planned section's note read-only, with notes edited only on the Outline
screen. A heading the student typed had no note anywhere, so Assist and Draft had nothing to follow
under it.

## Decision

- The rail's list of headings (`ChapterContents.tsx`) is the Sections panel. Each heading opens to
  show its note — the same note Assist (`sectionUnderHeading`) and Draft read — with **Edit note /
  Add a note**, **Draft** (the cursor in that section, then Draft mode's pending block, as the guide
  above the page does) and **Sources** (the cursor in that section, then the Sources tab, whose
  section pins ADR-0085 already scopes to it).
- `PUT /documents/:id/outline/section-note` sets one note: the section is found under the chapter's
  outline node by its heading's words (`headingKey`); a heading the plan lacks becomes a section of
  that chapter (id from the chapter's and the heading's words), so its note is read from then on.
  The outline row is locked (`SELECT … FOR UPDATE`) for the read and the write, so the Outline
  screen saving at the same moment cannot lose the note, nor the note the screen's change. Free.
- The guide above the page stays for what the rail cannot show: the plan being made, "Plan my
  chapters", and what the chapter as a whole is for.

## Evidence

`apps/api/test/section-notes.spec.ts` (3): a planned section's note updated by its heading
("1.1 Problem statement"), nothing else changed; a typed heading added as a section and read by
`sectionUnderHeading`/`scopeWithSection`, and saying it again updates rather than duplicates; a
chapter outside the outline told so, another student's thesis not found.

Browser, real stack: the four planned sections listed with their notes; a heading typed into the
page listed at once, given a note, saved into the outline (`ch1-introduction-heat-and-sleep-loss`);
Sources opened the Sources tab on "This section: Heat and sleep loss"; Draft sent its event with the
cursor in that section (stopped before it spent a unit — the same event the guide's Draft button
has used since ADR-0072). Then undone.
