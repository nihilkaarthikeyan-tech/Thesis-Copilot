# 0124 — A whole literature review from one press

Date: 2026-10-08
Status: accepted — built behind an off flag with a cap of 0; ADR-0143 (2026-10-09) set the
allowance (one a month paid, none on the trial), turned the flag on and repriced it to ₹17.39
(Jenni build plan R37, owner decision D3; inventory §6, §13.4)
Builds on: ADR-0039 (chapter build), ADR-0037 (finding sources), ADR-0058 (email when a long job
finishes), ADR-0035 (an admin's extra allowance)

## Context

Jenni's Literature review workflow takes a topic and, one press later, delivers a whole review
document: 8½ minutes, 25,270 words, seven chapters, sixty headings, eight tables, an email at the
end. Ours had the chapter build (ADR-0039): one chapter at a time, planned from the key terms of
the objectives, at most fourteen sections, delivered as pending drafts with the QA report. On a
literature chapter that gave an introduction, two to five "Thematic review: <key terms>" sections,
the gaps, the link to the objectives and a summary — a chapter, not the review a student means.

On 2026-10-08 the owner decided D3: build it now, price it, and leave the price to them.

## Decision

- **A literature review build** writes every section of the thesis's literature review chapter:
  the review's introduction, **one section per theme**, the theoretical framework where the
  discipline needs one, the critical gap analysis, the link to the objectives and the summary
  where the university asks for one. At most **15 themes, 20 sections**
  (`LIT_REVIEW_MAX_THEMES`, `LIT_REVIEW_BUILD_MAX_SECTIONS`).
- **The themes are planned in code, for nothing.** `POST /documents/:id/literature-review` takes
  no unit and calls no model. It proposes the literature chapter's own outline subsections first,
  in order, with their scope notes and subheadings (`review-themes.ts`; subsections the blueprint
  already writes — introduction, framework, gaps, summary, objectives — are left to it), then the
  themes the literature search found (`DocumentMemory.gapMap`, A.8), well-covered ones first,
  "Other" never. The student renames, reorders, removes or adds themes (`PUT …/plan`); a planned
  theme keeps its outline place and its subheadings when renamed. With no themes left, the review
  is planned from the key terms exactly as a chapter build plans it.
- **One press writes it.** `POST …/:buildId/start` runs the refusals that cost nothing (no outline,
  a live co-author, drafts still waiting in the chapter, a build already running on the thesis, a
  chapter that is not the literature chapter), then takes one **`LIT_REVIEW_BUILD`** unit through
  `UsageService.consume` — the atomic statement, before any provider call — then queues the job.
  A job that cannot be queued gives the unit back and leaves the review PLANNED.
- **The chapter build's pipeline, unchanged.** `runChapterBuild` with `kind: 'LIT_REVIEW'` on its
  own `lit-review-build` queue: the key terms (a fast-tier `entities.md` call, inside the unit), the
  library first and ADR-0037's search for any theme it does not cover — keyed on the theme
  (`startFindSources` now takes the section, as the API's searches have since ADR-0087; keyed on
  the chapter alone, every theme after the first was the same BullMQ job and searched nothing; the
  chapter build keeps its chapter key), each section written once
  through the A.2 draft path (a theme from the outline passes its subheadings as A.2's `children`,
  as Draft mode does), joined and checked in code, read once by the examiner, the flagged
  sentences fixed once (at most ten sections), proofread, and delivered. **No new prompt and no
  prompt edit:** only the plan differs (`planLiteratureReview`). Every call carries
  `AbortSignal.timeout(180 s)`; every call is logged as `LIT_REVIEW_BUILD`, so the runtime stop at
  ₹100 of real spend sees it; the worker owns the row's terminal state and refunds the unit when
  nothing could be written. The job id is `lit-review-build__<buildId>`: the row is what the job
  reads, and its plan and profile are fixed once it leaves PLANNED.
- **Flag, don't fix.** Every section lands in the chapter as a pending `draftBlock` with `DRAFT`
  provenance and a `LIT_REVIEW_BUILD` suggestion event, which `/draft/:id/accept` and `/discard`
  now accept (they knew only DRAFT and CHAPTER_BUILD). The chapter is snapshotted first
  (`PRE_LIT_REVIEW_BUILD`). Nothing is thesis text until the student accepts each section.
- **The QA report** is the chapter build's: same row (`ChapterBuild.kind = 'LIT_REVIEW'`), same
  tabs, same PDF/HTML download, same "Not a problem here" decisions.
- **The email** goes by ADR-0058's rule (over a minute, nobody watching, setting on, once): "Your
  literature review is ready", a count of the sections waiting, a link to the build screen; on
  failure "Nothing was charged" only when the refund statement ran.
- **Behind a flag, at a cap of 0.** `literatureReviewBuild` is a DB-backed `FeatureFlag`, read at
  request time and cached 60 s, inserted **off** by migration 0050 (deploys migrate; they do not
  seed) and seeded off. Off, the build screen does not offer it and every route answers 403.
  `LIT_REVIEW_BUILD` is 0 on every plan, so even with the flag on only an account given extra
  allowance by an admin (ADR-0035) can start one. An allowance no plan includes is left off the
  pricing page, the help page and the student's usage list (`offeredOnSomePlan`), so nothing
  advertises what is not on sale.

## Cost

Priced as `CHAPTER_BUILD` is, per section, at the worst case of twenty sections: each written
once (6,000 in, 800 out) and examined once (5,500 in, 600 out), ten of them fixed once (2,500 in,
900 out), the fast-tier proofread scaled from fourteen sections to twenty (22,857 strong-tier
input tokens), the key-term extraction folded in, the 4,000-token cached block once per call (50
calls): 277,857 in, 200,000 cached, 37,000 out on the strong tier.

| Per build, at `gpt-5-mini` | ₹ |
|---|---|
| Literature review build (20 sections) | **₹12.92** (₹12.9164) |
| For comparison: chapter build (14 sections) | ₹9.04 |

With the cap at 0 no monthly total moves (`packages/config/test/cost-model.spec.ts` pins both and
adds the new row at 0 × ₹12.9164):

| Fully active student | Today | +1 review | +2 reviews |
|---|---|---|---|
| fast tier `gpt-4.1-mini` (what production runs, ADR-0051) | ₹93.13 | ₹106.05 — **over** | ₹118.96 — over |
| fast tier `gpt-5-nano` (the cost test's base) | ₹74.00 | ₹86.92 | ₹99.83 |
| Free trial, `gpt-4.1-mini` | ₹30.31 | ₹43.23 | — |

So at today's other allowances **no paid-plan allowance fits the ₹100 ceiling on the production
models**; one review a month fits only with a trade, for example:

- chapter builds 3 → 2 and one review: **₹97.00**;
- examiner reviews 6 → 2 and one review: **₹98.60**;
- or the trial alone at one review (₹43.23).

The search a review may start for each uncovered theme is not in this price: it is ADR-0037's,
under its own monthly count (20 paid, 5 trial) and its own bound (under ₹0.50 each, logged as
`EMBED`) — but one review can use up to fifteen of the month's twenty.

## Not done

- **No real-model run yet.** The profile is the worst case; a real review's `totals.spentInr` is
  the number to compare it with before an allowance is set.
- **No tables.** Jenni's review had eight; A.2 writes prose and a review here has none unless the
  student adds them.
- **Not Jenni's length.** Twenty sections of about 500 words (the blueprint's theme length) is
  roughly 8,700 words, against Jenni's 25,000; longer sections would need a new draft length the
  A.2 prompt has not been evaluated at.
- No browser check yet, and no Playwright spec: turning the flag on needs the admin route or
  waiting out the flag cache.

## Evidence

`apps/worker/test/lit-review-build.spec.ts` (7): one section per confirmed theme in the student's
order between the introduction and the gaps; an outline theme's subheadings asked of A.2 and
delivered; every section a pending draft with DRAFT provenance and a `LIT_REVIEW_BUILD` event;
every call with a time limit; nineteen themes capped at fifteen and twenty sections, the drafts,
examiner passes and fixes within the priced counts; each uncovered theme asks for its own search;
nothing written is REFUSED with the unit refunded; key terms go to the theme that names them; no
themes plans as a chapter build; the email's subject, count, link and refund line.
`apps/worker/test/find-sources.spec.ts` (+1): a search given a section is keyed on it.

`apps/api/test/lit-review-build.spec.ts` (5, real HTTP, Postgres and Redis): the flag row exists
and is off, the overview says `{ enabled: false }`, planning is 403 with no row; flag on, only the
literature chapter is offered, at a cap of 0, and the plan proposes the outline's theme (with its
subheading) and the search's themes, without "Other", the outline's introduction and gaps, or a
repeat — with no call logged and no unit; the student's edit keeps the outline place; at a cap of
0 the start is a 429 with no unit, no job and the row still PLANNED, the chapter-build route cannot
start it, and the usage list does not show it; with an admin's one extra unit the start is a 202,
exactly one unit, the row QUEUED, the job `lit-review-build__<id>` with `kind: 'LIT_REVIEW'`, and
a second start, a late edit and a new plan are each refused for nothing; a review's section is
accepted at `/draft/:id/accept`.
