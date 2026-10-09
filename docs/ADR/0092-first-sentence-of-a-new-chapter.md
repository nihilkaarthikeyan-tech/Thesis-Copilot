# 0092 — The first sentence of a new chapter, reliably

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R5 — the part about the opening sentence)

## Context

Jenni offers a cited first sentence under the first heading about 17 s after Start. Ours
(ADR-0078, ADR-0087) worked in the ADR-0087 run, but in three runs on 2026-10-07 no opening
sentence came under the first heading of a new thesis. Two causes, both found in the browser:

1. **A lost "running" mark.** `Document.meta` holds independent keys (the proposal conversation,
   the outline run, the source preferences), and each was written as
   `{ ...meta-read-earlier, key }`. With the start questions (ADR-0091), a student who pressed
   Skip while the first question was being written started a plan (`outlineRun: RUNNING`), then
   the question's save wrote back the `meta` it had read before — the mark was gone, the editor's
   Sections panel saw no plan coming and stopped looking: no headings, so no opening sentence.
2. **No focus, no second chance.** The headings land ~25 s after the chapter opens. If the student
   has looked at another tab meanwhile, the editor cannot take focus; the opener's focus check
   fails, and nothing asked again when the student came back.

Also seen: Skip swallowed a refusal of the plan from the title (the trial's two title plans a
month used up), leaving a blank chapter with no word of why.

## Decision

- `setMetaKey` (`apps/api/src/common/document-meta.ts`) sets one key of `meta` in a single
  statement (`meta || jsonb_build_object(key, value)`); the proposal turn and both outline-run
  starts use it, and the worker marks a run done the same way. No write of one of these keys can
  undo another.
- The opener (`ghost-text.ts`) is also asked for when the editor gains focus with the cursor in an
  empty section not yet offered one, and the editor takes focus back when its tab is shown again
  and nothing else on the page has it. A pending opener is not restarted by the editor's own
  focus call.
- Skip says why when the plan is refused and offers "Start writing without a plan"; the
  questions, whose plan is not counted the same way, stay open.

Not done here, kept in the plan as R5b: sub-headings (H3) in Smart headings (a change to the
outline prompt, which needs its own ADR and an eval round) and a first sentence within 20 s of
Start (the outline job takes ~25 s; the sentence waits for it).

## Evidence

`apps/api/test/meta-race.spec.ts`: a slow proposal turn, the plan started during it — the
`RUNNING` mark and the turn both survive (the test fails with the old write). `packages/ui/test/
opening-sentence.spec.ts`: no focus → no request; focus → one request; focus again → none.
Browser, real models: the tea-plantation thesis's first section offered its opening sentence 1 s
after the editor had focus (shown at 4 s).

## Addendum (same day) — R5b, sub-headings

The outline prompt (A.9) already allows children of a section, but in fifteen stored outlines the
model never wrote any. Two candidates asking for them were evaluated side by side on the real
models (`packages/ai/eval/candidates/outline-h3*.md`, results beside them):

- `outline-h3` ("where a section covers two or three distinct parts"): sub-sections in 2 of 5
  outlines; current 2, candidate 0, ties 3; mean 8.8 vs 8.2; ₹6.69.
- `outline-h3b` ("every section of the literature review and methodology"): sub-sections in all 5
  (8–17 each); current 2, candidate 0, ties 3; mean 8.8 vs 8.3; ₹6.31. The judge preferred the
  current outlines' fuller chapter notes, which the sub-sections displaced.

Neither won, so A.9 is unchanged. The chapter layout (`chapterBody`, worker) now writes any
sub-section an outline does have as a level-3 heading with its own line under its section, so a
later prompt that wins, or a student's own sub-sections, need no further code. The ≤ 20 s first
sentence stays open: the outline call's median was 21–24 s in these rounds.


## Addendum 2026-10-09: the first cited sentence in under 20 s

Measured with `apps/web/e2e/_measure/first-session.spec.ts` (Start writing now, defaults, the
questions skipped; real models): 28.8 s and 39.9 s to the first cited sentence. The editor opened
in 3 s with the cursor under "Chapter 1", but no suggestion was asked for until the planned
headings landed (~25 s, the outline call). The cause: the student's automatic-suggest setting
arrives a moment after the editor is built; the opener had already looked with it off, and
nothing looked again. `setAutoSuggest` turning it on now asks the opener to look once more
(`pokeOpener`). When the plan lands, a chapter holding only that one opening sentence still takes
its headings: the first section's heading goes above the sentence, the others after it.

After, six runs: 15.6, 18.1, 19.6, 20.3, 22.4 and 38.3 s (median about 20 s). The slow one is the
library, not the editor: 29 s after Start only one of twenty found papers had a stored passage,
so the first asks had nothing to cite. Papers are read three at a time (`index-source`
concurrency) and a slow full-text download holds up the abstracts behind it: the next lever,
not yet measured. With
ACCEPT=1 the spec accepts the sentence and checks the headings are laid around it.

## Addendum 3 (2026-10-09) — R5b, a third sub-section candidate, not adopted

`outline-h3c` keeps each section's note as full as before and adds two or three sub-sections only
where a Literature Review or Methodology section has separable parts. On the evaluation cases
(each with a gap map) it won: current 0, candidate 1, ties 4; mean 8.6 vs 8.3; sub-sections in all
five outlines (6–12 each); median 18.2 s vs 16.8 s; ₹7.07. But on the product's commonest start —
Start writing now, planned from the title alone before any gap map exists — it cut the Literature
Review from six sections (five of five runs with the current prompt) to 0, 5 and 1 in three runs:
with no gap map the model declined to name themes. So A.9 is unchanged. The editor now lays out
any sub-sections an outline has as level-3 headings in the open chapter too (as the worker
already did), ready for a candidate that also holds the title-only path; the next round must
include title-only cases.

## Addendum 4 (2026-10-09) — R5b, a fourth sub-section candidate, title-only cases first

The outline round (`eval/run.ts outline`) now carries a title-only case beside each of its five
gap-map cases (`<id>-title`): the request generate-outline.ts sends for `fromTitle` — the working
title, an empty problem statement, no objectives, no gap map, `STEM_EMPIRICAL` — kept as the worker
keeps it (`dropPlaceholderSections` too). Its judge sees only the title. The run counts each plan's
shape in code: the Literature Review's sections, the sub-sections, and any sub-section outside the
Literature Review and Methodology.

**Pass criterion, written before any candidate ran.** `outline-h3d` replaces A.9 only if all four
hold:

1. **Title-only plans keep the Literature Review.** Every title-only run of the candidate (the
   judged round and any extra samples) has at least 4 Literature Review sections.
2. **Sub-sections where they belong.** Every candidate outline, in both sets, has at least one
   sub-section, and none sits outside the Literature Review and Methodology chapters.
3. **The judged round does not lose.** Over all ten cases, candidate wins ≥ current wins.
4. **No slower.** The candidate's median time over the judged round is at most the current
   prompt's + 2 s.

**The candidate.** `outline-h3d` is `outline-h3c` with two changes: when `<gap_map>` is missing
or empty, the Literature Review still gets five or six sections, the themes this topic's
literature would cover, never a placeholder; and sub-sections go in two places only — Methodology
(at least one of its sections, where it combines two or three separate procedures) and the
Literature Review only when a gap map named its themes. A first draft, measured on the title-only
cases without a judge (₹2.21), kept the Literature Review (6, 6, 6, 5, 6 sections) but gave
sub-sections in only 2 of 5 plans, so the Methodology rule was made firmer before the judged round.

**The round** (`eval/results/outline-h3d-2026-10-09-11-13.json`, ten cases, judged):

| | current | outline-h3d |
|---|---|---|
| Wins (both sets) | 1 | 1 (8 ties) |
| Mean score | 8.5 | 8.4 |
| Median time | 17.4 s | 13.7 s |
| Gap-map set: verdicts | 0 | 0 (5 ties) |
| Gap-map: LR sections | 4, 4, 4, 4, 4 | 3, 4, 3, 3, 4 |
| Gap-map: sub-sections | 0 in all five | 3, 4, 2, 4, 2 (none outside LR/Methodology) |
| Title-only set: verdicts | 1 | 1 (3 ties) |
| Title-only: LR sections | 5, 6, 7, 6, 5 | 6, 6, 6, 6, 6 |
| Title-only: sub-sections | 0 in all five | 2, 3, 2, 4, **0** (none outside LR/Methodology) |

Against the criterion: 1 passes (6 Literature Review sections in every title-only plan — the fault
that sank h3c is fixed); 3 passes (1–1); 4 passes (3.6 s faster); **2 fails** — the
microfinance title-only plan has no sub-section at all (its Methodology came back as four flat
sections: data collection and sampling, instruments, analysis, ethics), despite the rule that at
least one Methodology section has children. **Not adopted: A.9 is unchanged.** The two rounds
cost ₹14.82 together. What the round does show: the empty-gap-map rule holds the title path, and
it is the sub-section rule, not the Literature Review, that is now unreliable; a fifth candidate
would keep h3d's Literature Review rule and make the Methodology sub-sections a requirement the
code can check (or add them in code), measured on the same ten cases.
