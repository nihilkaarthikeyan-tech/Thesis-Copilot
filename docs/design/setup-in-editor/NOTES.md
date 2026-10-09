# Setup in the editor: design notes

**Status:** design only, waiting for the owner's approval. No product code has changed.
**Pictures:** `before.png` (six screens from the dev stack, 2026-10-09, v0.1.36), `after.png`
(the editor at step 4 of 5), `after-steps.png` (the card at steps 1, 2, 3 and 5),
`setup-in-editor-review.pdf` (the same pictures plus the table below). The raw screens are in
`today/`.

## The change

Jenni sets a new document up inside its editor. Today a new student goes through `/app/new`,
then Sources and citations, then Structure, then the start questions, and only then reaches the
editor. There they find "Chapter 1" while the plan is still being built, and a four-step guide
under Show.

After the change, **New thesis opens the editor at once.** A **Set up this thesis** card sits at
the top of the empty chapter, below the status line and above the toolbar. It has five rows:

| # | Row | What it does | Folds to |
|---|---|---|---|
| 1 | Title | Working title, citation style chips, and a Sources line with Change, which opens today's `SourcePrefsFields`. Links: start from a paper I wrote · import chapters from Word · plan with a full proposal. | `✓ Title …  Edit` and `✓ Sources APA 7 · web and library …  Change` |
| 2 | Field | Field (guessed from the title) and university. Both optional, with Skip. | `✓ Field Energy and environment · university not set  Change` |
| 3 | Aim | Today's start questions (`PathAChat`, A.6), one at a time, or "Skip, plan my chapters from the title". | `✓ Aim <focus> · 3 objectives  Edit` |
| 4 | Chapters | The plan appears **in place**: chapters and sections fill the chapter list, and Chapter 1's sections become headings on the page. Buttons: Keep these chapters · Standard chapters · No headings · Edit the outline. | `✓ Chapters 6 planned  Edit the outline` |
| 5 | First line | The cited opener (ADR-0078/R5) waits under the first heading, with the suggestion bar. Accepting or writing a sentence completes setup. | The card folds into the status line ("… · set up · Show") |

**Finish later** folds the whole card into the status line at any step, and Show brings it back.
The card uses the calm editor's look: the same tokens, Satoshi for the UI and Spectral on the
page, one bordered surface, rows rather than nested boxes, and one primary button at a time.

## What moves where (nothing is removed)

| Today | After | Calls today (existing APIs) |
|---|---|---|
| `/app/new` paper or topic | Links in row 1. A paper opens the proposal screen (Path B upload), a full proposal opens `/proposal` (Path A). `/app/new` stays for old links and `?start=`. | `POST /documents` · `POST /documents/:id/seed-papers` · `GET/POST /documents/:id/proposal` |
| Working title | Row 1 | `POST /documents` (`title`) · today a later rename goes through `PUT /documents/:id/memory/scope` (`workingTitle`) |
| Create and import from Word | Row 1 link, and Import from Word in the chapter list, as today | `POST /documents/:id/import-docx` |
| Citation style (asked twice today) | Row 1, once | `PUT /documents/:id/citation-style` |
| Sources and citations step | Row 1's Sources line, with the same fields | `PUT /documents/:id/source-prefs` (or `sourcePrefs` on `POST /documents`) |
| Paper search at creation (ADR-0070) | Starts when row 1 is confirmed | Today runs inside `POST /documents` (`autoSources.start`) · `GET /documents/:id/sources/progress` |
| Structure step (ADR-0087) | Row 4 buttons | `structure` on `POST /documents` · `POST /documents/:id/outline/plan-from-title` · `PUT /documents/:id/memory/outline` · `GET /documents/:id/outline` |
| Start questions (ADR-0091) | Row 3 | `GET/POST /documents/:id/proposal` · `PUT /documents/:id/memory/scope` · `POST /documents/:id/outline/generate` |
| "Planning your chapters…" card, chapter list "Building your chapters…" | Fills in place. The section guide already lays planned headings into a blank chapter. | `GET /documents/:id/outline` (SectionGuide) |
| Four-step guide (ADR-0070) | Rows 4 and 5 cover write and suggest. The guide stays under Show and ⋯ → First steps, and waits while the card is open (as ADR-0073 does for the proposal prompt). | none (localStorage) · `GET /documents/:id/setup` |
| First cited suggestion | Row 5 | `POST /assist/suggest` · `POST /assist/outcome` |
| Field (not asked today) | Row 2 | `field` on `POST /documents` exists; chapter build asks discipline and university on `/build` |

## What would need building

1. **Web: `SetupCard`** in `components/onboarding/`, mounted in `ThesisEditor` above the toolbar.
   It reuses `StartingStyle`, `SourcePrefsFields`, `PathAChat` and `LimitNotice`, plus the
   structure options from `StartSetup`. Its rows are folded and unfolded the way `StartSetup`'s
   summaries already are.
2. **New thesis goes straight to the editor.** The thesis list's New button and the New ▾ menu
   call `POST /documents` with `title: 'Untitled thesis', start: 'writing', askFirst: true`, then
   open `/write/<firstChapterId>?setup=1`. `/app/new` stays.
3. **API: setting the title starts what creation starts today.** A small `PUT /documents/:id/title`
   (or a `setup` step on an existing route) sets the title, starts the auto-sources run that
   `POST /documents` starts today (`namesATopic` is false for "Untitled thesis", so no search runs
   at creation), and stores the source preferences. No new model call.
4. **Setup state on the document**, `Document.meta.setup = { step, done, dismissedAt }`, so the
   card comes back on another device and is not shown to an existing thesis. No migration is
   needed if it lives in `meta`.
5. **Field and university.** Write `Document.field`, which exists, and add `meta.universityId`.
   The guess is a keyword match against the discipline profiles in `packages/config/src/profiles/`,
   in code with no model call. Chapter build (`/build`) prefills from both.
6. **Row 4 after a smart plan.** Standard chapters and No headings only exist at creation today.
   They need a route that replaces the plan with `TEMPLATE_SPECS.STEM_EMPIRICAL`, or with one
   chapter, offered **only while every chapter is empty**.
7. **Ordering the opener against the plan.** Hold the opener until row 4 is answered, or let
   SectionGuide lay the headings *above* an accepted opener. Today it lays headings only into a
   blank chapter.
8. **i18n** (en + hi) for the card's strings, and `data-testid`s for each row.
9. **Proof.** Update the specs that drive `/app/new` (`start-writing-now`, `first-minutes`,
   `first-session`, `e2e/_measure/first-session`), add `setup-card.spec.ts`, run the layout audit
   at five widths, and re-measure time-to-first-cited-suggestion against ADR-0070's ~14 s.

## Risks

- **Empty "Untitled thesis" rows.** Pressing New and leaving now makes a thesis. Either create
  the row on row 1's Next (the card then runs before a document exists, which is harder), or hide
  untouched untitled theses from the list after a day. Hiding them is recommended, and it needs an
  owner call.
- **The plan-from-title allowance.** A refusal must show in the card with `LimitNotice`, as
  `StartQuestions` does today, with "start without a plan" kept.
- **Opener and plan racing** (item 7). If the student accepts the opener before the plan lands,
  the headings must not overwrite or scatter it.
- **Standard chapters or No headings after planning** would drop planned chapters. They must be
  refused once any chapter has text.
- **Height on a laptop.** At step 3 the card is about 430 px tall, so the page starts below the
  fold at 768 px. Finish later and the per-row folding keep this short, and the card scrolls with
  the page rather than being sticky. On a phone it is full width in the page column, and the
  drawers are unchanged.
- **Two guides at once.** While the card is open the four-step guide, the proposal prompt and
  the first-run hint wait (one rule, as in ADR-0073).
- **Spec churn.** Many e2e specs start at `/app/new`. They keep working because `/app/new` stays,
  but the default New button changes.
- **Cost.** No new prompt, model call or allowance. The same routes are called in a different
  place.

## Estimate

About **5–6 working days**: 4–5 to build (web card 1.5, routing to the editor 0.5, API title,
setup state and field 1, row-4 replace and opener ordering 1, i18n 0.3) and 1 for the proof in
item 9. This needs an ADR (the first-session flow changes ADR-0062, ADR-0070, ADR-0087 and
ADR-0091 in place) before the build.
