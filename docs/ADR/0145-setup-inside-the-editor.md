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

**Built and committed** on branch `worktree-agent-a441528b7ff4f71d0` (main merged in, 2026-10-09):
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

`start-writing-now.spec.ts` and `first-session.spec.ts` are rewritten to the card (helpers in
`e2e/_setup.ts`) and pass with `setup-card.spec.ts` on the mock stack (11 tests).
`e2e/_measure/first-session` now drives the card too (title Next → Skip field → Skip questions);
it has not been run. Writing those specs found one fault, fixed: Skip on the questions row was
disabled while the first question was still being written, and a press then could be lost; Skip
no longer waits for the question.

**Not done yet:**
- Time to first cited suggestion was **not re-measured** (the OpenAI account was out of credit);
  ADR-0070's ~14 s is still the last real number.
- Not checked on real models: the A.6 questions' option buttons in the compact row, and real
  sections laid as headings under the card (the mock plan has no sections).
- `meta.universityId` is read by chapter build's suggestion only, not by the export template.

**Next step:** once OpenAI credit is back, run `MEASURE=1` `_measure/first-session` (Start writing
now) on real models (budget ≤ ₹10), record the time against ADR-0070's ~14 s here and in the build
log, and look at the real questions and real section headings in the card; then release.

## Addendum (2026-10-09/10): the card on real models

Two agents ran the card against the real models (gpt-5-mini for the questions and the plan,
gpt-4.1-mini for the opener, Voyage for embeddings). What the mock stack had hidden:

**Found on 2026-10-09 (first agent, commit 087f1b7):**
- A first question that never arrived — OpenAI refused one call in six or so mid-stream while the
  account's credit ran out — left the row at "Thinking of the first question…" over a shut answer
  box for good. The row now says "The first question did not arrive." and offers **Try again**
  (`setup-aim-retry`); a proposal turn carries a 60 s limit (`PROPOSAL_TURN_TIMEOUT_MS`); the
  OpenAI adapter keeps the stream's own error so the call log says what OpenAI said.
- A real A.6 question is long — eight lines at 360 px, or three lines and four long answers — and
  pushed the chapter's heading below an 800 px screen. The question and its answers now scroll
  together on a short screen (max 22vh under 820 px tall); the answer box and Skip stay outside.
- A real model answers with a sharper working title than the one typed in row 1, and saving the
  answers makes it the thesis's title (FR-1.4). The result now shows "Your title becomes …"
  before Use.
- The real model sometimes has enough after two answers; the spec took three for granted.

**Found on 2026-10-10 (second agent):**
- **Every search for papers was answering nothing: the OpenAlex key's day was spent.** OpenAlex
  meters a key at $1 a day; a day of real-model test runs (each suggestion on an empty library
  starts a twelve-query search) spent it, and from then on every keyed request answered
  `429 {"message": "… you only have $0 remaining. Resets at midnight UTC", "retryAfter": 13177}`.
  The worker logged "openalex search skipped: HTTP 429", the other indexes found nothing relevant
  for a Karnataka rooftop-solar topic, and a new thesis sat at "Finding papers on your topic…"
  for eight minutes with 0 papers (both agents' measure runs). The same request **without** the
  key, in the polite pool, answered 200. `ScholarlyHttp` now treats a keyed 429 that asks for
  longer than any request waits (`MAX_RETRY_AFTER_MS`, 2 min — ADR-0050's spent-budget case) as
  "the key's day is spent": the same request goes again at once without the key, and every
  request until the reset goes without it. An ordinary 429 is still waited out with the key.
  Tests in `packages/retrieval/test/openalex-key.spec.ts`. The owner should still know the key
  is being spent by test runs — `docs/PENDING.md`.
- The other failures reported from the owner's stack (`#setup-aim-answer` never enabled, the
  question stuck on its placeholder, the heading-in-view checks) did not reproduce on this branch:
  `setup-card`, `start-writing-now` and `documents-beside` passed 11/12 on real models, the one
  failure a 5 s `toHaveURL` on `/app/new` that the dev server was still compiling (now 30 s, as
  the spec's other navigations). They were the first agent's faults above, seen on a stack
  running main before 087f1b7, under an exhausted OpenAI credit.
- The real first question put its choices inside one sentence ("Should the thesis focus on
  financial barriers, technical/infrastructural barriers, … or something else?"), so
  `questionOptions` found none to make buttons of and the row showed the answer box alone
  (`real-3-aim.png`). Answering in the box works; the compact row's option buttons were seen on
  the mock's enumerated question only.
- Seen, not fixed: after Skip on the questions the editor asks for the opener **twice**, about a
  second apart, and the first request is cancelled by the editor itself (`AiCallLog` row
  `ASSIST ok=false "This operation was aborted"`, 0.6–1.3 s in, one per new thesis, a few more
  through the five-row path). It costs a part-call and counts as a failed call in the admin's
  numbers. The second request is the one the student sees. Which transaction cancels the first
  (the card's `offerFirstLine` cursor move or the poked opener timer) is not yet pinned down.

**Measured (2026-10-10, real models, `MEASURE=1 e2e/_measure/first-session`, Start writing
now):** editor at 4.0 s, card taken (Next, Skip, Skip) at 5.0 s, the opener's cited first
sentence at **19.3 s** from the press ("More than 70% of India's population resides in rural
villages…", cited) — against ADR-0070's ~14 s without the card, and against 8+ minutes with the
key spent. Three suggestion requests on the way: two answered "papers loading" (no model call),
the third cited. Screenshots of the real questions and real section headings in the card:
`docs/design/setup-in-editor/built/real-3-aim.png`, `real-4-chapters.png`, `real-360-aim.png`,
`real-360-chapters.png`.

Spent by the second agent's real-model runs: ₹12.51 in all (`AiCallLog` since the branch's
stack started) — ₹8.24 before the fix, twelve outline plans at ₹0.67 each being most of it,
₹4.27 for the measurement and the screenshots after.
