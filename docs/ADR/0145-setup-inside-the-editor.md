# ADR-0145: Set up a new thesis inside the editor

**Date:** 2026-10-09 · **Decided by:** the owner delegated the design calls (2026-10-09) after seeing
`docs/design/setup-in-editor/`; the lead agent took the four open ones listed below.

## Context

A new student went through `/app/new`, then Sources and citations, then Structure, then the start
questions, and only then reached the editor (ADR-0062, ADR-0087, ADR-0091). Jenni sets a new
document up inside its editor. The design (`docs/design/setup-in-editor/NOTES.md`, the review PDF,
`after.png`, `after-steps.png`) moves the same steps into a card in the editor.

## Decision

**New thesis opens the editor at once.** `POST /documents` with `title: 'Untitled thesis'` (or the
title already typed), `start: 'writing'`, `askFirst: true`, `setup: true` makes the thesis and
`Document.meta.setup = { step, done, dismissedAt, aim, chapters }`; the browser opens its first
chapter. A **Set up this thesis · n of 5** card sits between the status line and the toolbar, in
the ADR-0137 calm-editor look (one bordered surface, rows, one primary button at a time):

1. **Title** — working title, citation-style chips, a folded Sources line whose Change opens
   `SourcePrefsFields`; links to start from a paper I wrote (`/app/new?start=paper`), import
   chapters from Word (opens the existing dialog), plan with a full proposal (`/proposal`).
2. **Field** — field (guessed from the title by `suggestDiscipline`, in code, no model call) and
   university (`UNIVERSITY_PROFILES`); both optional, Skip.
3. **Aim** — the ADR-0091 start questions one at a time with their suggested answers
   (`GET/POST /proposal`, then `PUT /memory/scope` + `POST /outline/generate`), or
   "Skip — plan my chapters from the title" (`POST /outline/plan-from-title`).
4. **Chapters** — the plan fills the chapter list and the page in place (the section guide lays the
   headings); Keep these chapters · Standard chapters · No headings · Edit the outline.
5. **First line** — the cited opener (ADR-0078) under the first heading; writing or accepting a
   sentence of three words or more finishes the card.

Finished rows fold to one line with Edit/Change. **Finish later** folds the card into the status
line ("set up 2 of 5"); Show and ⋯ → First steps bring it back. Once done the line says "set up"
and the folded rows stay under Show.

New API, all free, no model call: `PUT /documents/:id/setup` (title, which starts the ADR-0070
paper search keyed on that title; source settings; `Document.field`; `meta.universityId`; the card
state) and `POST /documents/:id/outline/restart` (Standard chapters or one chapter in place of a
plan, refused with 409 once any chapter has writing; the open chapter keeps its row). `GET
/documents/:id` also returns `field` and `citationStyle`. Chapter build prefills the university.
No migration. No new prompt, no new metered action.

**The lead agent's calls:** an untouched "Untitled thesis" from New (card still on the title row,
no words beyond chapter headings) leaves the theses list after 24 h — hidden, not deleted, back as
soon as it is named or written in; the opener is never overwritten by headings arriving later (the
opener is held until the aim row is answered, then offered under the chapter title, and the
section guide's R5 layout puts an accepted sentence under the first section heading); a refusal
shows inside the card with the ADR-0122 limit text and "Start without a plan"; on a screen up to
820 px tall the open row's body scrolls (max 40vh, buttons outside the scroll) so the chapter's
heading stays on screen.

## What this changes in earlier ADRs

- **ADR-0062** (Start writing now): the button still makes an untitled thesis and opens the editor,
  but now via the card; `/app/new` and the list's first-thesis form keep the button.
- **ADR-0070** (first session): the paper search for a New thesis starts when row 1 is confirmed,
  not at creation; the four-step guide, the proposal prompt and the first-run hint wait while the
  card is unfinished (the guide still opens from ⋯ → First steps).
- **ADR-0087** (sources and structure steps): the steps leave `/app/new` and the list; sources are
  row 1, structure is row 4 (offered after the plan, not before). `StartSetup` is removed.
- **ADR-0091** (start questions): the questions are row 3 inside the editor. `StartQuestions` is
  removed.

## Status (2026-10-09, end of day)

**Built and committed** on branch `worktree-agent-acf9f680fc3a23b85`:
API route, restart route, list hiding, build prefill, `@tc/types` setup state; `SetupCard`,
`SetupAim`, the editor wiring (opener hold, status line parts, guides waiting, First steps); New ▾,
`/app/new` and the list's form opening the editor; en + hi strings and the regenerated
`docs/i18n/hi-review.md`.

**Works (proved):** `apps/api/test/setup-card.spec.ts` (5), `packages/types/test/setup-card.spec.ts`
(5), `apps/web/test/setup-card.spec.ts` and `question-options.spec.ts` pass. The new Playwright
`apps/web/e2e/setup-card.spec.ts` passes against the branch's own API, worker (mock models, Redis
db 5) and web: the five rows end to end, Finish later / Show / First steps, Skip → Standard
chapters, and the layout audit at 360/430/768/1024/1440 × 800 px with no layout faults and the
chapter heading in view at every row. Screenshots: `docs/design/setup-in-editor/built/`.

**Not done yet:**
- The existing Playwright specs that drove the old start steps (`start-writing-now.spec.ts`,
  `first-session.spec.ts`, and `e2e/_measure/first-session` plus the demo/side-by-side `_measure`
  specs) still press `setup-next` / `setup-start` / `start-questions-skip`, which no longer exist;
  they will fail until rewritten to the card.
- Time to first cited suggestion was **not re-measured** (the OpenAI account was out of credit);
  ADR-0070's ~14 s is still the last real number.
- Not checked on real models: the A.6 questions' option buttons in the compact row, and real
  sections laid as headings under the card (the mock plan has no sections).
- `meta.universityId` is read by chapter build's suggestion only, not by the export template.

**Next step:** rewrite those specs to New ▾ → card (title → Skip field → Skip questions → Keep), run
the touched specs on the mock stack, then `MEASURE=1` `_measure/first-session` on real models once
credit is back (budget ≤ ₹10) and record the time here and in the build log.
