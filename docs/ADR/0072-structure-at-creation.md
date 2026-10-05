# 0072 — Structure at creation: chapters planned from the title, a Sections panel

Date: 2026-10-05
Status: accepted
Follows: the side-by-side study (`docs/research/side-by-side-2026-10-05.md`, item B1), ADR-0062
(Start writing now), ADR-0070 (first session), ADR-0071 (Draft mode drafts the heading under the
cursor).

## Context

When a student starts a document, Jenni turns the topic into about nine headings within ten
seconds. A left "Section prompts" panel then shows each section with two or three lines of what it
should argue and a Generate button.

Ours, "Start writing now", opened one empty "Chapter 1". An outline came only from the proposal
path or the Outline page, so a student who started writing was left asking "what now?". The
scaffold panel (FR-4.2) showed a chapter's scope note and sections when there was an outline, but
had nothing to press.

## Decision

### 1. The chapters are planned from the title, in the background

- **Same job, same prompt.** It is the existing `generate-outline` job (A.9, `outline.md`,
  unchanged). The working title is the thesis title; the problem statement and objectives are
  empty; there is no gap map. The job carries `fromTitle: true`. If a proposal is saved before the
  job runs, the proposal is used instead.
- **`DocumentMemory.scope` stays empty.** Writing the title into it would make the proposal screen
  and the next-action guide think a proposal had been saved.
- **Triggers.**
  - `POST /documents` with `start: 'writing'` (the Start-writing-now buttons on `/app` and
    `/app/new`) and a title that names a topic (`namesATopic`, moved to `documents/topic.ts`).
  - `POST /documents/:id/outline/plan-from-title`: the panel's "Plan my chapters from the title"
    button, offered for any thesis with no outline and a real title (`canPlanFromTitle` on
    `GET /outline`).
  - The proposal path is unchanged. It plans from the proposal when the proposal is saved, and does
    not re-plan a thesis that already has chapters.
- **A refusal never fails the create.** A refused automatic plan means only that the student gets
  the button instead.

### 2. Metering and cost

`OUTLINE` has no §11.3 cap; §11.4 prices it once per thesis in the one-time line. It is still not
a metered action, so no unit is taken from any allowance. A title plan is bounded three ways, all
checked before anything is queued:

1. **A monthly count of title plans.** `AUTO_OUTLINES` in `plans.ts`: 2 on the trial, 5 on the
   paid plans. It is counted from `OUTLINE_FROM_TITLE` audit events. Past it, the refusal is a 429
   `CAP_EXCEEDED`: "You have used all 5 of this month's chapter plans from a title."
2. **The per-thesis limit.** `OUTLINE_CALLS_PER_DOCUMENT` (12) was assumed by the cost model but
   never enforced. It is now enforced for every whole-outline run (from the title or from the
   proposal), counted from the `OUTLINE` rows of the call log, and returns a 409.
3. **The money checks of a metered action.** `UsageService.spendAllowed` refuses for an ended
   trial, the student's ₹100 ceiling and the site budget, each with its usual error.

**Cost.**
- Measured on `gpt-5-mini` on 2026-10-05: one title plan took 34 s, 992 input and 3,791 output
  tokens (reasoning included), **₹0.68**. The profile prices it at ₹0.48.
- A Start-writing-now thesis gets one plan. Because the proposal path does not re-plan a planned
  thesis, a typical thesis still has one outline call, which the one-time line already covers.
- Worst case beyond that line, a student starting a new thesis every few days:
  - 4 × ₹0.68 = **₹2.72 a month** on a paid plan;
  - ₹0.68 on the trial.
- With ADR-0051's `gpt-4.1-mini` fast tier, a fully active student goes from ₹85.82 to at most
  ₹88.54, still within the ₹100 ceiling. The runtime ₹100 hard stop applies in any case.

### 3. Chapter 1 when the plan lands

The worker's `syncChapters` already adopts a thesis's only chapter as the plan's first
(2026-10-04). This holds for a title plan:
- The row keeps its id. Its `outlineNodeId`, title, scope note and order are updated.
- Its **content is never touched**. A test asserts that no update carries `content`.
- The other chapters are created. Nothing is deleted.

So a student typing in "Chapter 1" while the plan is made keeps every word, in the chapter they
are looking at, now named "Introduction".

Two small follow-ons:
- **The placeholder heading.** If the chapter's top heading is still our placeholder
  ("Chapter N"), the Sections panel renames it to the planned title in the editor, as an editor
  change that autosaves like any other. It does this only when the heading reads exactly
  "Chapter N"; anything the student typed there is left alone.
- **A stale node id.** An editor opened before the plan still holds the placeholder node id
  (`ch-1`). Draft mode, in the API topic check and the worker's `sectionFor`, now falls back to
  the chapter row's own `outlineNodeId` when the sent id is not in the outline.

### 4. The Sections panel (`SectionGuide.tsx`)

It replaces the scaffold panel in the editor (the one mount; `ScaffoldPanel.tsx` is removed). It
shows:
- **While the plan runs:** "Planning your chapters from your title…" with three placeholder lines,
  so the page does not jump when the plan lands. It polls `GET /outline` every 4 s and fills in
  without a reload. The chapter rail's line now says "Building your chapters…" whatever the source.
- **With no plan:** "Plan my chapters from the title". After a failed run, "Try again".
- **With a plan:** what the chapter is for, then each section with:
  - its scope note as up to three short lines (its sentences);
  - **Add heading here** (or **Go to heading** once it is in the chapter). It inserts the section
    title as an h2 after the block the cursor is in, never splitting a sentence, and puts the
    cursor under it;
  - **Draft this section.** It adds the heading if missing, places the cursor at the end of that
    section, and dispatches `DRAFT_SECTION_EVENT` on the editor, which `DraftMode` handles like
    Ctrl+Shift+D. ADR-0071 then drafts the heading under the cursor, as a pending draft block the
    student must accept.
- **Folding:** folded on a phone, as the scaffold was, and remembered when hidden.

Nothing enters the chapter unless the student presses a button.

### 5. Placeholder sections from a title-only plan

The real-model probe (`packages/ai/scripts/probe-outline-from-title.ts`) returned 6 chapters with
3–5 sections each. With no gap map, though, A.9's Literature Review rule made the model write
slots: "Sub-theme 1 (populate from gap_map)" three times, and "(insert objectives)" inside scope
notes.

The prompt is not changed (ADR-0038: only through an evaluation round). Instead,
`dropPlaceholderSections` (`@tc/ai`) removes such sections and fill-in parentheticals after
`enforceTemplateShape`, for every outline run. Chapters are never dropped.

### 6. Failed and dead runs

- The worker now marks `outlineRun` FAILED when the last attempt fails. Until now it stayed
  RUNNING for ever after any failure, and with this panel that would have meant "Planning…" for
  ever.
- A RUNNING mark older than 15 minutes is treated as dead.
- The worker's outline call now has a 180 s time limit, as every model call must.

## Not changed

- No prompt changed. No new metered action, and no allowance row on the usage screen.
- The proposal path plans as before.

## Tests

- **API (testcontainers, `plan-from-title.spec.ts`, 8):**
  - Start writing now with a real title queues one `fromTitle` job, leaves the scope empty, and a
    second press is the same plan;
  - a placeholder title and the proposal path queue nothing;
  - the button plans a thesis with no outline and refuses one that has chapters;
  - **cap tests:** the monthly count (create succeeds, no plan; the button gives 429), an ended
    trial (402), and the per-thesis limit (409 for the title and for the proposal path).
- **Worker:**
  - the title becomes the working title only when asked, and a saved proposal wins;
  - Chapter 1 is adopted without any `content` write and not duplicated;
  - Draft mode finds the planned section from the stale `ch-1`.
- **AI:** `dropPlaceholderSections` on the observed titles.
- **Web:** `section-guide.spec.ts` (bullets, which heading is a section's, where a section ends,
  where a heading goes).
- **Browser:** the mock stack on :3200/:3201, worker on Redis db 5, checked:
  - the plan landing while the student types;
  - the heading renamed;
  - Add heading and Draft this section, with the heading in the job;
  - the planning state;
  - the button's cap refusal.
- **Real model:** one probe, above.
