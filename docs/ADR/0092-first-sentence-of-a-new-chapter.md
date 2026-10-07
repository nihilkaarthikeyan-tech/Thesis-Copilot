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

