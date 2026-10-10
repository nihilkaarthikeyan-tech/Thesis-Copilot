# ADR-0151: A faster first cited sentence, and an honest one

**Date:** 2026-10-10 · **Decided by:** the owner asked for it (deadline the same day), from the
side-by-side study `docs/research/SIDE-BY-SIDE-2026-10-10.md` (journey 1; "Where Jenni still
beats us" items 2 and 3); the lead agent took the calls below.

## Context

Measured on production on 2026-10-10: Jenni takes ~51 s from a new document to its first cited
sentence (≤ 16 s of it after Start Writing); ours took ~70–85 s. Ours had five setup rows (title
and style → field and university → a research-design question → aim and objectives → chapters →
first line) and the opener was held until the aim row was answered (ADR-0145's call), so the
plan and the first sentence waited on two optional rows. And the first sentence production
offered cited a South African scoping review for a Karnataka thesis — our own checks flagged it
twice — because nothing in the automatic library was about Karnataka.

## Decision

**1. Four rows, and nothing waits on the optional ones.**
- The field (still guessed from the title by `suggestDiscipline`, in code) and the university
  are a folded, optional line of the title row ("Field and university: … Change"), not a row of
  their own. The card counts "n of 4" (`SETUP_ROWS`, `setupRow`); a card saved on the old
  `field` step shows the aim row.
- **Next on the title row starts three things at once:** the paper search (ADR-0070, as
  before), the chapter plan from the title (`POST /outline/plan-from-title`, ADR-0072), and the
  cited opener (the editor stops holding it once the title is set). The questions stay open
  beside them.
- **The answers refine the aim and objectives only** (`PUT /memory/scope`). They no longer plan
  the chapters a second time (`/outline/generate`): that was a second outline run (₹0.67) and
  could replace headings the student had already written under once the plan landed early. The
  plan job reads the saved scope when it runs, so answers given before it starts are used at no
  cost; after that, the chapters are the title's. Skip asks for the title plan again only in
  case the first request was refused (a plan already there or on its way answers 409 or "the
  same plan" and costs nothing).
- The card never moves the cursor under a suggestion that is already on screen (it only gives
  the editor the keyboard back), and never takes focus from an answer being typed.
- The first-line row is shown from its own step, like every other row: the sentence is on the
  page from Next, and the waiting line pushed the chapter heading off a 360 px phone.

**2. No first sentence that cites another place.** `settingWithoutPapers(title, papers)`
(`packages/ai/src/builder/setting.ts`, beside ADR-0135's setting measure, using its place list
and `ownPlaces`): the place the thesis's title names that no paper's title or abstract names, or
a place the thesis owns (a Karnataka thesis owns India; an India thesis owns every state). In
`AssistService.suggest`, for a chapter's first sentence (fewer than three words outside its
headings) with passages retrieved and the default cite mode: if no **citable** paper (one with
chunks) names the place, there is no model call and the unit goes back. While papers are still
arriving the answer is the ADR-0070 `papersLoading` one (the editor asks again when the next
paper is ready); once nothing more is coming it carries `settingGap: "Karnataka"`, and the setup
card says "No paper on Karnataka yet, so no first sentence is offered … Find papers" (the editor
notice says the same when the card is not on screen). A title that names no place is never held.
Places only: a population word list ("rural households") would hold back honest sentences far
more often than it caught a mismatch, and `RELEVANCE_FLOOR` already refuses the off-topic case.

No migration, no new prompt, no new metered action. English and Hindi strings.

## What this changes in earlier ADRs

- **ADR-0145:** five rows become four; "the opener is held until the aim row is answered" is
  reversed (held only until the title); the aim row no longer plans the chapters.
- **ADR-0091:** the start questions' answers make the aim and objectives, not the chapter plan.

## Measured

**Clicks and screens before the first sentence is asked for (mock stack, Playwright):**
before, New → Next → Skip (field) → Skip (questions): **4 presses, 3 card rows**. After, New →
Next: **2 presses, 1 card row** — `setup-card.spec.ts` → "the plan and the first sentence start at
the title row, with the questions open" waits for the `/assist/suggest` and
`/outline/plan-from-title` requests after Next alone and finds the card still on the aim row.

**Real time (real models, `MEASURE=1 e2e/_measure/first-session`, Start writing now, API :3031,
web :3030, Redis db 7):** editor at 3.2 s, Next at 3.4 s, the first suggestion request at
**4.3 s** (0.9 s after Next; before, the request waited for two Skips), the planned headings at
~36 s and an uncited opener at 38.9 s. **The time to the first cited sentence was not
measurable:** OpenAlex's keyless pool for this machine was spent (`429`, `X-RateLimit-Remaining-
USD: 0`, reset ~10.5 h away; the production key stays commented out of `.env`), and the library
held 0 papers for the whole eight minutes. One run only, as instructed. Twelve suggestion
requests, all `ok` — the double request with an aborted first one (ADR-0145 addendum) did not
appear. Spent: ₹1.59 (ASSIST ₹0.75, OUTLINE ₹0.77, EMBED ₹0.03, PROPOSAL ₹0.04).

**Tests:** `packages/ai/test/setting.spec.ts` (+4), `packages/types/test/setup-card.spec.ts`,
`apps/api/test/setting-gap.spec.ts` (new, 3: no call and no unit with only a South African paper;
a chapter with its first sentence is not held; an India abstract lets it through), and on the
mock stack `setup-card` (10, the layout audit at 360/430/768/1024/1440 × 800 with the field line
open and the heading in view), `start-writing-now` (2), `first-session` (1), `documents-beside`
(1): 14 of 14.

## Not done

- A fresh cited-sentence time needs a funded OpenAlex key or tomorrow's keyless pool.
- The setting-gap line has not been seen on real models (it needs a library that has finished
  filling with no paper on the place).
