# ADR-0056 — Examiner review of a chapter the student wrote

**Status:** accepted · **Date:** 2026-10-04 · **Extends:** ADR-0039 (chapter build — its examiner),
ADR-0023 (citation support), ADR-0007 (flag fingerprints).

## Context

Jenni's Peer Review reads any document in about a minute and a half and pins Major and Minor
comments to sentences (`docs/JENNI-FINDINGS.md`). We have a stricter reviewer already — the chapter
build's examiner (`examiner.md`, evaluated in ADR-0038's rounds), which reads one section's
numbered sentences against the passages they cite, the discipline's terminology sheet, the pitfall
bank and the discipline's examiner focus — but only a chapter the build itself wrote ever reaches
it. A student who wrote their own chapter, which is most of them, cannot ask for it.

## Decision

A one-button **Examiner review** on the editor's Flags tab, for the chapter open in the editor.

- **A metered action of its own, `EXAMINER_REVIEW`.** One unit is one review of one chapter.
  Caps: 6 a month on STUDENT and INSTITUTION_SEAT, 1 on FREE_TRIAL. `AiAction` and `FlagType`
  gain `EXAMINER_REVIEW` and `EXAMINER` (migration `0031_examiner_review`). The unit is taken by
  `UsageService.consume` (the atomic statement, before any provider call), after the refusals
  that cost nothing: fewer than three sentences of the student's own text, a review of the chapter
  already running, or a chapter unchanged since a complete review. It is given back if the job
  cannot be queued, and by the worker if no section could be reviewed.
- **The same examiner, unchanged.** No new prompt. `buildExaminerReviewRequest` is the chapter
  build's `buildExaminerRequest` with the action set to `EXAMINER_REVIEW`; `postProcessExaminer`,
  `examinerSchema` and `mockExaminerFor` are reused as they are. The discipline is the student's
  saved chapter profile, else `suggestDiscipline(field, title)`; paradigm from the profile; degree
  from the thesis details; approved pitfalls for the discipline and `*`; the discipline's
  terminology. No entity list (the chapter was not planned from key terms), so `entity_missing`
  will rarely be raised. The section's `purpose` is the chapter's scope note.
- **What it reads** (`reviewChapter`, `packages/ai/src/builder/examiner-review.ts`): the chapter
  as saved, split at its headings (a chapter without subheadings is one section). A pending
  `draftBlock` is skipped — not the student's text yet (FR-4.10). Tables, code and display maths
  are not prose and are skipped. Sentences under 20 characters are left out, as the build does.
  At most **8 sections**: more headings than that, and it splits at the top heading level only;
  a section over 50 sentences goes in parts; the smallest neighbours are joined while a pair still
  fits; anything still left over is not sent and is counted.
- **The evidence**: each citation's passage — the chunk it was made from (`chunkId`, ADR-0023),
  else the source's first two chunks, else its abstract — cut to 1,200 characters, only from the
  thesis's own library. A citation whose passage cannot be read is taken out of the sentence: a
  claim judged against nothing would be a guess.
- **The job** (`examiner-review`, `apps/worker/src/jobs/examiner-review.ts`): at most three
  sections at once, every call with `AbortSignal.timeout(180 s)` (the build's `callTimeoutMs`). A
  section whose call fails or times out is named in the result and the others still land. The
  worker writes the run's terminal state in `Document.meta.examinerReviews[chapterId]` and never
  throws (a BullMQ retry would pay for every section again). The job id is
  `examiner-review__<chapterId>__v<version>__a<attempt>`: keyed on what it reads, with an attempt
  number only for a deliberate re-run of the same version after a failure.
- **Flags.** Each issue becomes a `CoherenceFlag` of type `EXAMINER` on the exact range of its
  sentence (positions from the editor's own node sizes, so no text matching is needed: the
  examiner's sentence id maps straight back), severity `ERROR` for blocking and `WARN` for
  warning, `description` = the explanation, `suggestion` = the correction. Before writing, the
  chapter's previous **open** examiner flags are cleared; resolved and ignored ones stay, and an
  issue whose fingerprint (type, chapter, issue type + sentence) the student ignored is not raised
  again. A coherence run's reconciliation no longer reads `EXAMINER` flags, so it cannot clear
  them. An examiner flag's location is trusted while the chapter is the version its review read.
- **Screen.** The Flags tab has the button, a one-line explanation, "Reviewing… 0:42" while it
  runs (polled every 3 s), and the result in one line. Examiner flags read "Examiner: blocking" or
  "Examiner: warning", with "Suggested correction: …" under the explanation; the existing actions
  (Go to, Resolve, Ignore, Suggest fix) apply. The checks list names it.

## Cost

One review is priced at its worst case: 8 sections × one examiner call of the chapter build's
shape (5,500 tokens in, 4,000 cached, 600 out) — 44,000 in, 32,000 cached, 4,800 out on the strong
tier. At `gpt-5-mini` that is **₹1.8618 a review, ₹11.17 a month** at the cap of 6.

| Fast tier | Before | With examiner reviews |
|---|---|---|
| `gpt-5-nano` (the cost-model test's production pair) | ₹52.72 | **₹63.89** |
| `gpt-4.1-mini` (ADR-0051, Assist) | ₹74.64 | **₹85.82** |

Both within the ₹100 ceiling; the cap did not need lowering. The trial (cap 1) adds ₹1.86.
`packages/config/test/cost-model.spec.ts` pins both totals.

## Consequences

- The examiner prompt is now asked about text it was not evaluated on: chapters students wrote,
  without a plan or key terms. Its precision there is unmeasured until a real thesis is reviewed
  with the real models (`docs/PENDING.md`).
- A coherence run and an examiner review both write `Document.meta` read-modify-write, as the
  coherence run already did; a record left `QUEUED`/`RUNNING` by a lost write or a dead worker is
  reported as failed after 30 minutes and may be started again.
- A review in which a section's call failed leaves the unchanged chapter open to another review,
  for another unit. Sections left out because the chapter is longer than eight sections of fifty
  sentences are counted in the worker's log only; such a chapter is about 10,000 words.
